import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { SubscriptionService } from "../services/subscriptions";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
import { CustomerService } from "../services/customers";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { PaymentIntentService } from "../services/payment-intents";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { applyExpand, type ExpandConfig } from "../lib/expand";
import { StripeError } from "../errors";

const subscriptionExpandConfig: ExpandConfig = {
  customer: { resolve: (id, db) => new CustomerService(db).retrieve(id) },
  latest_invoice: {
    resolve: (id, db) => new InvoiceService(db).retrieve(id),
    nested: {
      payment_intent: {
        resolve: (id, db) =>
          new PaymentIntentService(db, new ChargeService(db), new PaymentMethodService(db)).retrieve(id),
      },
    },
  },
};

export function subscriptionRoutes(db: StrimulatorDB, eventService?: EventService) {
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

      const sub = service.create(params as any);
      eventService?.emit("customer.subscription.created", sub as unknown as Record<string, unknown>);
      return sub;
    })

    // POST /v1/subscriptions/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const body = parseStripeBody(rawBody);

      if (Array.isArray(body.items)) {
        body.items = body.items.map((item: any) => ({
          ...item,
          quantity: item.quantity !== undefined ? parseInt(item.quantity, 10) : undefined,
        }));
      }

      if (body.cancel_at_period_end !== undefined) {
        body.cancel_at_period_end = body.cancel_at_period_end === "true" || body.cancel_at_period_end === true;
      }

      if (body.trial_end !== undefined && body.trial_end !== "now") {
        body.trial_end = parseInt(body.trial_end as string, 10);
      }

      const updated = service.update(id, body as any, eventService);
      return updated;
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

    // GET /v1/subscriptions/search — search (MUST be before /:id)
    .get("/search", async ({ request }) => {
      const url = new URL(request.url);
      const query = url.searchParams.get("query") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
      return service.search(query, limit);
    })

    // GET /v1/subscriptions/:id — retrieve
    .get("/:id", async ({ params: { id }, request }) => {
      const url = new URL(request.url);
      const expand = url.searchParams.getAll("expand[]");
      let result: any = service.retrieve(id);
      if (expand.length) {
        result = await applyExpand(result, expand, subscriptionExpandConfig, db);
      }
      return result;
    })

    // DELETE /v1/subscriptions/:id — cancel
    .delete("/:id", ({ params: { id } }) => {
      const canceled = service.cancel(id);
      eventService?.emit("customer.subscription.deleted", canceled as unknown as Record<string, unknown>);
      return canceled;
    });
}
