import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { RefundService } from "../services/refunds";
import { ChargeService } from "../services/charges";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function refundRoutes(db: StrimulatorDB, eventService?: EventService) {
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
      const refund = service.create(params);
      eventService?.emit("refund.created", refund as unknown as Record<string, unknown>);
      return refund;
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
