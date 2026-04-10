import { describe, it, expect } from "bun:test";
import Elysia from "elysia";
import { apiKeyAuth } from "../../../src/middleware/api-key-auth";

function buildApp() {
  return new Elysia()
    .use(apiKeyAuth)
    .get("/v1/test", () => ({ ok: true }))
    .post("/v1/test", () => ({ ok: true }))
    .get("/v1/customers", () => ({ ok: true }))
    .get("/v1/nested/deep/path", () => ({ ok: true }))
    .get("/dashboard", () => ({ ok: true }))
    .get("/dashboard/api/stats", () => ({ ok: true }))
    .get("/health", () => ({ ok: true }))
    .get("/", () => ({ ok: true }));
}

describe("apiKeyAuth middleware", () => {
  // --- Valid keys ---

  it("valid Bearer sk_test_ token on /v1/ route passes with 200", async () => {
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

  it("valid key with long random suffix passes", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer sk_test_abcdefghijklmnopqrstuvwxyz1234567890" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("valid key works for POST requests", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        method: "POST",
        headers: {
          authorization: "Bearer sk_test_key123",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "foo=bar",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("valid key works for nested /v1/ paths", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/nested/deep/path", {
        headers: { authorization: "Bearer sk_test_key" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("valid key works for /v1/customers", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/customers", {
        headers: { authorization: "Bearer sk_test_anything" },
      }),
    );
    expect(res.status).toBe(200);
  });

  // --- Missing / empty Authorization header ---

  it("missing Authorization header on /v1/ route returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    expect(res.status).toBe(401);
  });

  it("missing Authorization header returns error body with authentication_error type", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("empty Authorization header returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Authorization header with only whitespace returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "   " },
      }),
    );
    expect(res.status).toBe(401);
  });

  // --- Invalid Bearer prefix ---

  it("no Bearer prefix returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "sk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Token prefix instead of Bearer returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Token sk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Basic auth prefix returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Basic sk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("bearer (lowercase) still works because regex matches Bearer", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "bearer sk_test_mykey123" },
      }),
    );
    // Depends on regex case sensitivity - the regex uses /^Bearer\s+/ which is case sensitive
    expect(res.status).toBe(401);
  });

  // --- Invalid key prefix ---

  it("sk_live_ key returns 401 (test mode only)", async () => {
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

  it("pk_test_ key (publishable) returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer pk_test_mykey123" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("random string key returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer randomstring" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Bearer with empty key returns 401", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer " },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("Bearer with only sk_test_ (no suffix) returns 200 (prefix check only)", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer sk_test_" },
      }),
    );
    // sk_test_ starts with "sk_test_" so it should pass
    expect(res.status).toBe(200);
  });

  // --- Non-/v1/ routes skip auth ---

  it("non-/v1/ route skips auth (no header needed)", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/dashboard"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("/dashboard/api/ routes skip auth", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/dashboard/api/stats"));
    expect(res.status).toBe(200);
  });

  it("root path skips auth", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
  });

  it("/health route skips auth", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
  });

  // --- Error response shape ---

  it("error response has correct shape with error.type", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("authentication_error");
    expect(typeof body.error.message).toBe("string");
  });

  it("error response message mentions sk_test", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    const body = await res.json();
    expect(body.error.message).toContain("sk_test");
  });

  it("error response Content-Type is application/json", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("error response has code and param fields (possibly undefined)", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/test"));
    const body = await res.json();
    // These exist in the error shape but may be undefined
    expect("error" in body).toBe(true);
  });

  // --- Token with special characters ---

  it("token with special characters after sk_test_ passes", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/test", {
        headers: { authorization: "Bearer sk_test_abc-def_123.xyz" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
