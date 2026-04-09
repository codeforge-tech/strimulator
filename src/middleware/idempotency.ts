import Elysia from "elysia";
import { type StrimulatorDB } from "../db";
import { idempotencyKeys } from "../db/schema/idempotency-keys";
import { eq } from "drizzle-orm";

export function idempotencyMiddleware(db: StrimulatorDB) {
  return new Elysia({ name: "idempotency" })
    .state("idempotencyKey", null as string | null)
    .onBeforeHandle({ as: "global" }, async ({ request, set, store }) => {
      // Only handle POST requests to /v1/*
      if (request.method !== "POST") return;
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/v1/")) return;

      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey) return;

      // Store key in state for afterHandle
      store.idempotencyKey = idempotencyKey;

      // Look up existing record
      const existing = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .get();

      if (!existing) return;

      // Key exists: check if path matches
      if (existing.apiPath !== url.pathname) {
        set.status = 400;
        return {
          error: {
            type: "idempotency_error",
            message:
              "Keys for idempotent requests can only be used with the same parameters they were first used with.",
            code: "idempotency_key_reused",
            param: undefined,
          },
        };
      }

      // Path matches: return cached response
      return new Response(existing.responseBody, {
        status: existing.responseCode,
        headers: { "Content-Type": "application/json" },
      });
    })
    .onAfterHandle({ as: "global" }, async ({ request, response, store, set }) => {
      // Only handle POST requests to /v1/*
      if (request.method !== "POST") return;
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/v1/")) return;

      const idempotencyKey = store.idempotencyKey;
      if (!idempotencyKey) return;

      // Only cache if response is available and we can determine status
      if (!response) return;

      let statusCode: number;
      let body: string;

      if (response instanceof Response) {
        statusCode = response.status;
        // Clone so we don't consume the body
        body = await response.clone().text();
      } else if (typeof response === "object" || typeof response === "string") {
        statusCode = (set.status as number) ?? 200;
        body = typeof response === "string" ? response : JSON.stringify(response);
      } else {
        return;
      }

      // Only cache 2xx responses
      if (statusCode < 200 || statusCode >= 300) return;

      // Check if already stored (don't overwrite on race condition)
      const existing = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .get();

      if (existing) return;

      await db.insert(idempotencyKeys).values({
        key: idempotencyKey,
        apiPath: url.pathname,
        method: request.method,
        responseCode: statusCode,
        responseBody: body,
        created: Math.floor(Date.now() / 1000),
      });
    });
}
