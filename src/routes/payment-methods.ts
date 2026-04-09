import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { PaymentMethodService } from "../services/payment-methods";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function paymentMethodRoutes(db: StrimulatorDB, eventService?: EventService) {
  const service = new PaymentMethodService(db);

  return new Elysia({ prefix: "/v1/payment_methods" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/payment_methods — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const pm = service.create(params);
      eventService?.emit("payment_method.created", pm as unknown as Record<string, unknown>);
      return pm;
    })

    // GET /v1/payment_methods — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({
        ...listParams,
        customerId: q.customer,
        type: q.type ?? "card",
      });
    })

    // GET /v1/payment_methods/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/payment_methods/:id/attach — attach to customer
    .post("/:id/attach", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const attached = service.attach(id, params.customer);
      eventService?.emit("payment_method.attached", attached as unknown as Record<string, unknown>);
      return attached;
    })

    // POST /v1/payment_methods/:id/detach — detach from customer
    .post("/:id/detach", ({ params: { id } }) => {
      const detached = service.detach(id);
      eventService?.emit("payment_method.detached", detached as unknown as Record<string, unknown>);
      return detached;
    });
}
