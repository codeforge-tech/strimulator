import type Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { paymentMethods } from "../db/schema/payment-methods";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, cursorCondition, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";

export interface CreatePaymentMethodParams {
  type: string;
  card?: {
    token?: string;
    number?: string;
    exp_month?: number;
    exp_year?: number;
    cvc?: string;
  };
  billing_details?: {
    address?: Stripe.PaymentMethod.BillingDetails["address"] | null;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
  };
  metadata?: Record<string, string>;
}

export interface ListPaymentMethodsParams extends ListParams {
  customerId?: string;
  type?: string;
}

interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  funding: "credit" | "debit";
}

const MAGIC_TOKEN_MAP: Record<string, CardDetails> = {
  tok_visa: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_mastercard: { brand: "mastercard", last4: "4444", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_amex: { brand: "amex", last4: "8431", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_visa_debit: { brand: "visa", last4: "5556", expMonth: 12, expYear: 2034, funding: "debit" },
  tok_threeDSecureRequired: { brand: "visa", last4: "3220", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_threeDSecureOptional: { brand: "visa", last4: "3222", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_chargeDeclined: { brand: "visa", last4: "0002", expMonth: 12, expYear: 2034, funding: "credit" },
};

function resolveCardDetails(token?: string): CardDetails {
  if (token && MAGIC_TOKEN_MAP[token]) {
    return MAGIC_TOKEN_MAP[token];
  }
  return MAGIC_TOKEN_MAP["tok_visa"];
}

function generateFingerprint(brand: string, last4: string): string {
  // Simple deterministic fingerprint for testing
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let fp = "";
  for (let i = 0; i < 16; i++) {
    fp += chars[Math.floor(((brand.charCodeAt(i % brand.length) + last4.charCodeAt(i % 4)) * 7 + i * 13) % chars.length)];
  }
  return fp;
}

function buildPaymentMethodShape(
  id: string,
  createdAt: number,
  params: CreatePaymentMethodParams,
  customerId: string | null = null,
): Stripe.PaymentMethod {
  if (params.type !== "card") {
    throw invalidRequestError(`Payment method type '${params.type}' is not supported.`, "type");
  }

  const cardDetails = resolveCardDetails(params.card?.token);
  const fingerprint = generateFingerprint(cardDetails.brand, cardDetails.last4);

  return {
    id,
    object: "payment_method",
    billing_details: {
      address: params.billing_details?.address ?? null,
      email: params.billing_details?.email ?? null,
      name: params.billing_details?.name ?? null,
      phone: params.billing_details?.phone ?? null,
    },
    card: {
      brand: cardDetails.brand,
      checks: {
        address_line1_check: null,
        address_postal_code_check: null,
        cvc_check: "pass",
      },
      country: "US",
      display_brand: cardDetails.brand,
      exp_month: cardDetails.expMonth,
      exp_year: cardDetails.expYear,
      fingerprint,
      funding: cardDetails.funding,
      generated_from: null,
      last4: cardDetails.last4,
      networks: {
        available: [cardDetails.brand],
        preferred: null,
      },
      three_d_secure_usage: {
        supported: true,
      },
      wallet: null,
    } as unknown as Stripe.PaymentMethod.Card,
    created: createdAt,
    customer: customerId,
    livemode: false,
    metadata: params.metadata ?? {},
    type: "card",
  } as unknown as Stripe.PaymentMethod;
}

export class PaymentMethodService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreatePaymentMethodParams): Stripe.PaymentMethod {
    const id = generateId("payment_method");
    const createdAt = now();
    const pm = buildPaymentMethodShape(id, createdAt, params, null);

    this.db.insert(paymentMethods).values({
      id,
      customer_id: null,
      type: params.type,
      created: createdAt,
      data: JSON.stringify(pm),
    }).run();

    return pm;
  }

  retrieve(id: string): Stripe.PaymentMethod {
    const row = this.db.select().from(paymentMethods).where(eq(paymentMethods.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("payment_method", id);
    }

    return JSON.parse(row.data) as Stripe.PaymentMethod;
  }

  attach(id: string, customerId: string): Stripe.PaymentMethod {
    const existing = this.retrieve(id);

    const updated: Stripe.PaymentMethod = {
      ...existing,
      customer: customerId,
    };

    this.db.update(paymentMethods)
      .set({
        customer_id: customerId,
        data: JSON.stringify(updated),
      })
      .where(eq(paymentMethods.id, id))
      .run();

    return updated;
  }

  detach(id: string): Stripe.PaymentMethod {
    const existing = this.retrieve(id);

    const updated: Stripe.PaymentMethod = {
      ...existing,
      customer: null,
    };

    this.db.update(paymentMethods)
      .set({
        customer_id: null,
        data: JSON.stringify(updated),
      })
      .where(eq(paymentMethods.id, id))
      .run();

    return updated;
  }

  list(params: ListPaymentMethodsParams): ListResponse<Stripe.PaymentMethod> {
    const { limit, startingAfter, customerId, type } = params;
    const fetchLimit = limit + 1;

    let rows;

    const buildConditions = (extraCondition?: ReturnType<typeof eq>) => {
      const conditions = [];
      if (customerId) conditions.push(eq(paymentMethods.customer_id, customerId));
      if (type) conditions.push(eq(paymentMethods.type, type));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...conditions) : undefined;
    };

    if (startingAfter) {
      const cursor = this.db.select().from(paymentMethods).where(eq(paymentMethods.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("payment_method", startingAfter);
      }

      const condition = buildConditions(cursorCondition(paymentMethods.created, paymentMethods.id, cursor.created, cursor.id));
      rows = condition
        ? this.db.select().from(paymentMethods).where(condition).orderBy(paymentMethods.created, paymentMethods.id).limit(fetchLimit).all()
        : this.db.select().from(paymentMethods).orderBy(paymentMethods.created, paymentMethods.id).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(paymentMethods).where(condition).orderBy(paymentMethods.created, paymentMethods.id).limit(fetchLimit).all()
        : this.db.select().from(paymentMethods).orderBy(paymentMethods.created, paymentMethods.id).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.PaymentMethod);

    return buildListResponse(items, "/v1/payment_methods", hasMore);
  }
}
