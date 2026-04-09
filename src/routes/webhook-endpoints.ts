import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { WebhookEndpointService } from "../services/webhook-endpoints";
import { parseStripeBody } from "../middleware/form-parser";
import { parseListParams } from "../lib/pagination";
import { StripeError } from "../errors";

export function webhookEndpointRoutes(db: StrimulatorDB) {
  const service = new WebhookEndpointService(db);

  return new Elysia({ prefix: "/v1/webhook_endpoints" })
    .onError(({ error, set }) => {
      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }
    })

    // POST /v1/webhook_endpoints — create
    .post("/", async ({ request }) => {
      const rawBody = await request.text();
      const params = parseStripeBody(rawBody);

      // enabled_events can come as enabled_events[] array from form encoding
      let enabledEvents: string[] = [];
      if (Array.isArray(params["enabled_events"])) {
        enabledEvents = params["enabled_events"] as string[];
      } else if (typeof params["enabled_events"] === "string") {
        enabledEvents = [params["enabled_events"]];
      }

      return service.create({
        url: params.url as string,
        enabled_events: enabledEvents,
        description: params.description as string | undefined,
        metadata: params.metadata as Record<string, string> | undefined,
      });
    })

    // GET /v1/webhook_endpoints/:id — retrieve
    .get("/:id", ({ params: { id } }) => {
      return service.retrieve(id);
    })

    // DELETE /v1/webhook_endpoints/:id — delete
    .delete("/:id", ({ params: { id } }) => {
      return service.del(id);
    })

    // GET /v1/webhook_endpoints — list
    .get("/", ({ query }) => {
      const listParams = parseListParams(query as Record<string, string | undefined>);
      return service.list(listParams);
    });
}
