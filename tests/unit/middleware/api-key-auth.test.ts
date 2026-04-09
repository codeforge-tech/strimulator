import { describe, test, expect } from "bun:test";
import Elysia from "elysia";
import { apiKeyAuth } from "../../../src/middleware/api-key-auth";

function buildApp() {
  return new Elysia()
    .use(apiKeyAuth)
    .get("/v1/test", () => ({ ok: true }))
    .get("/dashboard", () => ({ ok: true }));
}

describe("apiKeyAuth middleware", () => {
  test("valid sk_test_ key on /v1/ route passes", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer sk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("missing Authorization header on /v1/ route returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("non-sk_test_ key on /v1/ route returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer sk_live_somethingelse" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("invalid Bearer format on /v1/ route returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Token sk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("non-/v1/ route skips auth entirely", async () => {
    const app = buildApp();
    // No Authorization header but /dashboard should still succeed
    const res = await app.handle(new Request("http://localhost/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
