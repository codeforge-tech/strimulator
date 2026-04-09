import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ChargeService } from "../services/charges";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function chargeRoutes(db: StrimulatorDB) {
  const service = new ChargeService(db);

  return new Elysia({ prefix: "/v1/charges" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // GET /v1/charges — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({
        ...listParams,
        paymentIntentId: q.payment_intent,
      });
    })

    // GET /v1/charges/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    });
}
