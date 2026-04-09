import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { subscriptions, subscriptionItems } from "../db/schema/subscriptions";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { parseSearchQuery, matchesCondition, buildSearchResult, type SearchResult } from "../lib/search";
import { resourceNotFoundError, invalidRequestError, stateTransitionError } from "../errors";
import type { InvoiceService } from "./invoices";
import type { PriceService } from "./prices";

const THIRTY_DAYS_SECS = 30 * 24 * 60 * 60;

export interface CreateSubscriptionItemParam {
  price: string;
  quantity?: number;
}

export interface CreateSubscriptionParams {
  customer: string;
  items: CreateSubscriptionItemParam[];
  trial_period_days?: number;
  metadata?: Record<string, string>;
}

export interface ListSubscriptionParams extends ListParams {
  customerId?: string;
}

function buildSubscriptionItemShape(
  id: string,
  createdAt: number,
  subscriptionId: string,
  price: Stripe.Price,
  quantity: number,
): Stripe.SubscriptionItem {
  return {
    id,
    object: "subscription_item",
    created: createdAt,
    metadata: {},
    price,
    quantity,
    subscription: subscriptionId,
  } as unknown as Stripe.SubscriptionItem;
}

function buildSubscriptionShape(
  id: string,
  createdAt: number,
  params: {
    customer: string;
    status: string;
    currency: string;
    current_period_start: number;
    current_period_end: number;
    trial_start?: number | null;
    trial_end?: number | null;
    items: Stripe.SubscriptionItem[];
    metadata?: Record<string, string>;
    canceled_at?: number | null;
    ended_at?: number | null;
    cancel_at?: number | null;
    cancel_at_period_end?: boolean;
    latest_invoice?: string | null;
  },
): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    billing_cycle_anchor: params.current_period_start,
    cancel_at: params.cancel_at ?? null,
    cancel_at_period_end: params.cancel_at_period_end ?? false,
    canceled_at: params.canceled_at ?? null,
    collection_method: "charge_automatically",
    created: createdAt,
    currency: params.currency,
    current_period_end: params.current_period_end,
    current_period_start: params.current_period_start,
    customer: params.customer,
    default_payment_method: null,
    ended_at: params.ended_at ?? null,
    items: {
      object: "list",
      data: params.items,
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`,
    },
    latest_invoice: params.latest_invoice ?? null,
    livemode: false,
    metadata: params.metadata ?? {},
    status: params.status as Stripe.Subscription.Status,
    test_clock: null,
    trial_end: params.trial_end ?? null,
    trial_start: params.trial_start ?? null,
  } as unknown as Stripe.Subscription;
}

export class SubscriptionService {
  constructor(
    private db: StrimulatorDB,
    private invoiceService: InvoiceService,
    private priceService: PriceService,
  ) {}

  create(params: CreateSubscriptionParams): Stripe.Subscription {
    if (!params.customer) {
      throw invalidRequestError("Missing required param: customer.", "customer");
    }

    if (!params.items || params.items.length === 0) {
      throw invalidRequestError("You must provide at least one item.", "items");
    }

    const id = generateId("subscription");
    const createdAt = now();
    const periodStart = createdAt;
    const periodEnd = createdAt + THIRTY_DAYS_SECS;

    // Validate prices and build subscription items
    const itemShapes: Stripe.SubscriptionItem[] = [];
    const itemRows: Array<{ id: string; subscriptionId: string; priceId: string; quantity: number; created: number; data: string }> = [];

    for (const itemParam of params.items) {
      if (!itemParam.price) {
        throw invalidRequestError("Each item must have a price.", "items[].price");
      }

      // Will throw 404 if price not found
      const price = this.priceService.retrieve(itemParam.price);
      const quantity = itemParam.quantity ?? 1;
      const itemId = generateId("subscription_item");
      const itemShape = buildSubscriptionItemShape(itemId, createdAt, id, price, quantity);
      itemShapes.push(itemShape);
      itemRows.push({
        id: itemId,
        subscriptionId: id,
        priceId: itemParam.price,
        quantity,
        created: createdAt,
        data: JSON.stringify(itemShape),
      });
    }

    // Determine status and trial dates
    let status = "active";
    let trialStart: number | null = null;
    let trialEnd: number | null = null;

    if (params.trial_period_days && params.trial_period_days > 0) {
      status = "trialing";
      trialStart = createdAt;
      trialEnd = createdAt + params.trial_period_days * 24 * 60 * 60;
    }

    // Determine currency from first price
    const firstPrice = itemShapes[0].price as Stripe.Price;
    const currency = firstPrice.currency ?? "usd";

    const subscription = buildSubscriptionShape(id, createdAt, {
      customer: params.customer,
      status,
      currency,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      trial_start: trialStart,
      trial_end: trialEnd,
      items: itemShapes,
      metadata: params.metadata,
    });

    // Insert subscription
    this.db.insert(subscriptions).values({
      id,
      customerId: params.customer,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      testClockId: null,
      created: createdAt,
      data: JSON.stringify(subscription),
    }).run();

    // Insert subscription items
    for (const itemRow of itemRows) {
      this.db.insert(subscriptionItems).values({
        id: itemRow.id,
        subscriptionId: itemRow.subscriptionId,
        priceId: itemRow.priceId,
        quantity: itemRow.quantity,
        created: itemRow.created,
        data: JSON.stringify(JSON.parse(itemRow.data)),
      }).run();
    }

    return subscription;
  }

  retrieve(id: string): Stripe.Subscription {
    const row = this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("subscription", id);
    }

    return JSON.parse(row.data as string) as Stripe.Subscription;
  }

  cancel(id: string): Stripe.Subscription {
    const row = this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("subscription", id);
    }

    const existing = JSON.parse(row.data as string) as Stripe.Subscription;

    if (existing.status === "canceled") {
      throw stateTransitionError("subscription", id, existing.status, "cancel");
    }

    const canceledAt = now();

    const updated = buildSubscriptionShape(id, existing.created, {
      customer: existing.customer as string,
      status: "canceled",
      currency: existing.currency,
      current_period_start: (existing as any).current_period_start,
      current_period_end: (existing as any).current_period_end,
      trial_start: existing.trial_start,
      trial_end: existing.trial_end,
      items: (existing.items as Stripe.ApiList<Stripe.SubscriptionItem>).data,
      metadata: existing.metadata as Record<string, string>,
      canceled_at: canceledAt,
      ended_at: canceledAt,
      cancel_at: (existing as any).cancel_at,
      cancel_at_period_end: existing.cancel_at_period_end,
      latest_invoice: existing.latest_invoice as string | null,
    });

    this.db.update(subscriptions)
      .set({
        status: "canceled",
        data: JSON.stringify(updated),
      })
      .where(eq(subscriptions.id, id))
      .run();

    return updated;
  }

  search(queryStr: string, limit: number = 10): SearchResult<Stripe.Subscription> {
    const conditions = parseSearchQuery(queryStr);
    const allRows = this.db.select().from(subscriptions).all();

    const filtered = allRows.filter(row => {
      const data = JSON.parse(row.data as string) as Record<string, unknown>;
      return conditions.every(cond => matchesCondition(data, cond));
    });

    const items = filtered.slice(0, limit);
    return buildSearchResult(
      items.map(r => JSON.parse(r.data as string) as Stripe.Subscription),
      "/v1/subscriptions/search",
      filtered.length > limit,
      filtered.length,
    );
  }

  list(params: ListSubscriptionParams): ListResponse<Stripe.Subscription> {
    const { limit, startingAfter, customerId } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof gt>) => {
      const conditions = [];
      if (customerId) conditions.push(eq(subscriptions.customerId, customerId));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(subscriptions).where(eq(subscriptions.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("subscription", startingAfter);
      }

      const condition = buildConditions(gt(subscriptions.created, cursor.created));
      rows = condition
        ? this.db.select().from(subscriptions).where(condition).limit(fetchLimit).all()
        : this.db.select().from(subscriptions).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(subscriptions).where(condition).limit(fetchLimit).all()
        : this.db.select().from(subscriptions).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data as string) as Stripe.Subscription);

    return buildListResponse(items, "/v1/subscriptions", hasMore);
  }
}
