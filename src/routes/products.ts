import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { ProductService } from "../services/products";
import { EventService } from "../services/events";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function productRoutes(db: StrimulatorDB, eventService?: EventService) {
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
      const product = service.create(params);
      eventService?.emit("product.created", product as unknown as Record<string, unknown>);
      return product;
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
      const updated = service.update(id, params);
      eventService?.emit("product.updated", updated as unknown as Record<string, unknown>);
      return updated;
    })

    // DELETE /v1/products/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      const deleted = service.del(id);
      eventService?.emit("product.deleted", deleted as unknown as Record<string, unknown>);
      return deleted;
    });
}
