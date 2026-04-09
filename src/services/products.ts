import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { products } from "../db/schema/products";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

export interface CreateProductParams {
  name?: string;
  active?: boolean;
  description?: string;
  metadata?: Record<string, string>;
  url?: string;
  statement_descriptor?: string;
  unit_label?: string;
  tax_code?: string;
}

export interface UpdateProductParams {
  name?: string;
  active?: boolean;
  description?: string;
  metadata?: Record<string, string>;
  url?: string;
  statement_descriptor?: string;
  unit_label?: string;
  tax_code?: string;
}

function buildProductShape(
  id: string,
  createdAt: number,
  params: {
    name?: string | null;
    active?: boolean;
    description?: string | null;
    metadata?: Record<string, string>;
    url?: string | null;
    statement_descriptor?: string | null;
    unit_label?: string | null;
    tax_code?: string | null;
  },
): Stripe.Product {
  return {
    id,
    object: "product",
    active: params.active !== undefined ? params.active : true,
    created: createdAt,
    default_price: null,
    description: params.description ?? null,
    images: [],
    livemode: false,
    metadata: params.metadata ?? {},
    name: params.name ?? "",
    package_dimensions: null,
    shippable: null,
    statement_descriptor: params.statement_descriptor ?? null,
    tax_code: params.tax_code ?? null,
    unit_label: params.unit_label ?? null,
    updated: createdAt,
    url: params.url ?? null,
    type: "service",
  } as unknown as Stripe.Product;
}

export class ProductService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreateProductParams): Stripe.Product {
    if (!params.name) {
      throw invalidRequestError("Missing required param: name.", "name");
    }

    const id = generateId("product");
    const createdAt = now();
    const product = buildProductShape(id, createdAt, params);

    this.db.insert(products).values({
      id,
      name: params.name,
      active: params.active !== false ? 1 : 0,
      deleted: 0,
      created: createdAt,
      data: JSON.stringify(product),
    }).run();

    return product;
  }

  retrieve(id: string): Stripe.Product {
    const row = this.db.select().from(products).where(eq(products.id, id)).get();

    if (!row || row.deleted === 1) {
      throw resourceNotFoundError("product", id);
    }

    return JSON.parse(row.data) as Stripe.Product;
  }

  update(id: string, params: UpdateProductParams): Stripe.Product {
    const existing = this.retrieve(id);

    const updatedAt = now();
    const updated: Stripe.Product = {
      ...existing,
      active: "active" in params ? (params.active !== undefined ? params.active : existing.active) : existing.active,
      name: "name" in params ? (params.name ?? existing.name) : existing.name,
      description: "description" in params ? (params.description ?? null) : existing.description,
      metadata: params.metadata !== undefined
        ? { ...(existing.metadata ?? {}), ...params.metadata }
        : existing.metadata,
      statement_descriptor: "statement_descriptor" in params ? (params.statement_descriptor ?? null) : existing.statement_descriptor,
      unit_label: "unit_label" in params ? (params.unit_label ?? null) : existing.unit_label,
      url: "url" in params ? (params.url ?? null) : (existing as any).url,
      tax_code: "tax_code" in params ? (params.tax_code ?? null) : existing.tax_code,
      updated: updatedAt,
    } as unknown as Stripe.Product;

    this.db.update(products)
      .set({
        name: updated.name,
        active: updated.active ? 1 : 0,
        data: JSON.stringify(updated),
      })
      .where(eq(products.id, id))
      .run();

    return updated;
  }

  del(id: string): Stripe.DeletedProduct {
    // Ensure product exists
    this.retrieve(id);

    this.db.update(products)
      .set({ deleted: 1 })
      .where(eq(products.id, id))
      .run();

    return {
      id,
      object: "product",
      deleted: true,
    };
  }

  list(params: ListParams): ListResponse<Stripe.Product> {
    const { limit, startingAfter } = params;

    // Fetch limit+1 to determine has_more
    const fetchLimit = limit + 1;

    let rows;
    if (startingAfter) {
      const cursor = this.db.select().from(products).where(eq(products.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("product", startingAfter);
      }

      rows = this.db.select()
        .from(products)
        .where(and(eq(products.deleted, 0), gt(products.created, cursor.created)))
        .limit(fetchLimit)
        .all();
    } else {
      rows = this.db.select()
        .from(products)
        .where(eq(products.deleted, 0))
        .limit(fetchLimit)
        .all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.Product);

    return buildListResponse(items, "/v1/products", hasMore);
  }
}
