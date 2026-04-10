import type Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { customers } from "../db/schema/customers";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, cursorCondition, type ListParams, type ListResponse } from "../lib/pagination";
import { parseSearchQuery, matchesCondition, buildSearchResult, type SearchResult } from "../lib/search";
import { resourceNotFoundError } from "../errors";

export interface CreateCustomerParams {
  email?: string;
  name?: string;
  description?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export interface UpdateCustomerParams {
  email?: string;
  name?: string;
  description?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

function buildInvoicePrefix(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let prefix = "";
  for (let i = 0; i < 8; i++) {
    prefix += chars[Math.floor(Math.random() * chars.length)];
  }
  return prefix;
}

function buildCustomerShape(
  id: string,
  createdAt: number,
  params: {
    email?: string | null;
    name?: string | null;
    description?: string | null;
    phone?: string | null;
    metadata?: Record<string, string>;
    invoice_prefix?: string;
  },
): Stripe.Customer {
  return {
    id,
    object: "customer",
    address: null,
    balance: 0,
    created: createdAt,
    currency: null,
    default_source: null,
    delinquent: false,
    description: params.description ?? null,
    discount: null,
    email: params.email ?? null,
    invoice_prefix: params.invoice_prefix ?? buildInvoicePrefix(),
    invoice_settings: {
      custom_fields: null,
      default_payment_method: null,
      footer: null,
      rendering_options: null,
    },
    livemode: false,
    metadata: params.metadata ?? {},
    name: params.name ?? null,
    phone: params.phone ?? null,
    preferred_locales: [],
    shipping: null,
    tax_exempt: "none",
    test_clock: null,
  } as unknown as Stripe.Customer;
}

export class CustomerService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreateCustomerParams): Stripe.Customer {
    const id = generateId("customer");
    const createdAt = now();
    const customer = buildCustomerShape(id, createdAt, params);

    this.db.insert(customers).values({
      id,
      email: params.email ?? null,
      name: params.name ?? null,
      deleted: 0,
      created: createdAt,
      data: JSON.stringify(customer),
    }).run();

    return customer;
  }

  retrieve(id: string): Stripe.Customer {
    const row = this.db.select().from(customers).where(eq(customers.id, id)).get();

    if (!row || row.deleted === 1) {
      throw resourceNotFoundError("customer", id);
    }

    return JSON.parse(row.data) as Stripe.Customer;
  }

  update(id: string, params: UpdateCustomerParams): Stripe.Customer {
    const existing = this.retrieve(id);

    const updated: Stripe.Customer = {
      ...existing,
      email: "email" in params ? (params.email ?? null) : existing.email,
      name: "name" in params ? (params.name ?? null) : existing.name,
      description: "description" in params ? (params.description ?? null) : existing.description,
      phone: "phone" in params ? (params.phone ?? null) : existing.phone,
      metadata: params.metadata !== undefined
        ? { ...(existing.metadata ?? {}), ...params.metadata }
        : existing.metadata,
    };

    this.db.update(customers)
      .set({
        email: updated.email ?? null,
        name: updated.name ?? null,
        data: JSON.stringify(updated),
      })
      .where(eq(customers.id, id))
      .run();

    return updated;
  }

  del(id: string): Stripe.DeletedCustomer {
    // Ensure customer exists
    this.retrieve(id);

    this.db.update(customers)
      .set({ deleted: 1 })
      .where(eq(customers.id, id))
      .run();

    return {
      id,
      object: "customer",
      deleted: true,
    };
  }

  search(queryStr: string, limit: number = 10): SearchResult<Stripe.Customer> {
    const conditions = parseSearchQuery(queryStr);
    const allRows = this.db.select().from(customers).where(eq(customers.deleted, 0)).all();

    const filtered = allRows.filter(row => {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      return conditions.every(cond => matchesCondition(data, cond));
    });

    const items = filtered.slice(0, limit);
    return buildSearchResult(
      items.map(r => JSON.parse(r.data) as Stripe.Customer),
      "/v1/customers/search",
      filtered.length > limit,
      filtered.length,
    );
  }

  list(params: ListParams): ListResponse<Stripe.Customer> {
    const { limit, startingAfter } = params;

    // Fetch limit+1 to determine has_more
    const fetchLimit = limit + 1;

    let rows;
    if (startingAfter) {
      // Find the cursor row to get its created timestamp
      const cursor = this.db.select().from(customers).where(eq(customers.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("customer", startingAfter);
      }

      rows = this.db.select()
        .from(customers)
        .where(and(eq(customers.deleted, 0), cursorCondition(customers.created, customers.id, cursor.created, cursor.id)))
        .orderBy(customers.created, customers.id)
        .limit(fetchLimit)
        .all();
    } else {
      rows = this.db.select()
        .from(customers)
        .where(eq(customers.deleted, 0))
        .orderBy(customers.created, customers.id)
        .limit(fetchLimit)
        .all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.Customer);

    return buildListResponse(items, "/v1/customers", hasMore);
  }
}
