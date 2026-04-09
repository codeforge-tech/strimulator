import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { PaymentMethodService } from "../services/payment-methods";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function paymentMethodRoutes(db: StrimulatorDB) {
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
      return service.create(params);
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
      return service.attach(id, params.customer);
    })

    // POST /v1/payment_methods/:id/detach — detach from customer
    .post("/:id/detach", ({ params: { id } }) => {
      return service.detach(id);
    });
}
