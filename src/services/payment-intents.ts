import type Stripe from "stripe";
import { eq, gt, and } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { paymentIntents } from "../db/schema/payment-intents";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError, stateTransitionError, cardError } from "../errors";
import type { ChargeService } from "./charges";
import type { PaymentMethodService } from "./payment-methods";

export interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customer?: string;
  payment_method?: string;
  capture_method?: "automatic" | "manual";
  confirm?: boolean;
  description?: string;
  metadata?: Record<string, string>;
  payment_method_types?: string[];
}

export interface ConfirmPaymentIntentParams {
  payment_method?: string;
  capture_method?: "automatic" | "manual";
}

export interface CapturePaymentIntentParams {
  amount_to_capture?: number;
}

export interface CancelPaymentIntentParams {
  cancellation_reason?: string;
}

export interface ListPaymentIntentParams extends ListParams {
  customerId?: string;
}

type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

const TERMINAL_STATES: PaymentIntentStatus[] = ["succeeded", "canceled"];

function generateClientSecret(id: string): string {
  // Generate 16 random chars
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let secret = "";
  for (let i = 0; i < 16; i++) {
    secret += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${id}_secret_${secret}`;
}

function buildPaymentIntentShape(
  id: string,
  createdAt: number,
  clientSecret: string,
  params: {
    amount: number;
    currency: string;
    customer?: string | null;
    payment_method?: string | null;
    capture_method: "automatic" | "manual";
    status: PaymentIntentStatus;
    metadata?: Record<string, string>;
    latest_charge?: string | null;
    last_payment_error?: Stripe.PaymentIntent["last_payment_error"] | null;
    amount_received?: number;
    canceled_at?: number | null;
    cancellation_reason?: string | null;
  },
): Stripe.PaymentIntent {
  return {
    id,
    object: "payment_intent",
    amount: params.amount,
    amount_capturable: params.status === "requires_capture" ? params.amount : 0,
    amount_received: params.amount_received ?? (params.status === "succeeded" ? params.amount : 0),
    automatic_payment_methods: null,
    canceled_at: params.canceled_at ?? null,
    cancellation_reason: params.cancellation_reason ?? null,
    capture_method: params.capture_method,
    client_secret: clientSecret,
    confirmation_method: "automatic",
    created: createdAt,
    currency: params.currency,
    customer: params.customer ?? null,
    description: null,
    last_payment_error: params.last_payment_error ?? null,
    latest_charge: params.latest_charge ?? null,
    livemode: false,
    metadata: params.metadata ?? {},
    next_action: null,
    on_behalf_of: null,
    payment_method: params.payment_method ?? null,
    payment_method_options: {},
    payment_method_types: ["card"],
    processing: null,
    receipt_email: null,
    setup_future_usage: null,
    shipping: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: params.status,
    transfer_data: null,
    transfer_group: null,
  } as unknown as Stripe.PaymentIntent;
}

interface SimulationResult {
  success: boolean;
  failureCode?: string;
  failureMessage?: string;
  declineCode?: string;
}

export class PaymentIntentService {
  constructor(
    private db: StrimulatorDB,
    private chargeService: ChargeService,
    private paymentMethodService: PaymentMethodService,
  ) {}

  private simulatePaymentOutcome(pm: Stripe.PaymentMethod): SimulationResult {
    const last4 = pm.card?.last4;
    if (last4 === "0002") {
      return {
        success: false,
        failureCode: "card_declined",
        failureMessage: "Your card was declined.",
        declineCode: "generic_decline",
      };
    }
    return { success: true };
  }

  create(params: CreatePaymentIntentParams): Stripe.PaymentIntent {
    if (!params.amount || params.amount <= 0) {
      throw invalidRequestError("Amount must be greater than 0.", "amount");
    }
    if (!params.currency) {
      throw invalidRequestError("Currency is required.", "currency");
    }

    const id = generateId("payment_intent");
    const createdAt = now();
    const clientSecret = generateClientSecret(id);
    const captureMethod = params.capture_method ?? "automatic";

    // Determine initial status
    let status: PaymentIntentStatus = "requires_payment_method";
    if (params.payment_method) {
      status = "requires_confirmation";
    }

    // If confirm=true with PM, run the confirm flow
    if (params.confirm && params.payment_method) {
      // First create the PI row, then confirm
      const pi = buildPaymentIntentShape(id, createdAt, clientSecret, {
        amount: params.amount,
        currency: params.currency,
        customer: params.customer ?? null,
        payment_method: params.payment_method,
        capture_method: captureMethod,
        status: "requires_confirmation",
        metadata: params.metadata,
      });

      this.db.insert(paymentIntents).values({
        id,
        customer_id: params.customer ?? null,
        payment_method_id: params.payment_method,
        status: "requires_confirmation",
        amount: params.amount,
        currency: params.currency,
        client_secret: clientSecret,
        capture_method: captureMethod,
        created: createdAt,
        data: JSON.stringify(pi),
      }).run();

      // Run confirm flow
      return this.confirm(id, {
        payment_method: params.payment_method,
        capture_method: captureMethod,
      });
    }

    const pi = buildPaymentIntentShape(id, createdAt, clientSecret, {
      amount: params.amount,
      currency: params.currency,
      customer: params.customer ?? null,
      payment_method: params.payment_method ?? null,
      capture_method: captureMethod,
      status,
      metadata: params.metadata,
    });

    this.db.insert(paymentIntents).values({
      id,
      customer_id: params.customer ?? null,
      payment_method_id: params.payment_method ?? null,
      status,
      amount: params.amount,
      currency: params.currency,
      client_secret: clientSecret,
      capture_method: captureMethod,
      created: createdAt,
      data: JSON.stringify(pi),
    }).run();

    return pi;
  }

  retrieve(id: string): Stripe.PaymentIntent {
    const row = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("payment_intent", id);
    }

    return JSON.parse(row.data) as Stripe.PaymentIntent;
  }

  confirm(id: string, params: ConfirmPaymentIntentParams): Stripe.PaymentIntent {
    const row = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("payment_intent", id);
    }

    const existing = JSON.parse(row.data) as Stripe.PaymentIntent;

    // Validate state
    if (
      existing.status !== "requires_confirmation" &&
      existing.status !== "requires_payment_method"
    ) {
      throw stateTransitionError("payment_intent", id, existing.status, "confirm");
    }

    // Determine PM to use
    const pmId = params.payment_method ?? existing.payment_method;

    if (!pmId) {
      throw invalidRequestError(
        "You must provide a payment method to confirm this PaymentIntent.",
        "payment_method",
      );
    }

    const pm = this.paymentMethodService.retrieve(pmId);
    const captureMethod = (params.capture_method ?? existing.capture_method) as "automatic" | "manual";

    // Simulate the payment
    const outcome = this.simulatePaymentOutcome(pm);

    if (!outcome.success) {
      // Payment failed
      const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret, {
        amount: existing.amount,
        currency: existing.currency,
        customer: existing.customer as string | null,
        payment_method: pmId,
        capture_method: captureMethod,
        status: "requires_payment_method",
        metadata: existing.metadata as Record<string, string>,
        last_payment_error: {
          type: "card_error",
          code: outcome.failureCode,
          decline_code: outcome.declineCode,
          message: outcome.failureMessage,
          payment_method: pm,
        } as unknown as Stripe.PaymentIntent["last_payment_error"],
      });

      this.db.update(paymentIntents)
        .set({
          payment_method_id: pmId,
          status: "requires_payment_method",
          data: JSON.stringify(updatedData),
        })
        .where(eq(paymentIntents.id, id))
        .run();

      return updatedData;
    }

    // Payment succeeded — create a charge
    const charge = this.chargeService.create({
      amount: existing.amount,
      currency: existing.currency,
      customerId: existing.customer as string | null,
      paymentIntentId: id,
      paymentMethodId: pmId,
      status: "succeeded",
    });

    const newStatus: PaymentIntentStatus = captureMethod === "manual" ? "requires_capture" : "succeeded";

    const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret, {
      amount: existing.amount,
      currency: existing.currency,
      customer: existing.customer as string | null,
      payment_method: pmId,
      capture_method: captureMethod,
      status: newStatus,
      metadata: existing.metadata as Record<string, string>,
      latest_charge: charge.id,
      amount_received: newStatus === "succeeded" ? existing.amount : 0,
    });

    this.db.update(paymentIntents)
      .set({
        payment_method_id: pmId,
        status: newStatus,
        data: JSON.stringify(updatedData),
      })
      .where(eq(paymentIntents.id, id))
      .run();

    return updatedData;
  }

  capture(id: string, params: CapturePaymentIntentParams): Stripe.PaymentIntent {
    const row = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("payment_intent", id);
    }

    const existing = JSON.parse(row.data) as Stripe.PaymentIntent;

    if (existing.status !== "requires_capture") {
      throw stateTransitionError("payment_intent", id, existing.status, "capture");
    }

    const amountToCapture = params.amount_to_capture ?? existing.amount;

    const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret, {
      amount: existing.amount,
      currency: existing.currency,
      customer: existing.customer as string | null,
      payment_method: existing.payment_method as string | null,
      capture_method: existing.capture_method as "automatic" | "manual",
      status: "succeeded",
      metadata: existing.metadata as Record<string, string>,
      latest_charge: existing.latest_charge as string | null,
      amount_received: amountToCapture,
    });

    this.db.update(paymentIntents)
      .set({
        status: "succeeded",
        data: JSON.stringify(updatedData),
      })
      .where(eq(paymentIntents.id, id))
      .run();

    return updatedData;
  }

  cancel(id: string, params: CancelPaymentIntentParams): Stripe.PaymentIntent {
    const row = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("payment_intent", id);
    }

    const existing = JSON.parse(row.data) as Stripe.PaymentIntent;

    if (TERMINAL_STATES.includes(existing.status as PaymentIntentStatus)) {
      throw stateTransitionError("payment_intent", id, existing.status, "cancel");
    }

    const canceledAt = now();

    const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret, {
      amount: existing.amount,
      currency: existing.currency,
      customer: existing.customer as string | null,
      payment_method: existing.payment_method as string | null,
      capture_method: existing.capture_method as "automatic" | "manual",
      status: "canceled",
      metadata: existing.metadata as Record<string, string>,
      latest_charge: existing.latest_charge as string | null,
      canceled_at: canceledAt,
      cancellation_reason: params.cancellation_reason ?? null,
    });

    this.db.update(paymentIntents)
      .set({
        status: "canceled",
        data: JSON.stringify(updatedData),
      })
      .where(eq(paymentIntents.id, id))
      .run();

    return updatedData;
  }

  list(params: ListPaymentIntentParams): ListResponse<Stripe.PaymentIntent> {
    const { limit, startingAfter, customerId } = params;
    const fetchLimit = limit + 1;

    const buildConditions = (extraCondition?: ReturnType<typeof gt>) => {
      const conditions = [];
      if (customerId) conditions.push(eq(paymentIntents.customer_id, customerId));
      if (extraCondition) conditions.push(extraCondition);
      return conditions.length > 0 ? and(...conditions) : undefined;
    };

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(paymentIntents).where(eq(paymentIntents.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("payment_intent", startingAfter);
      }

      const condition = buildConditions(gt(paymentIntents.created, cursor.created));
      rows = condition
        ? this.db.select().from(paymentIntents).where(condition).limit(fetchLimit).all()
        : this.db.select().from(paymentIntents).limit(fetchLimit).all();
    } else {
      const condition = buildConditions();
      rows = condition
        ? this.db.select().from(paymentIntents).where(condition).limit(fetchLimit).all()
        : this.db.select().from(paymentIntents).limit(fetchLimit).all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.PaymentIntent);

    return buildListResponse(items, "/v1/payment_intents", hasMore);
  }
}
