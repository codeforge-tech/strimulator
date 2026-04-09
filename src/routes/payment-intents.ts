import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { PaymentIntentService } from "../services/payment-intents";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function paymentIntentRoutes(db: StrimulatorDB) {
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

      return service.create(params);
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
      return service.confirm(id, {
        payment_method: params.payment_method,
        capture_method: params.capture_method,
      });
    })

    // POST /v1/payment_intents/:id/capture — capture
    .post("/:id/capture", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (typeof params.amount_to_capture === "string") {
        params.amount_to_capture = parseInt(params.amount_to_capture, 10);
      }

      return service.capture(id, {
        amount_to_capture: params.amount_to_capture,
      });
    })

    // POST /v1/payment_intents/:id/cancel — cancel
    .post("/:id/cancel", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      return service.cancel(id, {
        cancellation_reason: params.cancellation_reason,
      });
    });
}
