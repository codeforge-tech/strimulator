import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { RefundService } from "../services/refunds";
import { ChargeService } from "../services/charges";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function refundRoutes(db: StrimulatorDB) {
  const chargeService = new ChargeService(db);
  const service = new RefundService(db, chargeService);

  return new Elysia({ prefix: "/v1/refunds" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/refunds — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      return service.create(params);
    })

    // GET /v1/refunds — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      const q = query as Record<string, string | undefined>;
      return service.list({
        ...listParams,
        chargeId: q.charge ?? undefined,
        paymentIntentId: q.payment_intent ?? undefined,
      });
    })

    // GET /v1/refunds/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    });
}
