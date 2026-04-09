import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { dashboardServer } from "../../src/dashboard/server";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia().use(dashboardServer(db));
}

async function textResponse(res: Response) {
  return res.text();
}

async function jsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("Dashboard Routes", () => {
  it("GET /dashboard returns 200 with HTML containing 'Strimulator'", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard"),
    );

    expect(res.status).toBe(200);
    const body = await textResponse(res);
    expect(body).toContain("Strimulator");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("GET /dashboard does NOT require Authorization header", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard"),
      // No Authorization header
    );

    expect(res.status).toBe(200);
  });

  it("GET /dashboard/api/stats returns 200 with expected keys", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/stats"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body).toHaveProperty("customers");
    expect(body).toHaveProperty("payment_intents");
    expect(body).toHaveProperty("subscriptions");
    expect(body).toHaveProperty("invoices");
    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("webhook_endpoints");
    expect(typeof body.customers).toBe("number");
    expect(typeof body.payment_intents).toBe("number");
    expect(typeof body.subscriptions).toBe("number");
    expect(typeof body.invoices).toBe("number");
    expect(typeof body.events).toBe("number");
    expect(typeof body.webhook_endpoints).toBe("number");
  });

  it("GET /dashboard/api/stats does NOT require Authorization header", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/stats"),
    );

    expect(res.status).toBe(200);
  });

  it("GET /dashboard/api/requests returns 200 with array", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/requests"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /dashboard/api/requests does NOT require Authorization header", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/requests"),
    );

    expect(res.status).toBe(200);
  });

  it("GET /dashboard/api/stats returns zero counts for empty database", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/stats"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body.customers).toBe(0);
    expect(body.payment_intents).toBe(0);
    expect(body.subscriptions).toBe(0);
    expect(body.invoices).toBe(0);
    expect(body.events).toBe(0);
    expect(body.webhook_endpoints).toBe(0);
  });
});
