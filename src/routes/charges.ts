import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ChargeService } from "../services/charges";
import { CustomerService } from "../services/customers";
import { PaymentIntentService } from "../services/payment-intents";
import { PaymentMethodService } from "../services/payment-methods";
import { parseListParams } from "../lib/pagination";
import { applyExpand, parseExpandParams, type ExpandConfig } from "../lib/expand";
import { StripeError } from "../errors";

const chargeExpandConfig: ExpandConfig = {
  customer: { resolve: (id, db) => new CustomerService(db).retrieve(id) },
  payment_intent: {
    resolve: (id, db) => {
      const chargeService = new ChargeService(db);
      const paymentMethodService = new PaymentMethodService(db);
      return new PaymentIntentService(db, chargeService, paymentMethodService).retrieve(id);
    },
  },
};

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
    .get("/:id", async ({ params: { id }, request }) => {
      const url = new URL(request.url);
      const expand = parseExpandParams(url);
      let result: any = service.retrieve(id);
      if (expand.length) {
        result = await applyExpand(result, expand, chargeExpandConfig, db);
      }
      return result;
    });
}
