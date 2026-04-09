import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { EventService } from "../services/events";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function eventRoutes(db: StrimulatorDB) {
  const service = new EventService(db);

  return new Elysia({ prefix: "/v1/events" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // GET /v1/events/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // GET /v1/events — list (with optional type filter)
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      const type = (query as Record<string, string | undefined>).type;
      return service.list({ ...listParams, type });
    });
}
