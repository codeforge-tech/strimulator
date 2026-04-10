import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;

beforeEach(() => {
  app = createApp();
  app.listen(0);
  const port = app.server!.port;
  stripe = new Stripe("sk_test_strimulator", {
    host: "localhost",
    port,
    protocol: "http",
  } as any);
});

afterEach(() => {
  app.server?.stop();
});

// ---------------------------------------------------------------------------
// Helper: raw fetch with custom auth header
// ---------------------------------------------------------------------------
async function rawRequest(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body,
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ===========================================================================
// AUTHENTICATION ERRORS
// ===========================================================================
describe("Authentication errors", () => {
  test("no API key returns 401", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers");

    expect(status).toBe(401);
    expect(body.error.type).toBe("authentication_error");
  });

  test("invalid API key format returns 401", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers", {
      headers: { Authorization: "Bearer invalid_key_123" },
    });

    expect(status).toBe(401);
    expect(body.error.type).toBe("authentication_error");
  });

  test("sk_live_ key in test mode returns 401", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers", {
      headers: { Authorization: "Bearer sk_live_realkey123" },
    });

    expect(status).toBe(401);
    expect(body.error.type).toBe("authentication_error");
  });

  test("public key (pk_test_) returns 401", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers", {
      headers: { Authorization: "Bearer pk_test_abc123" },
    });

    expect(status).toBe(401);
    expect(body.error.type).toBe("authentication_error");
  });

  test("verify error shape includes type and message", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers");

    expect(status).toBe(401);
    expect(body).toHaveProperty("error");
    expect(body.error).toHaveProperty("type");
    expect(body.error).toHaveProperty("message");
    expect(body.error.type).toBe("authentication_error");
    expect(typeof body.error.message).toBe("string");
  });

  test("auth error on POST endpoint too", async () => {
    const { status, body } = await rawRequest(app.server!.port, "/v1/customers", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=test@test.com",
    });

    expect(status).toBe(401);
    expect(body.error.type).toBe("authentication_error");
  });
});

