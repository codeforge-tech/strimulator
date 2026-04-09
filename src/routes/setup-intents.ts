import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { SetupIntentService } from "../services/setup-intents";
import { PaymentMethodService } from "../services/payment-methods";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function setupIntentRoutes(db: StrimulatorDB, eventService?: EventService) {
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
      const si = service.create({
        customer: params.customer as string | undefined,
        payment_method: params.payment_method as string | undefined,
        confirm: params.confirm === "true" || params.confirm === true,
        metadata: params.metadata as Record<string, string> | undefined,
      });
      eventService?.emit("setup_intent.created", si as unknown as Record<string, unknown>);
      return si;
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
      const confirmed = service.confirm(id, {
        payment_method: params.payment_method as string | undefined,
      });
      eventService?.emit("setup_intent.succeeded", confirmed as unknown as Record<string, unknown>);
      return confirmed;
    })

    // POST /v1/setup_intents/:id/cancel — cancel
    .post("/:id/cancel", ({ params: { id } }) => {
      return service.cancel(id);
    });
}
