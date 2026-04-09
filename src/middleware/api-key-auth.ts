import Elysia from "elysia";
import { authenticationError } from "../errors";

export const apiKeyAuth = new Elysia({ name: "api-key-auth" }).derive(
  { as: "global" },
  ({ request }) => {
    const url = new URL(request.url);

    // Skip auth for non-/v1/ routes
    if (!url.pathname.startsWith("/v1/")) {
      return {};
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/);
    const apiKey = match?.[1];

    if (!apiKey || !apiKey.startsWith("sk_test_")) {
      const err = authenticationError();
      throw new Response(JSON.stringify(err.body), {
        status: err.statusCode,
        headers: { "Content-Type": "application/json" },
      });
    }

    return { apiKey };
  },
);
