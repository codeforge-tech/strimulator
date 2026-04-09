import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ProductService } from "../services/products";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function productRoutes(db: StrimulatorDB) {
  const service = new ProductService(db);

  return new Elysia({ prefix: "/v1/products" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/products — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      // Convert active from string to boolean if needed
      if (typeof params.active === "string") {
        params.active = params.active !== "false";
      }
      return service.create(params);
    })

    // GET /v1/products — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    })

    // GET /v1/products/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/products/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      // Convert active from string to boolean if needed
      if (typeof params.active === "string") {
        params.active = params.active !== "false";
      }
      return service.update(id, params);
    })

    // DELETE /v1/products/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      return service.del(id);
    });
}
