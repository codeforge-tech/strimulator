import { describe, it, expect, beforeEach } from "bun:test";
import Elysia from "elysia";
import { createDB } from "../../../src/db";
import { idempotencyMiddleware } from "../../../src/middleware/idempotency";
import { apiKeyAuth } from "../../../src/middleware/api-key-auth";

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };

function buildApp() {
  const db = createDB(":memory:");
  let requestCount = 0;

  const app = new Elysia()
    .use(apiKeyAuth)
    .use(idempotencyMiddleware(db))
    .post("/v1/customers", () => {
      requestCount++;
      return { id: `cus_${requestCount}`, object: "customer", email: "test@example.com" };
    })
    .post("/v1/payment_intents", () => {
      requestCount++;
      return { id: `pi_${requestCount}`, object: "payment_intent", amount: 1000 };
    })
    .get("/v1/customers", () => {
      requestCount++;
      return { data: [], object: "list" };
    })
    .delete("/v1/customers/cus_1", () => {
      requestCount++;
      return { id: "cus_1", object: "customer", deleted: true };
    });

  return { app, getRequestCount: () => requestCount };
}

function postRequest(url: string, key?: string, body: string = "email=test%40example.com") {
  const headers: Record<string, string> = {
    ...AUTH_HEADER,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (key) headers["Idempotency-Key"] = key;
  return new Request(url, { method: "POST", headers, body });
}

describe("idempotency middleware", () => {
  // --- Basic POST with idempotency key ---

  it("POST with Idempotency-Key succeeds normally on first request", async () => {
    const { app } = buildApp();
    const res = await app.handle(postRequest("http://localhost/v1/customers", "key-001"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("cus_1");
    expect(body.object).toBe("customer");
  });

  it("first request creates the resource and caches response", async () => {
    const { app, getRequestCount } = buildApp();
    await app.handle(postRequest("http://localhost/v1/customers", "key-first"));
    expect(getRequestCount()).toBe(1);
  });

  // --- Same key returns cached response ---

  it("same key returns cached response without creating duplicate", async () => {
    const { app } = buildApp();
    const res1 = await app.handle(postRequest("http://localhost/v1/customers", "key-dupe"));
    const body1 = await res1.json();
    expect(body1.id).toBe("cus_1");

    const res2 = await app.handle(postRequest("http://localhost/v1/customers", "key-dupe"));
    const body2 = await res2.json();
    expect(body2.id).toBe("cus_1"); // same cached response
  });

  it("cached response has same status code", async () => {
    const { app } = buildApp();
    const res1 = await app.handle(postRequest("http://localhost/v1/customers", "key-status"));
    expect(res1.status).toBe(200);

    const res2 = await app.handle(postRequest("http://localhost/v1/customers", "key-status"));
    expect(res2.status).toBe(200);
  });

  it("cached response has same body", async () => {
    const { app } = buildApp();
    const res1 = await app.handle(postRequest("http://localhost/v1/customers", "key-body"));
    const body1 = await res1.json();

    const res2 = await app.handle(postRequest("http://localhost/v1/customers", "key-body"));
    const body2 = await res2.json();

    expect(body2).toEqual(body1);
  });

  it("handler is not invoked on cache hit", async () => {
    const { app, getRequestCount } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers", "key-count"));
    expect(getRequestCount()).toBe(1);

    await app.handle(postRequest("http://localhost/v1/customers", "key-count"));
    expect(getRequestCount()).toBe(1); // still 1, handler not called again
  });

  it("three requests with same key all return cached response", async () => {
    const { app } = buildApp();
    const key = "key-triple";

    const res1 = await app.handle(postRequest("http://localhost/v1/customers", key));
    const body1 = await res1.json();

    const res2 = await app.handle(postRequest("http://localhost/v1/customers", key));
    const body2 = await res2.json();

    const res3 = await app.handle(postRequest("http://localhost/v1/customers", key));
    const body3 = await res3.json();

    expect(body1.id).toBe("cus_1");
    expect(body2.id).toBe("cus_1");
    expect(body3.id).toBe("cus_1");
  });

  // --- Different key creates new response ---

  it("different key creates a new resource", async () => {
    const { app } = buildApp();

    const res1 = await app.handle(postRequest("http://localhost/v1/customers", "key-a"));
    const body1 = await res1.json();
    expect(body1.id).toBe("cus_1");

    const res2 = await app.handle(postRequest("http://localhost/v1/customers", "key-b"));
    const body2 = await res2.json();
    expect(body2.id).toBe("cus_2");
  });

  // --- Same key different path returns 400 ---

  it("same key with different path returns 400", async () => {
    const { app } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers", "key-path-conflict"));

    const res = await app.handle(
      postRequest("http://localhost/v1/payment_intents", "key-path-conflict", "amount=1000&currency=usd"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("idempotency_error");
    expect(body.error.message).toContain("same parameters");
  });

  it("path mismatch error includes correct code", async () => {
    const { app } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers", "key-code-check"));

    const res = await app.handle(
      postRequest("http://localhost/v1/payment_intents", "key-code-check", "amount=1000"),
    );
    const body = await res.json();
    expect(body.error.code).toBe("idempotency_key_reused");
  });

  // --- GET requests ignore idempotency ---

  it("GET requests ignore Idempotency-Key header", async () => {
    const { app } = buildApp();

    const res1 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: { ...AUTH_HEADER, "Idempotency-Key": "key-get" },
      }),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: { ...AUTH_HEADER, "Idempotency-Key": "key-get" },
      }),
    );
    expect(res2.status).toBe(200);
  });

  it("GET requests don't store idempotency keys", async () => {
    const { app, getRequestCount } = buildApp();

    await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: { ...AUTH_HEADER, "Idempotency-Key": "key-get-store" },
      }),
    );
    const count1 = getRequestCount();

    await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "GET",
        headers: { ...AUTH_HEADER, "Idempotency-Key": "key-get-store" },
      }),
    );
    const count2 = getRequestCount();

    // Both requests hit the handler (no caching for GET)
    expect(count2).toBe(count1 + 1);
  });

  // --- No key header = no caching ---

  it("POST without Idempotency-Key creates new resource each time", async () => {
    const { app } = buildApp();

    const res1 = await app.handle(postRequest("http://localhost/v1/customers"));
    const body1 = await res1.json();
    expect(body1.id).toBe("cus_1");

    const res2 = await app.handle(postRequest("http://localhost/v1/customers"));
    const body2 = await res2.json();
    expect(body2.id).toBe("cus_2");
  });

  it("POST without key always invokes the handler", async () => {
    const { app, getRequestCount } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers"));
    await app.handle(postRequest("http://localhost/v1/customers"));
    await app.handle(postRequest("http://localhost/v1/customers"));

    expect(getRequestCount()).toBe(3);
  });

  // --- Mixed scenarios ---

  it("keyed request followed by non-keyed request are independent", async () => {
    const { app } = buildApp();

    const res1 = await app.handle(postRequest("http://localhost/v1/customers", "key-mixed"));
    const body1 = await res1.json();
    expect(body1.id).toBe("cus_1");

    // Second request without key creates a new resource
    const res2 = await app.handle(postRequest("http://localhost/v1/customers"));
    const body2 = await res2.json();
    expect(body2.id).toBe("cus_2");
  });

  it("multiple different keys produce different resources", async () => {
    const { app } = buildApp();

    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.handle(postRequest("http://localhost/v1/customers", `key-multi-${i}`));
      const body = await res.json();
      results.push(body.id);
    }

    // All different
    const unique = new Set(results);
    expect(unique.size).toBe(5);
  });

  // --- Non-/v1/ routes skip idempotency ---

  it("non-/v1/ POST routes skip idempotency processing", async () => {
    const db = createDB(":memory:");
    const app = new Elysia()
      .use(idempotencyMiddleware(db))
      .post("/other", () => ({ ok: true }));

    const res = await app.handle(
      new Request("http://localhost/other", {
        method: "POST",
        headers: { "Idempotency-Key": "key-other", "Content-Type": "application/x-www-form-urlencoded" },
        body: "x=1",
      }),
    );
    expect(res.status).toBe(200);
  });

  // --- Cached response content type ---

  it("cached response Content-Type is application/json", async () => {
    const { app } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers", "key-ct"));

    const res = await app.handle(postRequest("http://localhost/v1/customers", "key-ct"));
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  // --- Concurrent-safe key storage ---

  it("two sequential requests with same key only process handler once", async () => {
    const { app, getRequestCount } = buildApp();

    await app.handle(postRequest("http://localhost/v1/customers", "key-seq"));
    await app.handle(postRequest("http://localhost/v1/customers", "key-seq"));

    expect(getRequestCount()).toBe(1);
  });
});
