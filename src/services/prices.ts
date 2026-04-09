import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { prices } from "../db/schema/prices";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

export interface RecurringParams {
  interval: string;
  interval_count?: number;
}

export interface CreatePriceParams {
  product?: string;
  currency?: string;
  unit_amount?: number;
  active?: boolean;
  type?: string;
  nickname?: string;
  metadata?: Record<string, string>;
  recurring?: RecurringParams;
  lookup_key?: string;
  tax_behavior?: string;
}

export interface UpdatePriceParams {
  active?: boolean;
  nickname?: string;
  metadata?: Record<string, string>;
  lookup_key?: string;
  tax_behavior?: string;
}

function buildPriceShape(
  id: string,
  createdAt: number,
  params: {
    product: string;
    currency: string;
    unit_amount?: number | null;
    active?: boolean;
    type: string;
    nickname?: string | null;
    metadata?: Record<string, string>;
    recurring?: RecurringParams | null;
    lookup_key?: string | null;
    tax_behavior?: string | null;
  },
): Stripe.Price {
  const recurring = params.type === "recurring" && params.recurring
    ? {
        interval: params.recurring.interval as Stripe.Price.Recurring.Interval,
        interval_count: params.recurring.interval_count ?? 1,
        usage_type: "licensed" as Stripe.Price.Recurring.UsageType,
        aggregate_usage: null,
        trial_period_days: null,
        meter: null,
      }
    : null;

  return {
    id,
    object: "price",
    active: params.active !== undefined ? params.active : true,
    billing_scheme: "per_unit",
    created: createdAt,
    currency: params.currency,
    custom_unit_amount: null,
    livemode: false,
    lookup_key: params.lookup_key ?? null,
    metadata: params.metadata ?? {},
    nickname: params.nickname ?? null,
    product: params.product,
    recurring,
    tax_behavior: params.tax_behavior ?? null,
    tiers_mode: null,
    transform_quantity: null,
    type: params.type as Stripe.Price.Type,
    unit_amount: params.unit_amount ?? null,
    unit_amount_decimal: params.unit_amount != null ? String(params.unit_amount) : null,
  } as unknown as Stripe.Price;
}

export class PriceService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreatePriceParams): Stripe.Price {
    if (!params.product) {
      throw invalidRequestError("Missing required param: product.", "product");
    }

    if (!params.currency) {
      throw invalidRequestError("Missing required param: currency.", "currency");
    }

    const type = params.recurring ? "recurring" : (params.type ?? "one_time");
    const id = generateId("price");
    const createdAt = now();

    const price = buildPriceShape(id, createdAt, {
      product: params.product,
      currency: params.currency,
      unit_amount: params.unit_amount,
      active: params.active,
      type,
      nickname: params.nickname,
      metadata: params.metadata,
      recurring: params.recurring ?? null,
      lookup_key: params.lookup_key,
      tax_behavior: params.tax_behavior,
    });

    this.db.insert(prices).values({
      id,
      product_id: params.product,
      active: params.active !== false ? 1 : 0,
      type,
      currency: params.currency,
      unit_amount: params.unit_amount ?? null,
      created: createdAt,
      data: JSON.stringify(price),
    }).run();

    return price;
  }

  retrieve(id: string): Stripe.Price {
    const row = this.db.select().from(prices).where(eq(prices.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("price", id);
    }

    return JSON.parse(row.data) as Stripe.Price;
  }

  update(id: string, params: UpdatePriceParams): Stripe.Price {
    const existing = this.retrieve(id);

    const updated: Stripe.Price = {
      ...existing,
      active: "active" in params ? (params.active !== undefined ? params.active : existing.active) : existing.active,
      nickname: "nickname" in params ? (params.nickname ?? null) : existing.nickname,
      metadata: params.metadata !== undefined
        ? { ...(existing.metadata ?? {}), ...params.metadata }
        : existing.metadata,
      lookup_key: "lookup_key" in params ? (params.lookup_key ?? null) : existing.lookup_key,
      tax_behavior: "tax_behavior" in params ? (params.tax_behavior as any ?? null) : existing.tax_behavior,
    } as unknown as Stripe.Price;

    this.db.update(prices)
      .set({
        active: updated.active ? 1 : 0,
        data: JSON.stringify(updated),
      })
      .where(eq(prices.id, id))
      .run();

    return updated;
  }

  list(params: ListParams & { product?: string }): ListResponse<Stripe.Price> {
    const { limit, startingAfter, product } = params;

    // Fetch limit+1 to determine has_more
    const fetchLimit = limit + 1;

    let rows;
    if (startingAfter) {
      const cursor = this.db.select().from(prices).where(eq(prices.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("price", startingAfter);
      }

      const conditions = product
        ? and(eq(prices.product_id, product), gt(prices.created, cursor.created))
        : gt(prices.created, cursor.created);

      rows = this.db.select()
        .from(prices)
        .where(conditions)
        .limit(fetchLimit)
        .all();
    } else {
      const conditions = product
        ? eq(prices.product_id, product)
        : undefined;

      rows = conditions
        ? this.db.select().from(prices).where(conditions).limit(fetchLimit).all()
        : this.db.select().from(prices).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.Price);

    return buildListResponse(items, "/v1/prices", hasMore);
  }
}
