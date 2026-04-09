import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { SetupIntentService } from "../services/setup-intents";
import { PaymentMethodService } from "../services/payment-methods";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function setupIntentRoutes(db: StrimulatorDB) {
  const pmService = new PaymentMethodService(db);
  const service = new SetupIntentService(db, pmService);

  return new Elysia({ prefix: "/v1/setup_intents" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/setup_intents — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      return service.create({
        customer: params.customer as string | undefined,
        payment_method: params.payment_method as string | undefined,
        confirm: params.confirm === "true" || params.confirm === true,
        metadata: params.metadata as Record<string, string> | undefined,
      });
    })

    // GET /v1/setup_intents — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    })

    // GET /v1/setup_intents/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/setup_intents/:id/confirm — confirm
    .post("/:id/confirm", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      return service.confirm(id, {
        payment_method: params.payment_method as string | undefined,
      });
    })

    // POST /v1/setup_intents/:id/cancel — cancel
    .post("/:id/cancel", ({ params: { id } }) => {
      return service.cancel(id);
    });
}
