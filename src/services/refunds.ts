import type Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { refunds } from "../db/schema/refunds";
import { charges } from "../db/schema/charges";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, cursorCondition, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type { ChargeService } from "./charges";

export interface CreateRefundParams {
  charge?: string;
  payment_intent?: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface ListRefundParams extends ListParams {
  chargeId?: string;
  paymentIntentId?: string;
}

function buildRefundShape(
  id: string,
  createdAt: number,
  params: {
    amount: number;
    currency: string;
    chargeId: string;
    paymentIntentId: string | null;
    reason: string | null;
    metadata: Record<string, string>;
  },
): Stripe.Refund {
  return {
    id,
    object: "refund",
    amount: params.amount,
    balance_transaction: null,
    charge: params.chargeId,
    created: createdAt,
    currency: params.currency,
    metadata: params.metadata,
    payment_intent: params.paymentIntentId ?? null,
    reason: params.reason ?? null,
    receipt_number: null,
    source_transfer_reversal: null,
    status: "succeeded",
    transfer_reversal: null,
  } as unknown as Stripe.Refund;
}

export class RefundService {
  constructor(
    private db: StrimulatorDB,
    private chargeService: ChargeService,
  ) {}

  create(params: CreateRefundParams): Stripe.Refund {
    if (!params.charge && !params.payment_intent) {
      throw invalidRequestError(
        "You must provide either a charge or a payment_intent.",
        "charge",
      );
    }

    let chargeId = params.charge;

    // If payment_intent provided but not charge, find the charge for that PI
    if (!chargeId && params.payment_intent) {
      const chargeRow = this.db
        .select()
        .from(charges)
        .where(eq(charges.payment_intent_id, params.payment_intent))
        .get();

      if (!chargeRow) {
        throw invalidRequestError(
          `No charge found for payment_intent '${params.payment_intent}'.`,
          "payment_intent",
        );
      }
      chargeId = chargeRow.id;
    }

    // Retrieve charge (throws 404 if not found)
    const charge = this.chargeService.retrieve(chargeId!);

    // Get current refunded_amount from DB row
    const chargeRow = this.db
      .select()
      .from(charges)
      .where(eq(charges.id, chargeId!))
      .get()!;

    const alreadyRefunded = chargeRow.refunded_amount ?? 0;
    const refundableAmount = charge.amount - alreadyRefunded;

    const refundAmount = params.amount ?? refundableAmount;

    if (refundAmount <= 0) {
      throw invalidRequestError("Refund amount must be greater than 0.", "amount");
    }

    if (refundAmount > refundableAmount) {
      throw invalidRequestError(
        `The refund amount (${refundAmount}) is greater than the refundable amount (${refundableAmount}).`,
        "amount",
      );
    }

    const id = generateId("refund");
    const createdAt = now();

    const paymentIntentId = (charge.payment_intent as string | null) ?? params.payment_intent ?? null;

    const refund = buildRefundShape(id, createdAt, {
      amount: refundAmount,
      currency: charge.currency,
      chargeId: chargeId!,
      paymentIntentId,
      reason: params.reason ?? null,
      metadata: params.metadata ?? {},
    });

    this.db.insert(refunds).values({
      id,
      charge_id: chargeId!,
      payment_intent_id: paymentIntentId,
      status: "succeeded",
      amount: refundAmount,
      currency: charge.currency,
      created: createdAt,
      data: JSON.stringify(refund),
    }).run();

    // Update charge's refunded_amount and refunded flag
    const newRefundedAmount = alreadyRefunded + refundAmount;
    const fullyRefunded = newRefundedAmount >= charge.amount;

    const updatedChargeData: Stripe.Charge = {
      ...(JSON.parse(chargeRow.data) as Stripe.Charge),
      amount_refunded: newRefundedAmount,
      refunded: fullyRefunded,
    };

    this.db.update(charges)
      .set({
        refunded_amount: newRefundedAmount,
        data: JSON.stringify(updatedChargeData),
      })
      .where(eq(charges.id, chargeId!))
      .run();

    return refund;
  }

  retrieve(id: string): Stripe.Refund {
    const row = this.db.select().from(refunds).where(eq(refunds.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("refund", id);
    }

    return JSON.parse(row.data) as Stripe.Refund;
  }

  list(params: ListRefundParams): ListResponse<Stripe.Refund> {
    const { limit, startingAfter, chargeId, paymentIntentId } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof eq>) => {
      const conditions = [];
      if (chargeId) conditions.push(eq(refunds.charge_id, chargeId));
      if (paymentIntentId) conditions.push(eq(refunds.payment_intent_id, paymentIntentId));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...conditions) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(refunds).where(eq(refunds.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("refund", startingAfter);
      }

      const condition = buildConditions(cursorCondition(refunds.created, refunds.id, cursor.created, cursor.id));
      rows = condition
        ? this.db.select().from(refunds).where(condition).orderBy(refunds.created, refunds.id).limit(fetchLimit).all()
        : this.db.select().from(refunds).orderBy(refunds.created, refunds.id).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(refunds).where(condition).orderBy(refunds.created, refunds.id).limit(fetchLimit).all()
        : this.db.select().from(refunds).orderBy(refunds.created, refunds.id).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.Refund);

    return buildListResponse(items, "/v1/refunds", hasMore);
  }
}
