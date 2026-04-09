import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { SubscriptionService } from "../services/subscriptions";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function subscriptionRoutes(db: StrimulatorDB) {
  const invoiceService = new InvoiceService(db);
  const priceService = new PriceService(db);
  const service = new SubscriptionService(db, invoiceService, priceService);

  return new Elysia({ prefix: "/v1/subscriptions" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/subscriptions — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      // Parse items array: items[0][price]=..., items[0][quantity]=...
      // The form parser already handles this, but quantity needs to be numeric
      if (Array.isArray(params.items)) {
        params.items = params.items.map((item: any) => ({
          ...item,
          quantity: item.quantity !== undefined ? parseInt(item.quantity, 10) : undefined,
        }));
      }

      if (params.trial_period_days !== undefined) {
        params.trial_period_days = parseInt(params.trial_period_days, 10);
      }

      return service.create(params);
    })

    // GET /v1/subscriptions — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({
        ...listParams,
        customerId: q.customer,
      });
    })

    // GET /v1/subscriptions/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // DELETE /v1/subscriptions/:id — cancel
    .delete("/:id", ({ params: { id } }) => {
      return service.cancel(id);
    });
}
