import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { InvoiceService } from "../services/invoices";
import { CustomerService } from "../services/customers";
import { SubscriptionService } from "../services/subscriptions";
import { PriceService } from "../services/prices";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { PaymentIntentService } from "../services/payment-intents";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { applyExpand, type ExpandConfig } from "../lib/expand";
import { StripeError } from "../errors";

const invoiceExpandConfig: ExpandConfig = {
  customer: { resolve: (id, db) => new CustomerService(db).retrieve(id) },
  subscription: {
    resolve: (id, db) => {
      const invoiceService = new InvoiceService(db);
      const priceService = new PriceService(db);
      return new SubscriptionService(db, invoiceService, priceService).retrieve(id);
    },
  },
  payment_intent: {
    resolve: (id, db) =>
      new PaymentIntentService(db, new ChargeService(db), new PaymentMethodService(db)).retrieve(id),
  },
};

export function invoiceRoutes(db: StrimulatorDB, eventService?: EventService) {
  const service = new InvoiceService(db);

  return new Elysia({ prefix: "/v1/invoices" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/invoices — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (typeof params.amount_due === "string") {
        params.amount_due = parseInt(params.amount_due, 10);
      }

      const invoice = service.create(params);
      eventService?.emit("invoice.created", invoice as unknown as Record<string, unknown>);
      return invoice;
    })

    // GET /v1/invoices — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({
        ...listParams,
        customerId: q.customer,
        subscriptionId: q.subscription,
      });
    })

    // GET /v1/invoices/:id — retrieve
    .get("/:id", async ({ params: { id }, request }) => {
      const url = new URL(request.url);
      const expand = url.searchParams.getAll("expand[]");
      let result: any = service.retrieve(id);
      if (expand.length) {
        result = await applyExpand(result, expand, invoiceExpandConfig, db);
      }
      return result;
    })

    // POST /v1/invoices/:id/finalize — finalize
    .post("/:id/finalize", ({ params: { id } }) => {
      const finalized = service.finalizeInvoice(id);
      eventService?.emit("invoice.finalized", finalized as unknown as Record<string, unknown>);
      return finalized;
    })

    // POST /v1/invoices/:id/pay — pay
    .post("/:id/pay", ({ params: { id } }) => {
      const paid = service.pay(id);
      eventService?.emit("invoice.paid", paid as unknown as Record<string, unknown>);
      return paid;
    })

    // POST /v1/invoices/:id/void — void
    .post("/:id/void", ({ params: { id } }) => {
      return service.voidInvoice(id);
    });
}
