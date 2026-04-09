import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { CustomerService } from "../services/customers";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function customerRoutes(db: StrimulatorDB) {
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
      return service.create(params);
    })

    // GET /v1/customers — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    })

    // GET /v1/customers/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/customers/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      return service.update(id, params);
    })

    // DELETE /v1/customers/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      return service.del(id);
    });
}
