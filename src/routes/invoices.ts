import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { InvoiceService } from "../services/invoices";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

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
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
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
