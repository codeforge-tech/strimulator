import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { charges } from "../db/schema/charges";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError } from "../errors";

export interface CreateChargeParams {
  amount: number;
  currency: string;
  customerId: string | null;
  paymentIntentId: string;
  paymentMethodId: string | null;
  status: "succeeded" | "failed";
  failureCode?: string | null;
  failureMessage?: string | null;
  metadata?: Record<string, string>;
}

export interface ListChargeParams extends ListParams {
  paymentIntentId?: string;
  customerId?: string;
}

function buildChargeShape(
  id: string,
  createdAt: number,
  params: CreateChargeParams,
): Stripe.Charge {
  const captured = params.status === "succeeded";

  return {
    id,
    object: "charge",
    amount: params.amount,
    amount_captured: captured ? params.amount : 0,
    amount_refunded: 0,
    balance_transaction: null,
    billing_details: {
      address: null,
      email: null,
      name: null,
      phone: null,
    },
    calculated_statement_descriptor: "STRIMULATOR",
    captured,
    created: createdAt,
    currency: params.currency,
    customer: params.customerId,
    description: null,
    disputed: false,
    failure_code: params.failureCode ?? null,
    failure_message: params.failureMessage ?? null,
    invoice: null,
    livemode: false,
    metadata: params.metadata ?? {},
    outcome: {
      network_status: captured ? "approved_by_network" : "declined_by_network",
      reason: captured ? null : (params.failureCode ?? "generic_decline"),
      risk_level: "normal",
      risk_score: 20,
      seller_message: captured ? "Payment complete." : "The bank did not return any further details with this decline.",
      type: captured ? "authorized" : "issuer_declined",
    },
    paid: captured,
    payment_intent: params.paymentIntentId,
    payment_method: params.paymentMethodId,
    refunded: false,
    refunds: {
      object: "list",
      data: [],
      has_more: false,
      url: `/v1/charges/${id}/refunds`,
    },
    status: params.status,
  } as unknown as Stripe.Charge;
}

export class ChargeService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreateChargeParams): Stripe.Charge {
    const id = generateId("charge");
    const createdAt = now();
    const charge = buildChargeShape(id, createdAt, params);

    this.db.insert(charges).values({
      id,
      customer_id: params.customerId,
      payment_intent_id: params.paymentIntentId,
      status: params.status,
      amount: params.amount,
      currency: params.currency,
      refunded_amount: 0,
      created: createdAt,
      data: JSON.stringify(charge),
    }).run();

    return charge;
  }

  retrieve(id: string): Stripe.Charge {
    const row = this.db.select().from(charges).where(eq(charges.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("charge", id);
    }

    return JSON.parse(row.data) as Stripe.Charge;
  }

  list(params: ListChargeParams): ListResponse<Stripe.Charge> {
    const { limit, startingAfter, paymentIntentId, customerId } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof gt>) => {
      const conditions = [];
      if (paymentIntentId) conditions.push(eq(charges.payment_intent_id, paymentIntentId));
      if (customerId) conditions.push(eq(charges.customer_id, customerId));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...conditions) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(charges).where(eq(charges.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("charge", startingAfter);
      }

      const condition = buildConditions(gt(charges.created, cursor.created));
      rows = condition
        ? this.db.select().from(charges).where(condition).limit(fetchLimit).all()
        : this.db.select().from(charges).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(charges).where(condition).limit(fetchLimit).all()
        : this.db.select().from(charges).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.Charge);

    return buildListResponse(items, "/v1/charges", hasMore);
  }
}
