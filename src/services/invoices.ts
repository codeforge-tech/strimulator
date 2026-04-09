import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { invoices } from "../db/schema/invoices";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { parseSearchQuery, matchesCondition, buildSearchResult, type SearchResult } from "../lib/search";
import { resourceNotFoundError, invalidRequestError, stateTransitionError } from "../errors";

export interface CreateInvoiceParams {
  customer: string;
  subscription?: string;
  currency?: string;
  amount_due?: number;
  metadata?: Record<string, string>;
}

export interface ListInvoiceParams extends ListParams {
  customerId?: string;
  subscriptionId?: string;
}

let invoiceCounter = 0;

function buildInvoiceNumber(): string {
  invoiceCounter += 1;
  return `INV-${String(invoiceCounter).padStart(6, "0")}`;
}

function buildInvoiceShape(
  id: string,
  createdAt: number,
  params: {
    customer: string;
    subscription?: string | null;
    currency: string;
    amount_due: number;
    amount_paid: number;
    status: string;
    metadata?: Record<string, string>;
    number?: string | null;
    paid?: boolean;
    attempt_count?: number;
    attempted?: boolean;
    effective_at?: number | null;
    period_start?: number;
    period_end?: number;
    billing_reason?: string | null;
  },
): Stripe.Invoice {
  const amountDue = params.amount_due;
  const amountPaid = params.amount_paid;
  const amountRemaining = Math.max(0, amountDue - amountPaid);

  return {
    id,
    object: "invoice",
    amount_due: amountDue,
    amount_paid: amountPaid,
    amount_remaining: amountRemaining,
    attempt_count: params.attempt_count ?? 0,
    attempted: params.attempted ?? false,
    auto_advance: true,
    billing_reason: params.billing_reason ?? null,
    collection_method: "charge_automatically",
    created: createdAt,
    currency: params.currency,
    customer: params.customer,
    default_payment_method: null,
    description: null,
    hosted_invoice_url: null,
    lines: {
      object: "list",
      data: [],
      has_more: false,
      url: `/v1/invoices/${id}/lines`,
    },
    livemode: false,
    metadata: params.metadata ?? {},
    number: params.number ?? null,
    paid: params.paid ?? false,
    payment_intent: null,
    period_end: params.period_end ?? createdAt,
    period_start: params.period_start ?? createdAt,
    status: params.status as Stripe.Invoice.Status,
    subscription: params.subscription ?? null,
    subtotal: amountDue,
    total: amountDue,
    effective_at: params.effective_at ?? null,
  } as unknown as Stripe.Invoice;
}

export class InvoiceService {
  constructor(private db: StrimulatorDB) {
    // Initialize counter from existing invoices to avoid duplicates across restarts
    const rows = db.select().from(invoices).all();
    if (rows.length > 0) {
      invoiceCounter = rows.length;
    }
  }

  create(params: CreateInvoiceParams): Stripe.Invoice {
    if (!params.customer) {
      throw invalidRequestError("Missing required param: customer.", "customer");
    }

    const id = generateId("invoice");
    const createdAt = now();
    const currency = params.currency ?? "usd";
    const amountDue = params.amount_due ?? 0;

    const invoice = buildInvoiceShape(id, createdAt, {
      customer: params.customer,
      subscription: params.subscription ?? null,
      currency,
      amount_due: amountDue,
      amount_paid: 0,
      status: "draft",
      metadata: params.metadata,
    });

    this.db.insert(invoices).values({
      id,
      customerId: params.customer,
      subscriptionId: params.subscription ?? null,
      status: "draft",
      amountDue,
      amountPaid: 0,
      currency,
      paymentIntentId: null,
      created: createdAt,
      data: JSON.stringify(invoice),
    }).run();

    return invoice;
  }

