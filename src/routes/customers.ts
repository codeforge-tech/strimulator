import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { CustomerService } from "../services/customers";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function customerRoutes(db: StrimulatorDB, eventService?: EventService) {
  const service = new CustomerService(db);

  return new Elysia({ prefix: "/v1/customers" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/customers — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const customer = service.create(params);
      eventService?.emit("customer.created", customer as unknown as Record<string, unknown>);
      return customer;
    })

    // GET /v1/customers — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    })

    // GET /v1/customers/search — search (MUST be before /:id)
    .get("/search", async ({ request }) => {
      const url = new URL(request.url);
      const query = url.searchParams.get("query") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
      return service.search(query, limit);
    })

    // GET /v1/customers/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/customers/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      const updated = service.update(id, params);
      eventService?.emit("customer.updated", updated as unknown as Record<string, unknown>);
      return updated;
    })

    // DELETE /v1/customers/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      const deleted = service.del(id);
      eventService?.emit("customer.deleted", deleted as unknown as Record<string, unknown>);
      return deleted;
    });
}
