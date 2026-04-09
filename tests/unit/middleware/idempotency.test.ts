import { describe, test, expect, beforeEach } from "bun:test";
import Elysia from "elysia";
import { createDB } from "../../../src/db";
import { idempotencyMiddleware } from "../../../src/middleware/idempotency";
import { apiKeyAuth } from "../../../src/middleware/api-key-auth";

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };

function buildApp() {
  const db = createDB(":memory:");
  let requestCount = 0;

  return new Elysia()
    .use(apiKeyAuth)
    .use(idempotencyMiddleware(db))
    .post("/v1/customers", () => {
      requestCount++;
      return { id: `cus_${requestCount}`, object: "customer", email: "test@example.com" };
    })
    .post("/v1/payment_intents", () => {
      requestCount++;
      return { id: `pi_${requestCount}`, object: "payment_intent" };
    })
    .get("/v1/customers", () => {
      requestCount++;
      return { data: [], object: "list" };
    })
    .decorate("getRequestCount", () => requestCount);
}

describe("idempotency middleware", () => {
  test("POST with Idempotency-Key succeeds normally on first request", async () => {
    const app = buildApp();

    const res = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-001",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=test%40example.com",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("cus_1");
    expect(body.object).toBe("customer");
  });

  test("POST with same Idempotency-Key returns cached response without creating duplicate", async () => {
    const app = buildApp();

    const req1 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-dupe-test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=test%40example.com",
      }),
    );
    expect(req1.status).toBe(200);
    const body1 = await req1.json();
    expect(body1.id).toBe("cus_1");

    // Second request with same key — should return the exact same response
    const req2 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-dupe-test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=test%40example.com",
      }),
    );
    expect(req2.status).toBe(200);
    const body2 = await req2.json();
    // Must be the same cached id — not cus_2
    expect(body2.id).toBe("cus_1");
  });

  test("POST with same Idempotency-Key but different path returns 400 error", async () => {
    const app = buildApp();

    // First use key on /v1/customers
    await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-path-conflict",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=test%40example.com",
      }),
    );

    // Second request with same key but different path
    const res = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-path-conflict",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "amount=1000&currency=usd",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("same parameters");
  });

  test("POST without Idempotency-Key works normally without caching", async () => {
    const app = buildApp();

    const res1 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=test%40example.com",
      }),
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.id).toBe("cus_1");

    const res2 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "email=other%40example.com",
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    // No caching — each request gets a new ID
    expect(body2.id).toBe("cus_2");
  });

  test("GET requests ignore Idempotency-Key header (no caching)", async () => {
    const app = buildApp();

    const res1 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-get-test",
        },
      }),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: {
          ...AUTH_HEADER,
          "Idempotency-Key": "key-get-test",
        },
      }),
    );
    expect(res2.status).toBe(200);
    // Both succeed without any idempotency interference
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.object).toBe("list");
    expect(body2.object).toBe("list");
  });
});
