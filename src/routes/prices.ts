import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { PriceService } from "../services/prices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function priceRoutes(db: StrimulatorDB) {
  const service = new PriceService(db);

  return new Elysia({ prefix: "/v1/prices" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/prices — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      // Convert active from string to boolean if needed
      if (typeof params.active === "string") {
        params.active = params.active !== "false";
      }
      // Convert unit_amount from string to number if needed
      if (typeof params.unit_amount === "string") {
        params.unit_amount = parseInt(params.unit_amount, 10);
      }
      // Convert recurring.interval_count from string to number if needed
      if (params.recurring && typeof params.recurring.interval_count === "string") {
        params.recurring.interval_count = parseInt(params.recurring.interval_count, 10);
      }
      return service.create(params);
    })

    // GET /v1/prices — list
    .get("/", ({ query }) => {
      const q = query as Record<string, string | undefined>;
      const listParams = parseListParams(q);
      return service.list({ ...listParams, product: q.product });
    })

    // GET /v1/prices/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/prices/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);
      // Convert active from string to boolean if needed
      if (typeof params.active === "string") {
        params.active = params.active !== "false";
      }
      return service.update(id, params);
    });
}
