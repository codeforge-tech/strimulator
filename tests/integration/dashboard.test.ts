import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createDB, getRawSqlite } from "../../src/db";
import { dashboardServer } from "../../src/dashboard/server";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia().use(dashboardServer(db));
}

function createTestAppWithData() {
  const db = createDB(":memory:");
  const sqlite = getRawSqlite(db);

  const now = Math.floor(Date.now() / 1000);
  const customer = {
    id: "cus_test123",
    object: "customer",
    email: "test@example.com",
    name: "Test User",
    created: now,
    livemode: false,
    deleted: false,
  };
  sqlite.query(
    `INSERT INTO customers (id, email, name, deleted, created, data) VALUES (?, ?, ?, 0, ?, ?)`
  ).run(customer.id, customer.email, customer.name, customer.created, JSON.stringify(customer));

  const app = new Elysia().use(dashboardServer(db));
  return { app, customer };
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

describe("Dashboard Resource Explorer API", () => {
  it("GET /dashboard/api/resources/customers returns list shape with empty db", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/customers"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
    expect(body.total).toBe(0);
  });

  it("GET /dashboard/api/resources/customers returns customer records", async () => {
    const { app, customer } = createTestAppWithData();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/customers"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body.total).toBe(1);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(customer.id);
    expect(body.data[0].email).toBe(customer.email);
  });

  it("GET /dashboard/api/resources/customers respects limit and offset", async () => {
    const { app } = createTestAppWithData();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/customers?limit=5&offset=0"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
  });

  it("GET /dashboard/api/resources/customers/:id returns single customer", async () => {
    const { app, customer } = createTestAppWithData();
    const res = await app.handle(
      new Request(`http://localhost/dashboard/api/resources/customers/${customer.id}`),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body.id).toBe(customer.id);
    expect(body.email).toBe(customer.email);
    expect(body.object).toBe("customer");
  });

  it("GET /dashboard/api/resources/customers/:id returns 404 for unknown id", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/customers/cus_doesnotexist"),
    );

    expect(res.status).toBe(404);
  });

  it("GET /dashboard/api/resources/:type returns 404 for unknown resource type", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/foobar"),
    );

    expect(res.status).toBe(404);
  });

  it("GET /dashboard/api/resources/:type/:id returns 404 for unknown resource type", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/foobar/some_id"),
    );

    expect(res.status).toBe(404);
  });

  it("GET /dashboard/api/resources/payment_intents returns list shape", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/dashboard/api/resources/payment_intents"),
    );

    expect(res.status).toBe(200);
    const body = await jsonResponse(res);
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.data)).toBe(true);
  });
});
