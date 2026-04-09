import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { InvoiceService } from "../services/invoices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function invoiceRoutes(db: StrimulatorDB) {
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

      return service.create(params);
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
      return service.finalizeInvoice(id);
    })

    // POST /v1/invoices/:id/pay — pay
    .post("/:id/pay", ({ params: { id } }) => {
      return service.pay(id);
    })

    // POST /v1/invoices/:id/void — void
    .post("/:id/void", ({ params: { id } }) => {
      return service.voidInvoice(id);
    });
}
