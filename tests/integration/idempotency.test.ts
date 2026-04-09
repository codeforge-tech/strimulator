import { describe, it, expect } from "bun:test";
import { createApp } from "../../src/app";
import { createDB } from "../../src/db";
import { eq } from "drizzle-orm";

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };

async function jsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("Idempotency Integration", () => {
  it("creates customer with Idempotency-Key — second request returns same customer (same ID)", async () => {
    const db = createDB(":memory:");
    const app = createApp(db);

    const res1 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "integ-key-001",
        },
        body: "email=idempotent%40example.com&name=Alice",
      }),
    );

    expect(res1.status).toBe(200);
    const body1 = await jsonResponse(res1);
    expect(body1.id).toMatch(/^cus_/);
    const customerId = body1.id;

    // Second request with same key
    const res2 = await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "integ-key-001",
        },
        body: "email=idempotent%40example.com&name=Alice",
      }),
    );

    expect(res2.status).toBe(200);
    const body2 = await jsonResponse(res2);
    // Must be the same customer ID
    expect(body2.id).toBe(customerId);
  });

  it("verifies only one customer exists in DB after duplicate idempotent request", async () => {
    const db = createDB(":memory:");
    const app = createApp(db);

    // Make two POST requests with the same idempotency key
    await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "integ-dedup-key",
        },
        body: "email=dedup%40example.com&name=Bob",
      }),
    );

    await app.handle(
      new Request("http://localhost/v1/customers", {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "integ-dedup-key",
        },
        body: "email=dedup%40example.com&name=Bob",
      }),
    );

    // Query DB to check that only one customer exists
    const { customers } = await import("../../src/db/schema/customers");
    const allCustomers = await db.select().from(customers).all();
    expect(allCustomers.length).toBe(1);
    expect(allCustomers[0].email).toBe("dedup@example.com");
  });
});
