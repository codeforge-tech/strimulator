import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { TestClockService } from "../services/test-clocks";
import { EventService } from "../services/events";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError, invalidRequestError } from "../errors";

export function testClockRoutes(db: StrimulatorDB, eventService?: EventService) {
  const invoiceService = new InvoiceService(db);
  const priceService = new PriceService(db);
  const service = new TestClockService(db, eventService, invoiceService, priceService);

  return new Elysia({ prefix: "/v1/test_helpers/test_clocks" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/test_helpers/test_clocks — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (!params.frozen_time) {
        throw invalidRequestError("Missing required param: frozen_time.", "frozen_time");
      }

      const frozenTime = parseInt(params.frozen_time as string, 10);
      if (isNaN(frozenTime)) {
        throw invalidRequestError("frozen_time must be a Unix timestamp.", "frozen_time");
      }

      return service.create({
        frozen_time: frozenTime,
        name: params.name as string | undefined,
      });
    })

    // GET /v1/test_helpers/test_clocks/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // POST /v1/test_helpers/test_clocks/:id/advance — advance frozen time
    .post("/:id/advance", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      if (!params.frozen_time) {
        throw invalidRequestError("Missing required param: frozen_time.", "frozen_time");
      }

      const frozenTime = parseInt(params.frozen_time as string, 10);
      if (isNaN(frozenTime)) {
        throw invalidRequestError("frozen_time must be a Unix timestamp.", "frozen_time");
      }

      return service.advance(id, frozenTime);
    })

    // DELETE /v1/test_helpers/test_clocks/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      return service.del(id);
    })

    // GET /v1/test_helpers/test_clocks — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    });
}