  retrieve(id: string): Stripe.Invoice {
    const row = this.db.select().from(invoices).where(eq(invoices.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("invoice", id);
    }

    return JSON.parse(row.data as string) as Stripe.Invoice;
  }

  finalizeInvoice(id: string): Stripe.Invoice {
    const row = this.db.select().from(invoices).where(eq(invoices.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("invoice", id);
    }

    const existing = JSON.parse(row.data as string) as Stripe.Invoice;

    if (existing.status !== "draft") {
      throw stateTransitionError("invoice", id, existing.status as string, "finalize");
    }

    const effectiveAt = now();
    const invoiceNumber = buildInvoiceNumber();

    const updated = buildInvoiceShape(id, existing.created, {
      customer: existing.customer as string,
      subscription: (existing as any).subscription as string | null,
      currency: existing.currency,
      amount_due: existing.amount_due,
      amount_paid: existing.amount_paid,
      status: "open",
      metadata: existing.metadata as Record<string, string>,
      number: invoiceNumber,
      paid: false,
      attempt_count: existing.attempt_count,
      attempted: existing.attempted,
      effective_at: effectiveAt,
      period_start: (existing as any).period_start,
      period_end: (existing as any).period_end,
      billing_reason: (existing as any).billing_reason,
    });

    this.db.update(invoices)
      .set({
        status: "open",
        data: JSON.stringify(updated),
      })
      .where(eq(invoices.id, id))
      .run();

    return updated;
  }

  pay(id: string): Stripe.Invoice {
    const row = this.db.select().from(invoices).where(eq(invoices.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("invoice", id);
    }

    const existing = JSON.parse(row.data as string) as Stripe.Invoice;

    if (existing.status !== "open") {
      throw stateTransitionError("invoice", id, existing.status as string, "pay");
    }

    const updated = buildInvoiceShape(id, existing.created, {
      customer: existing.customer as string,
      subscription: (existing as any).subscription as string | null,
      currency: existing.currency,
      amount_due: existing.amount_due,
      amount_paid: existing.amount_due,
      status: "paid",
      metadata: existing.metadata as Record<string, string>,
      number: (existing as any).number,
      paid: true,
      attempt_count: (existing.attempt_count ?? 0) + 1,
      attempted: true,
      effective_at: (existing as any).effective_at,
      period_start: (existing as any).period_start,
      period_end: (existing as any).period_end,
      billing_reason: (existing as any).billing_reason,
    });

    this.db.update(invoices)
      .set({
        status: "paid",
        amountPaid: existing.amount_due,
        data: JSON.stringify(updated),
      })
      .where(eq(invoices.id, id))
      .run();

    return updated;
  }

  voidInvoice(id: string): Stripe.Invoice {
    const row = this.db.select().from(invoices).where(eq(invoices.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("invoice", id);
    }

    const existing = JSON.parse(row.data as string) as Stripe.Invoice;

    if (existing.status !== "open") {
      throw stateTransitionError("invoice", id, existing.status as string, "void");
    }

    const updated = buildInvoiceShape(id, existing.created, {
      customer: existing.customer as string,
      subscription: (existing as any).subscription as string | null,
      currency: existing.currency,
      amount_due: existing.amount_due,
      amount_paid: existing.amount_paid,
      status: "void",
      metadata: existing.metadata as Record<string, string>,
      number: (existing as any).number,
      paid: false,
      attempt_count: existing.attempt_count,
      attempted: existing.attempted,
      effective_at: (existing as any).effective_at,
      period_start: (existing as any).period_start,
      period_end: (existing as any).period_end,
      billing_reason: (existing as any).billing_reason,
    });

    this.db.update(invoices)
      .set({
        status: "void",
        data: JSON.stringify(updated),
      })
      .where(eq(invoices.id, id))
      .run();

    return updated;
  }

  search(queryStr: string, limit: number = 10): SearchResult<Stripe.Invoice> {
    const conditions = parseSearchQuery(queryStr);
    const allRows = this.db.select().from(invoices).all();

    const filtered = allRows.filter(row => {
      const data = JSON.parse(row.data as string) as Record<string, unknown>;
      return conditions.every(cond => matchesCondition(data, cond));
    });

    const items = filtered.slice(0, limit);
    return buildSearchResult(
      items.map(r => JSON.parse(r.data as string) as Stripe.Invoice),
      "/v1/invoices/search",
      filtered.length > limit,
      filtered.length,
    );
  }

  list(params: ListInvoiceParams): ListResponse<Stripe.Invoice> {
    const { limit, startingAfter, customerId, subscriptionId } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof gt>) => {
      const conditions = [];
      if (customerId) conditions.push(eq(invoices.customerId, customerId));
      if (subscriptionId) conditions.push(eq(invoices.subscriptionId, subscriptionId));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(invoices).where(eq(invoices.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("invoice", startingAfter);
      }

      const condition = buildConditions(gt(invoices.created, cursor.created));
      rows = condition
        ? this.db.select().from(invoices).where(condition).limit(fetchLimit).all()
        : this.db.select().from(invoices).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(invoices).where(condition).limit(fetchLimit).all()
        : this.db.select().from(invoices).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data as string) as Stripe.Invoice);

    return buildListResponse(items, "/v1/invoices", hasMore);
  }
}