// ===========================================================================
// RESOURCE NOT FOUND (404)
// ===========================================================================
describe("Resource not found (404)", () => {
  test("retrieve non-existent customer returns 404 with resource_missing", async () => {
    try {
      await stripe.customers.retrieve("cus_nonexistent");
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.type).toBe("StripeInvalidRequestError");
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent payment intent returns 404", async () => {
    try {
      await stripe.paymentIntents.retrieve("pi_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent product returns 404", async () => {
    try {
      await stripe.products.retrieve("prod_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent price returns 404", async () => {
    try {
      await stripe.prices.retrieve("price_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent subscription returns 404", async () => {
    try {
      await stripe.subscriptions.retrieve("sub_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent invoice returns 404", async () => {
    try {
      await stripe.invoices.retrieve("in_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("retrieve non-existent event returns 404", async () => {
    try {
      await stripe.events.retrieve("evt_nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.code).toBe("resource_missing");
    }
  });

  test("404 error message contains the resource ID", async () => {
    try {
      await stripe.customers.retrieve("cus_does_not_exist_123");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain("cus_does_not_exist_123");
    }
  });
});

// ===========================================================================
// VALIDATION ERRORS
// ===========================================================================
describe("Validation errors", () => {
  test("create payment intent without amount errors", async () => {
    try {
      await stripe.paymentIntents.create({ amount: undefined as any, currency: "usd" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
    }
  });

  test("create payment intent without currency errors", async () => {
    try {
      await stripe.paymentIntents.create({ amount: 1000, currency: undefined as any });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
    }
  });

  test("create payment intent with amount=0 errors", async () => {
    try {
      await stripe.paymentIntents.create({ amount: 0, currency: "usd" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("Amount");
    }
  });

  test("create subscription without customer errors", async () => {
    try {
      await stripe.subscriptions.create({
        customer: undefined as any,
        items: [{ price: "price_123" }],
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
    }
  });

  test("create subscription without items errors", async () => {
    try {
      await stripe.subscriptions.create({
        customer: "cus_123",
        items: [] as any,
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
    }
  });

  test("create price without product errors", async () => {
    try {
      await stripe.prices.create({
        product: undefined as any,
        unit_amount: 1000,
        currency: "usd",
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("product");
    }
  });

  test("create price without currency errors", async () => {
    try {
      await stripe.prices.create({
        product: "prod_123",
        unit_amount: 1000,
        currency: undefined as any,
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("currency");
    }
  });

  test("confirm payment intent without payment method errors", async () => {
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });
    expect(pi.status).toBe("requires_payment_method");

    try {
      await stripe.paymentIntents.confirm(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("payment method");
    }
  });

  test("create product without name errors", async () => {
    try {
      await stripe.products.create({ name: undefined as any });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("name");
    }
  });

  test("delete non-existent customer returns 404", async () => {
    try {
      await stripe.customers.del("cus_nonexistent_del");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("resource_missing");
    }
  });
});

// ===========================================================================
// STATE TRANSITION ERRORS
// ===========================================================================
describe("State transition errors", () => {
  test("capture PI that is not requires_capture errors", async () => {
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });
    expect(pi.status).toBe("requires_payment_method");

    try {
      await stripe.paymentIntents.capture(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("requires_payment_method");
    }
  });

  test("cancel succeeded PI errors", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });
    expect(pi.status).toBe("succeeded");

    try {
      await stripe.paymentIntents.cancel(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("succeeded");
    }
  });

  test("confirm canceled PI errors", async () => {
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });
    await stripe.paymentIntents.cancel(pi.id);

    try {
      await stripe.paymentIntents.confirm(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("canceled");
    }
  });

  test("finalize already-open invoice errors", async () => {
    const customer = await stripe.customers.create({ email: "finalize@test.com" });
    const invoice = await stripe.invoices.create({ customer: customer.id });

    // First finalize succeeds
    await stripe.invoices.finalizeInvoice(invoice.id);

    // Second finalize should fail because status is now "open"
    try {
      await stripe.invoices.finalizeInvoice(invoice.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("open");
    }
  });

  test("pay already-paid invoice errors", async () => {
    const customer = await stripe.customers.create({ email: "pay@test.com" });
    const invoice = await stripe.invoices.create({ customer: customer.id });

    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.pay(invoice.id);

    try {
      await stripe.invoices.pay(invoice.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("paid");
    }
  });

  test("void paid invoice errors (only open invoices can be voided)", async () => {
    const customer = await stripe.customers.create({ email: "void@test.com" });
    const invoice = await stripe.invoices.create({ customer: customer.id });

    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.pay(invoice.id);

    try {
      await stripe.invoices.voidInvoice(invoice.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.rawType).toBe("invalid_request_error");
      expect(err.message).toContain("paid");
    }
  });

  test("state error includes current status in message", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });

    try {
      await stripe.paymentIntents.capture(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      // PI is "succeeded", which is not capturable
      expect(err.message).toContain("succeeded");
    }
  });

  test("state error type is invalid_request_error", async () => {
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });

    try {
      await stripe.paymentIntents.capture(pi.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.rawType).toBe("invalid_request_error");
    }
  });
});

// ===========================================================================
// IDEMPOTENCY BEHAVIOR
// ===========================================================================
describe("Idempotency behavior", () => {
  test("create customer with idempotency key returns customer", async () => {
    const customer = await stripe.customers.create(
      { email: "idempotent@test.com" },
      { idempotencyKey: "idem-create-1" },
    );

    expect(customer.id).toMatch(/^cus_/);
    expect(customer.email).toBe("idempotent@test.com");
  });

  test("same idempotency key returns same customer (same ID)", async () => {
    const key = "idem-same-key-test";

    const first = await stripe.customers.create(
      { email: "first@test.com", name: "First" },
      { idempotencyKey: key },
    );

    const second = await stripe.customers.create(
      { email: "first@test.com", name: "First" },
      { idempotencyKey: key },
    );

    expect(second.id).toBe(first.id);
  });

  test("different idempotency key creates new customer", async () => {
    const first = await stripe.customers.create(
      { email: "diff1@test.com" },
      { idempotencyKey: "idem-diff-1" },
    );

    const second = await stripe.customers.create(
      { email: "diff2@test.com" },
      { idempotencyKey: "idem-diff-2" },
    );

    expect(second.id).not.toBe(first.id);
  });

  test("idempotency works for payment intent creation too", async () => {
    const key = "idem-pi-test";

    const first = await stripe.paymentIntents.create(
      { amount: 1000, currency: "usd" },
      { idempotencyKey: key },
    );

    const second = await stripe.paymentIntents.create(
      { amount: 1000, currency: "usd" },
      { idempotencyKey: key },
    );

    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(first.amount);
  });

  test("idempotent response matches original exactly", async () => {
    const key = "idem-exact-match";

    const first = await stripe.customers.create(
      { email: "exact@test.com", name: "Exact Match", metadata: { tier: "gold" } },
      { idempotencyKey: key },
    );

    const second = await stripe.customers.create(
      { email: "exact@test.com", name: "Exact Match", metadata: { tier: "gold" } },
      { idempotencyKey: key },
    );

    expect(second.id).toBe(first.id);
    expect(second.email).toBe(first.email);
    expect(second.name).toBe(first.name);
    expect(second.created).toBe(first.created);
    expect(second.metadata).toEqual(first.metadata);
  });

  test("no idempotency key always creates new resources", async () => {
    const first = await stripe.customers.create({ email: "noidm@test.com" });
    const second = await stripe.customers.create({ email: "noidm@test.com" });

    expect(second.id).not.toBe(first.id);
  });

  test("idempotency key reused on different path returns error", async () => {
    const key = "idem-cross-path";

    await stripe.customers.create(
      { email: "crosspath@test.com" },
      { idempotencyKey: key },
    );

    // Use raw fetch to send same key on a different endpoint
    const res = await fetch(`http://localhost:${app.server!.port}/v1/products`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": key,
      },
      body: "name=TestProduct",
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.type).toBe("idempotency_error");
  });

  test("idempotency key on product creation works", async () => {
    const key = "idem-product";

    const first = await stripe.products.create(
      { name: "Idem Product" },
      { idempotencyKey: key },
    );

    const second = await stripe.products.create(
      { name: "Idem Product" },
      { idempotencyKey: key },
    );

    expect(second.id).toBe(first.id);
  });
});

// ===========================================================================
// EDGE CASES
// ===========================================================================
describe("Edge cases", () => {
  test("rapid creation yields unique IDs", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      stripe.customers.create({ email: `rapid${i}@test.com` }),
    );

    const customers = await Promise.all(promises);
    const ids = customers.map((c) => c.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(10);
  });

  test("very long metadata values are stored correctly", async () => {
    const longValue = "x".repeat(5000);

    const customer = await stripe.customers.create({
      email: "longmeta@test.com",
      metadata: { long_key: longValue },
    });

    const retrieved = await stripe.customers.retrieve(customer.id) as Stripe.Customer;
    expect(retrieved.metadata.long_key).toBe(longValue);
    expect(retrieved.metadata.long_key).toHaveLength(5000);
  });

  test("special characters in customer name and email", async () => {
    const customer = await stripe.customers.create({
      email: "special+tag@sub.example.com",
      name: "O'Brien & Sons <LLC>",
    });

    const retrieved = await stripe.customers.retrieve(customer.id) as Stripe.Customer;
    expect(retrieved.email).toBe("special+tag@sub.example.com");
    expect(retrieved.name).toBe("O'Brien & Sons <LLC>");
  });

  test("unicode in product name", async () => {
    const product = await stripe.products.create({
      name: "Produit special: cafe, creme brulee",
    });

    const retrieved = await stripe.products.retrieve(product.id);
    expect(retrieved.name).toBe("Produit special: cafe, creme brulee");
  });

  test("empty metadata object is handled correctly", async () => {
    const customer = await stripe.customers.create({
      email: "emptymeta@test.com",
      metadata: {},
    });

    const retrieved = await stripe.customers.retrieve(customer.id) as Stripe.Customer;
    expect(retrieved.metadata).toEqual({});
  });
});
