import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { PaymentIntentService } from "../services/payment-intents";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function paymentIntentRoutes(db: StrimulatorDB, eventService?: EventService) {
  const chargeService = new ChargeService(db);
  const paymentMethodService = new PaymentMethodService(db);
  const service = new PaymentIntentService(db, chargeService, paymentMethodService);

  return new Elysia({ prefix: "/v1/payment_intents" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/payment_intents — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (typeof params.amount === "string") {
        params.amount = parseInt(params.amount, 10);
      }
      if (typeof params.confirm === "string") {
        params.confirm = params.confirm === "true";
      }

      const pi = service.create(params);
      eventService?.emit("payment_intent.created", pi as unknown as Record<string, unknown>);
      // If confirm=true was passed, the PI may already be succeeded/failed — emit that too
      if (params.confirm && params.payment_method) {
        if (pi.status === "succeeded") {
          eventService?.emit("payment_intent.succeeded", pi as unknown as Record<string, unknown>);
        } else if (pi.status === "requires_payment_method" && pi.last_payment_error) {
          eventService?.emit("payment_intent.payment_failed", pi as unknown as Record<string, unknown>);
        }
      }
      return pi;
    })

    // GET /v1/payment_intents — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({ ...listParams, customerId: q.customer });
    })

    // GET /v1/payment_intents/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/payment_intents/:id — update (simplified)
    .post("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/payment_intents/:id/confirm — confirm
    .post("/:id/confirm", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const confirmed = service.confirm(id, {
        payment_method: params.payment_method,
        capture_method: params.capture_method,
      });
      if (confirmed.status === "succeeded") {
        eventService?.emit("payment_intent.succeeded", confirmed as unknown as Record<string, unknown>);
      } else if (confirmed.status === "requires_payment_method" && confirmed.last_payment_error) {
        eventService?.emit("payment_intent.payment_failed", confirmed as unknown as Record<string, unknown>);
      }
      return confirmed;
    })

    // POST /v1/payment_intents/:id/capture — capture
    .post("/:id/capture", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (typeof params.amount_to_capture === "string") {
        params.amount_to_capture = parseInt(params.amount_to_capture, 10);
      }

      const captured = service.capture(id, {
        amount_to_capture: params.amount_to_capture,
      });
      eventService?.emit("payment_intent.succeeded", captured as unknown as Record<string, unknown>);
      return captured;
    })

    // POST /v1/payment_intents/:id/cancel — cancel
    .post("/:id/cancel", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const canceled = service.cancel(id, {
        cancellation_reason: params.cancellation_reason,
      });
      eventService?.emit("payment_intent.canceled", canceled as unknown as Record<string, unknown>);
      return canceled;
    });
}
