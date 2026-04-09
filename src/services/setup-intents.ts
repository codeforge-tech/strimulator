import type Stripe from "stripe";
import { eq, gt } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { setupIntents } from "../db/schema/setup-intents";
import { generateId, generateSecret } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError, stateTransitionError } from "../errors";
import type { PaymentMethodService } from "./payment-methods";

export interface CreateSetupIntentParams {
  customer?: string;
  payment_method?: string;
  confirm?: boolean;
  metadata?: Record<string, string>;
}

export interface ConfirmSetupIntentParams {
  payment_method?: string;
}

type SetupIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "canceled"
  | "succeeded";

const TERMINAL_STATES: SetupIntentStatus[] = ["canceled", "succeeded"];

function buildSetupIntentShape(
  id: string,
  createdAt: number,
  clientSecret: string,
  params: {
    customer: string | null;
    payment_method: string | null;
    status: SetupIntentStatus;
    metadata: Record<string, string>;
    cancellation_reason?: string | null;
  },
): Stripe.SetupIntent {
  return {
    id,
    object: "setup_intent",
    application: null,
    automatic_payment_methods: null,
    cancellation_reason: params.cancellation_reason ?? null,
    client_secret: clientSecret,
    created: createdAt,
    customer: params.customer ?? null,
    description: null,
    last_setup_error: null,
    latest_attempt: null,
    livemode: false,
    mandate: null,
    metadata: params.metadata,
    next_action: null,
    on_behalf_of: null,
    payment_method: params.payment_method ?? null,
    payment_method_options: {},
    payment_method_types: ["card"],
    single_use_mandate: null,
    status: params.status,
    usage: "off_session",
  } as unknown as Stripe.SetupIntent;
}

export class SetupIntentService {
  constructor(
    private db: StrimulatorDB,
    private paymentMethodService: PaymentMethodService,
  ) {}

  create(params: CreateSetupIntentParams): Stripe.SetupIntent {
    const id = generateId("setup_intent");
    const createdAt = now();
    const clientSecret = generateSecret(id);

    // Determine initial status
    let status: SetupIntentStatus = "requires_payment_method";
    if (params.payment_method) {
      status = "requires_confirmation";
    }

    // If confirm=true with PM, run confirm flow
    if (params.confirm && params.payment_method) {
      const si = buildSetupIntentShape(id, createdAt, clientSecret, {
        customer: params.customer ?? null,
        payment_method: params.payment_method,
        status: "requires_confirmation",
        metadata: params.metadata ?? {},
      });

      this.db.insert(setupIntents).values({
        id,
        customer_id: params.customer ?? null,
        payment_method_id: params.payment_method,
        status: "requires_confirmation",
        client_secret: clientSecret,
        created: createdAt,
        data: JSON.stringify(si),
      }).run();

      return this.confirm(id, { payment_method: params.payment_method });
    }

    const si = buildSetupIntentShape(id, createdAt, clientSecret, {
      customer: params.customer ?? null,
      payment_method: params.payment_method ?? null,
      status,
      metadata: params.metadata ?? {},
    });

    this.db.insert(setupIntents).values({
      id,
      customer_id: params.customer ?? null,
      payment_method_id: params.payment_method ?? null,
      status,
      client_secret: clientSecret,
      created: createdAt,
      data: JSON.stringify(si),
    }).run();

    return si;
  }

  retrieve(id: string): Stripe.SetupIntent {
    const row = this.db.select().from(setupIntents).where(eq(setupIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("setup_intent", id);
    }

    return JSON.parse(row.data) as Stripe.SetupIntent;
  }

  confirm(id: string, params: ConfirmSetupIntentParams): Stripe.SetupIntent {
    const row = this.db.select().from(setupIntents).where(eq(setupIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("setup_intent", id);
    }

    const existing = JSON.parse(row.data) as Stripe.SetupIntent;

    // Validate state
    if (
      existing.status !== "requires_confirmation" &&
      existing.status !== "requires_payment_method"
    ) {
      throw stateTransitionError("setup_intent", id, existing.status, "confirm");
    }

    // Determine PM to use
    const pmId = params.payment_method ?? (existing.payment_method as string | null);

    if (!pmId) {
      throw invalidRequestError(
        "You must provide a payment method to confirm this SetupIntent.",
        "payment_method",
      );
    }

    // Validate PM exists
    this.paymentMethodService.retrieve(pmId);

    const updatedData = buildSetupIntentShape(id, existing.created, existing.client_secret!, {
      customer: existing.customer as string | null,
      payment_method: pmId,
      status: "succeeded",
      metadata: existing.metadata as Record<string, string>,
    });

    this.db.update(setupIntents)
      .set({
        payment_method_id: pmId,
        status: "succeeded",
        data: JSON.stringify(updatedData),
      })
      .where(eq(setupIntents.id, id))
      .run();

    return updatedData;
  }

  cancel(id: string): Stripe.SetupIntent {
    const row = this.db.select().from(setupIntents).where(eq(setupIntents.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("setup_intent", id);
    }

    const existing = JSON.parse(row.data) as Stripe.SetupIntent;

    if (TERMINAL_STATES.includes(existing.status as SetupIntentStatus)) {
      throw stateTransitionError("setup_intent", id, existing.status, "cancel");
    }

    const updatedData = buildSetupIntentShape(id, existing.created, existing.client_secret!, {
      customer: existing.customer as string | null,
      payment_method: existing.payment_method as string | null,
      status: "canceled",
      metadata: existing.metadata as Record<string, string>,
      cancellation_reason: null,
    });

    this.db.update(setupIntents)
      .set({
        status: "canceled",
        data: JSON.stringify(updatedData),
      })
      .where(eq(setupIntents.id, id))
      .run();

    return updatedData;
  }

  list(params: ListParams): ListResponse<Stripe.SetupIntent> {
    const { limit, startingAfter } = params;
    const fetchLimit = limit + 1;

    let rows;

    if (startingAfter) {
      const cursor = this.db.select().from(setupIntents).where(eq(setupIntents.id, startingAfter)).get();
      if (!cursor) {
        throw resourceNotFoundError("setup_intent", startingAfter);
      }

      rows = this.db
        .select()
        .from(setupIntents)
        .where(gt(setupIntents.created, cursor.created))
        .limit(fetchLimit)
        .all();
    } else {
      rows = this.db
        .select()
        .from(setupIntents)
        .limit(fetchLimit)
        .all();
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.data) as Stripe.SetupIntent);

    return buildListResponse(items, "/v1/setup_intents", hasMore);
  }
}
