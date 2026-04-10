import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "crypto";
import Stripe from "stripe";
import { createApp } from "../../src/app";

interface CapturedWebhook {
  body: string;
  signature: string;
}

let app: ReturnType<typeof createApp>;
let stripe: Stripe;
let capturedWebhooks: CapturedWebhook[];
let webhookServer: ReturnType<typeof Bun.serve> | null;
let webhookPort: number;

beforeEach(async () => {
  capturedWebhooks = [];
  webhookServer = Bun.serve({
    port: 0,
    fetch(req) {
      return req.text().then((body) => {
        capturedWebhooks.push({
          body,
          signature: req.headers.get("Stripe-Signature") ?? "",
        });
        return new Response("ok", { status: 200 });
      });
    },
  });
  webhookPort = webhookServer.port;

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
  webhookServer?.stop();
});

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) parts[key] = value;
  }
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;
  const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", rawSecret).update(signedPayload).digest("hex");
  return expected === v1;
}

function waitForWebhooks(count: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (capturedWebhooks.length >= count) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${count} webhooks (got ${capturedWebhooks.length})`));
      }
    }, 50);
  });
}

function parseWebhookEvent(webhook: CapturedWebhook): Stripe.Event {
  return JSON.parse(webhook.body) as Stripe.Event;
}

// ---------------------------------------------------------------------------
// Payment lifecycle webhooks
// ---------------------------------------------------------------------------
describe("Payment lifecycle webhooks", () => {
  test("create PI with confirm=true delivers payment_intent.created and payment_intent.succeeded", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created", "payment_intent.succeeded"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 5000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.status).toBe("succeeded");

    await waitForWebhooks(2);
    expect(capturedWebhooks.length).toBe(2);

    const events = capturedWebhooks.map(parseWebhookEvent);
    const types = events.map((e) => e.type);
    expect(types).toContain("payment_intent.created");
    expect(types).toContain("payment_intent.succeeded");

    // Verify both have valid signatures
    for (const wh of capturedWebhooks) {
      expect(verifySignature(wh.body, wh.signature, endpoint.secret!)).toBe(true);
    }
  });

  test("each webhook body is a valid Stripe Event with correct type field", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      payment_method: pm.id,
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);

    expect(event.object).toBe("event");
    expect(event.id).toMatch(/^evt_/);
    expect(event.type).toBe("payment_intent.created");
    expect(typeof event.created).toBe("number");
    expect(event.livemode).toBe(false);
  });

  test("event.data.object contains the actual PI with correct amount and status", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.succeeded"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 7500,
      currency: "eur",
      payment_method: pm.id,
      confirm: true,
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    const obj = event.data.object as any;

    expect(obj.id).toBe(pi.id);
    expect(obj.amount).toBe(7500);
    expect(obj.currency).toBe("eur");
    expect(obj.status).toBe("succeeded");
  });

  test("confirm PI separately delivers payment_intent.succeeded webhook", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.succeeded"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      payment_method: pm.id,
    });
    expect(pi.status).toBe("requires_confirmation");

    const confirmed = await stripe.paymentIntents.confirm(pi.id);
    expect(confirmed.status).toBe("succeeded");

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("payment_intent.succeeded");
    expect((event.data.object as any).id).toBe(pi.id);
  });

  test("manual capture flow: payment_intent.created then payment_intent.succeeded on capture", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created", "payment_intent.succeeded"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 4000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
      capture_method: "manual",
    });
    expect(pi.status).toBe("requires_capture");

    // Should have received payment_intent.created only (not succeeded yet since requires_capture)
    await waitForWebhooks(1);
    const createdEvent = parseWebhookEvent(capturedWebhooks[0]);
    expect(createdEvent.type).toBe("payment_intent.created");

    // Now capture
    const captured = await stripe.paymentIntents.capture(pi.id);
    expect(captured.status).toBe("succeeded");

    await waitForWebhooks(2);
    const succeededEvent = parseWebhookEvent(capturedWebhooks[1]);
    expect(succeededEvent.type).toBe("payment_intent.succeeded");
    expect((succeededEvent.data.object as any).id).toBe(pi.id);
    expect((succeededEvent.data.object as any).amount_received).toBe(4000);
  });

  test("cancel PI delivers payment_intent.canceled webhook", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.canceled"],
    });

    const pi = await stripe.paymentIntents.create({
      amount: 1500,
      currency: "usd",
    });

    const canceled = await stripe.paymentIntents.cancel(pi.id);
    expect(canceled.status).toBe("canceled");

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("payment_intent.canceled");
    expect((event.data.object as any).id).toBe(pi.id);
  });

  test("webhook for PI has valid HMAC signature using endpoint secret", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created"],
    });

    await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
    });

    await waitForWebhooks(1);
    const { body, signature } = capturedWebhooks[0];
    expect(verifySignature(body, signature, endpoint.secret!)).toBe(true);
  });

  test("payment_intent.created webhook includes payment_method when set", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 2500,
      currency: "usd",
      payment_method: pm.id,
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    const obj = event.data.object as any;
    expect(obj.id).toBe(pi.id);
    expect(obj.payment_method).toBe(pm.id);
  });

  test("PI with metadata carries metadata through to webhook event", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created"],
    });

    const pi = await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      metadata: { order_id: "order_123", source: "test" },
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    const obj = event.data.object as any;
    expect(obj.id).toBe(pi.id);
    expect(obj.metadata.order_id).toBe("order_123");
    expect(obj.metadata.source).toBe("test");
  });

  test("PI created without confirm only emits payment_intent.created, not succeeded", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["payment_intent.created", "payment_intent.succeeded"],
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    await stripe.paymentIntents.create({
      amount: 3000,
      currency: "usd",
      payment_method: pm.id,
    });

    await waitForWebhooks(1);
    // Give extra time to make sure no second webhook arrives
    await new Promise((r) => setTimeout(r, 300));

    expect(capturedWebhooks.length).toBe(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("payment_intent.created");
  });
});

// ---------------------------------------------------------------------------
// Customer lifecycle webhooks
// ---------------------------------------------------------------------------
describe("Customer lifecycle webhooks", () => {
  test("create customer delivers customer.created webhook", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    const customer = await stripe.customers.create({
      email: "webhook-cust@example.com",
      name: "Webhook Customer",
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.created");
    expect(event.object).toBe("event");

    const obj = event.data.object as any;
    expect(obj.id).toBe(customer.id);
    expect(obj.email).toBe("webhook-cust@example.com");
    expect(obj.name).toBe("Webhook Customer");

    expect(verifySignature(capturedWebhooks[0].body, capturedWebhooks[0].signature, endpoint.secret!)).toBe(true);
  });

  test("update customer delivers customer.updated webhook", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.updated"],
    });

    const customer = await stripe.customers.create({
      email: "original@example.com",
      name: "Original Name",
    });

    // No customer.updated webhook for create
    await new Promise((r) => setTimeout(r, 200));
    expect(capturedWebhooks.length).toBe(0);

    const updated = await stripe.customers.update(customer.id, {
      name: "Updated Name",
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.updated");

    const obj = event.data.object as any;
    expect(obj.id).toBe(customer.id);
    expect(obj.name).toBe("Updated Name");
  });

  test("delete customer delivers customer.deleted webhook", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.deleted"],
    });

    const customer = await stripe.customers.create({
      email: "delete-me@example.com",
    });

    await stripe.customers.del(customer.id);

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.deleted");

    const obj = event.data.object as any;
    expect(obj.id).toBe(customer.id);
  });

  test("full customer lifecycle: create, update, delete produces three webhooks in order", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created", "customer.updated", "customer.deleted"],
    });

    const customer = await stripe.customers.create({
      email: "lifecycle@example.com",
      name: "Lifecycle Test",
    });
    await waitForWebhooks(1);

    await stripe.customers.update(customer.id, { name: "Updated" });
    await waitForWebhooks(2);

    await stripe.customers.del(customer.id);
    await waitForWebhooks(3);

    expect(capturedWebhooks.length).toBe(3);
    const types = capturedWebhooks.map((w) => parseWebhookEvent(w).type);
    expect(types[0]).toBe("customer.created");
    expect(types[1]).toBe("customer.updated");
    expect(types[2]).toBe("customer.deleted");
  });

  test("customer webhook body has matching email and metadata", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    const customer = await stripe.customers.create({
      email: "meta@example.com",
      metadata: { tier: "premium" },
    });

    await waitForWebhooks(1);
    const obj = (parseWebhookEvent(capturedWebhooks[0]).data.object as any);
    expect(obj.id).toBe(customer.id);
    expect(obj.email).toBe("meta@example.com");
    expect(obj.metadata.tier).toBe("premium");
  });

  test("customer.updated webhook carries updated fields", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.updated"],
    });

    const customer = await stripe.customers.create({
      email: "change@example.com",
      name: "Before",
    });

    await stripe.customers.update(customer.id, {
      email: "changed@example.com",
      name: "After",
    });

    await waitForWebhooks(1);
    const obj = (parseWebhookEvent(capturedWebhooks[0]).data.object as any);
    expect(obj.email).toBe("changed@example.com");
    expect(obj.name).toBe("After");
  });
});

// ---------------------------------------------------------------------------
// Subscription webhooks
// ---------------------------------------------------------------------------
describe("Subscription webhooks", () => {
  async function createProductAndPrice() {
    const product = await stripe.products.create({ name: "Sub Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });
    return { product, price };
  }

  test("create subscription delivers customer.subscription.created webhook", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.created"],
    });

    const customer = await stripe.customers.create({ email: "sub@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.subscription.created");
    expect((event.data.object as any).id).toBe(sub.id);
    expect((event.data.object as any).status).toBe("active");

    expect(verifySignature(capturedWebhooks[0].body, capturedWebhooks[0].signature, endpoint.secret!)).toBe(true);
  });

  test("update subscription delivers customer.subscription.updated webhook", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.updated"],
    });

    const customer = await stripe.customers.create({ email: "sub-update@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    // No updated webhook for create
    await new Promise((r) => setTimeout(r, 200));
    expect(capturedWebhooks.length).toBe(0);

    await stripe.subscriptions.update(sub.id, {
      metadata: { plan: "pro" },
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.subscription.updated");
    expect((event.data.object as any).id).toBe(sub.id);
    expect((event.data.object as any).metadata.plan).toBe("pro");
  });

  test("update subscription includes previous_attributes", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.updated"],
    });

    const customer = await stripe.customers.create({ email: "sub-prev@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await stripe.subscriptions.update(sub.id, {
      metadata: { new_key: "new_value" },
    });

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.subscription.updated");
    // previous_attributes should include the old metadata
    expect(event.data.previous_attributes).toBeDefined();
    expect((event.data.previous_attributes as any).metadata).toBeDefined();
  });

  test("cancel subscription delivers updated then deleted webhooks in order", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.updated", "customer.subscription.deleted"],
    });

    const customer = await stripe.customers.create({ email: "sub-cancel@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await stripe.subscriptions.cancel(sub.id);

    await waitForWebhooks(2);
    expect(capturedWebhooks.length).toBe(2);

    const events = capturedWebhooks.map(parseWebhookEvent);
    // Updated should come before deleted
    expect(events[0].type).toBe("customer.subscription.updated");
    expect(events[1].type).toBe("customer.subscription.deleted");
    expect((events[0].data.object as any).id).toBe(sub.id);
    expect((events[1].data.object as any).id).toBe(sub.id);
  });

  test("cancel subscription updated webhook has previous status in previous_attributes", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.updated"],
    });

    const customer = await stripe.customers.create({ email: "sub-cancel-prev@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });
    expect(sub.status).toBe("active");

    await stripe.subscriptions.cancel(sub.id);

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.subscription.updated");
    expect((event.data.object as any).status).toBe("canceled");
    expect((event.data.previous_attributes as any).status).toBe("active");
  });

  test("subscription deleted webhook has canceled status", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.deleted"],
    });

    const customer = await stripe.customers.create({ email: "sub-del@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await stripe.subscriptions.cancel(sub.id);

    await waitForWebhooks(1);
    const event = parseWebhookEvent(capturedWebhooks[0]);
    expect(event.type).toBe("customer.subscription.deleted");
    expect((event.data.object as any).id).toBe(sub.id);
    expect((event.data.object as any).status).toBe("canceled");
  });

  test("subscription webhook body includes items and customer", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.subscription.created"],
    });

    const customer = await stripe.customers.create({ email: "sub-items@example.com" });
    const { price } = await createProductAndPrice();

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await waitForWebhooks(1);
    const obj = (parseWebhookEvent(capturedWebhooks[0]).data.object as any);
    expect(obj.customer).toBe(customer.id);
    expect(obj.items.data.length).toBeGreaterThanOrEqual(1);
    expect(obj.items.data[0].price.id).toBe(price.id);
  });
});

// ---------------------------------------------------------------------------
// Webhook routing
// ---------------------------------------------------------------------------
describe("Webhook routing", () => {
  test("endpoint registered for customer.created does not receive product.created", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    // Create a product — should NOT trigger webhook for this endpoint
    await stripe.products.create({ name: "Ignored Product" });

    await new Promise((r) => setTimeout(r, 500));
    expect(capturedWebhooks.length).toBe(0);

    // Now create a customer — should trigger
    await stripe.customers.create({ email: "routed@example.com" });
    await waitForWebhooks(1);
    expect(capturedWebhooks.length).toBe(1);
    expect(parseWebhookEvent(capturedWebhooks[0]).type).toBe("customer.created");
  });

  test("wildcard endpoint receives all event types", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["*"],
    });

    await stripe.products.create({ name: "Wildcard Product" });
    await stripe.customers.create({ email: "wildcard@example.com" });

    await waitForWebhooks(2);
    const types = capturedWebhooks.map((w) => parseWebhookEvent(w).type);
    expect(types).toContain("product.created");
    expect(types).toContain("customer.created");
  });

  test("two endpoints with different filters each receive only matching events", async () => {
    // First webhook server captures for customer events
    const customerWebhooks: CapturedWebhook[] = [];
    const customerServer = Bun.serve({
      port: 0,
      fetch(req) {
        return req.text().then((body) => {
          customerWebhooks.push({
            body,
            signature: req.headers.get("Stripe-Signature") ?? "",
          });
          return new Response("ok", { status: 200 });
        });
      },
    });

    // Second webhook server captures for product events
    const productWebhooks: CapturedWebhook[] = [];
    const productServer = Bun.serve({
      port: 0,
      fetch(req) {
        return req.text().then((body) => {
          productWebhooks.push({
            body,
            signature: req.headers.get("Stripe-Signature") ?? "",
          });
          return new Response("ok", { status: 200 });
        });
      },
    });

    try {
      await stripe.webhookEndpoints.create({
        url: `http://localhost:${customerServer.port}/webhooks`,
        enabled_events: ["customer.created"],
      });

      await stripe.webhookEndpoints.create({
        url: `http://localhost:${productServer.port}/webhooks`,
        enabled_events: ["product.created"],
      });

      await stripe.customers.create({ email: "filter-test@example.com" });
      await stripe.products.create({ name: "Filter Product" });

      // Wait for delivery
      await new Promise((r) => setTimeout(r, 1000));

      expect(customerWebhooks.length).toBe(1);
      expect(parseWebhookEvent(customerWebhooks[0]).type).toBe("customer.created");

      expect(productWebhooks.length).toBe(1);
      expect(parseWebhookEvent(productWebhooks[0]).type).toBe("product.created");
    } finally {
      customerServer.stop();
      productServer.stop();
    }
  });

  test("multiple endpoints for same event: both receive the webhook", async () => {
    const secondWebhooks: CapturedWebhook[] = [];
    const secondServer = Bun.serve({
      port: 0,
      fetch(req) {
        return req.text().then((body) => {
          secondWebhooks.push({
            body,
            signature: req.headers.get("Stripe-Signature") ?? "",
          });
          return new Response("ok", { status: 200 });
        });
      },
    });

    try {
      await stripe.webhookEndpoints.create({
        url: `http://localhost:${webhookPort}/webhooks`,
        enabled_events: ["customer.created"],
      });

      await stripe.webhookEndpoints.create({
        url: `http://localhost:${secondServer.port}/webhooks`,
        enabled_events: ["customer.created"],
      });

      await stripe.customers.create({ email: "multi-endpoint@example.com" });

      await waitForWebhooks(1);
      await new Promise((r) => setTimeout(r, 500));

      expect(capturedWebhooks.length).toBe(1);
      expect(secondWebhooks.length).toBe(1);

      const event1 = parseWebhookEvent(capturedWebhooks[0]);
      const event2 = parseWebhookEvent(secondWebhooks[0]);
      expect(event1.type).toBe("customer.created");
      expect(event2.type).toBe("customer.created");
      // Same event delivered to both
      expect(event1.id).toBe(event2.id);
    } finally {
      secondServer.stop();
    }
  });

  test("deleted (disabled) endpoint does not receive webhooks", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.webhookEndpoints.del(endpoint.id);

    await stripe.customers.create({ email: "no-webhook@example.com" });

    await new Promise((r) => setTimeout(r, 500));
    expect(capturedWebhooks.length).toBe(0);
  });

  test("endpoint with multiple specific events receives only those types", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created", "product.created"],
    });

    await stripe.customers.create({ email: "multi-filter@example.com" });
    await stripe.products.create({ name: "Multi Filter Product" });

    // Should not trigger for payment_intent.created
    await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });

    await waitForWebhooks(2);
    await new Promise((r) => setTimeout(r, 300));

    expect(capturedWebhooks.length).toBe(2);
    const types = capturedWebhooks.map((w) => parseWebhookEvent(w).type);
    expect(types).toContain("customer.created");
    expect(types).toContain("product.created");
  });

  test("wildcard and specific endpoint both receive matching events", async () => {
    const specificWebhooks: CapturedWebhook[] = [];
    const specificServer = Bun.serve({
      port: 0,
      fetch(req) {
        return req.text().then((body) => {
          specificWebhooks.push({
            body,
            signature: req.headers.get("Stripe-Signature") ?? "",
          });
          return new Response("ok", { status: 200 });
        });
      },
    });

    try {
      // Wildcard endpoint on main server
      await stripe.webhookEndpoints.create({
        url: `http://localhost:${webhookPort}/webhooks`,
        enabled_events: ["*"],
      });

      // Specific endpoint on second server
      await stripe.webhookEndpoints.create({
        url: `http://localhost:${specificServer.port}/webhooks`,
        enabled_events: ["customer.created"],
      });

      await stripe.customers.create({ email: "both@example.com" });

      await waitForWebhooks(1);
      await new Promise((r) => setTimeout(r, 500));

      // Wildcard got it
      expect(capturedWebhooks.length).toBe(1);
      expect(parseWebhookEvent(capturedWebhooks[0]).type).toBe("customer.created");

      // Specific got it too
      expect(specificWebhooks.length).toBe(1);
      expect(parseWebhookEvent(specificWebhooks[0]).type).toBe("customer.created");
    } finally {
      specificServer.stop();
    }
  });

  test("endpoint registered after resource creation does not receive retroactive webhooks", async () => {
    // Create customer before registering endpoint
    await stripe.customers.create({ email: "before-endpoint@example.com" });

    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await new Promise((r) => setTimeout(r, 500));
    expect(capturedWebhooks.length).toBe(0);

    // New customer after registration should trigger
    await stripe.customers.create({ email: "after-endpoint@example.com" });
    await waitForWebhooks(1);
    expect(capturedWebhooks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
describe("Signature verification", () => {
  test("Stripe-Signature header has t= timestamp and v1= signature", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "sig@example.com" });
    await waitForWebhooks(1);

    const { signature } = capturedWebhooks[0];
    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
  });

  test("signature is valid HMAC-SHA256 of timestamp.payload with endpoint secret", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "hmac@example.com" });
    await waitForWebhooks(1);

    const { body, signature } = capturedWebhooks[0];
    expect(verifySignature(body, signature, endpoint.secret!)).toBe(true);
  });

  test("different endpoints have different secrets and both produce valid signatures", async () => {
    const secondWebhooks: CapturedWebhook[] = [];
    const secondServer = Bun.serve({
      port: 0,
      fetch(req) {
        return req.text().then((body) => {
          secondWebhooks.push({
            body,
            signature: req.headers.get("Stripe-Signature") ?? "",
          });
          return new Response("ok", { status: 200 });
        });
      },
    });

    try {
      const ep1 = await stripe.webhookEndpoints.create({
        url: `http://localhost:${webhookPort}/webhooks`,
        enabled_events: ["customer.created"],
      });

      const ep2 = await stripe.webhookEndpoints.create({
        url: `http://localhost:${secondServer.port}/webhooks`,
        enabled_events: ["customer.created"],
      });

      // Different secrets
      expect(ep1.secret).not.toBe(ep2.secret);

      await stripe.customers.create({ email: "two-secrets@example.com" });

      await waitForWebhooks(1);
      await new Promise((r) => setTimeout(r, 500));

      // Both receive and both have valid sigs with their own secret
      expect(verifySignature(capturedWebhooks[0].body, capturedWebhooks[0].signature, ep1.secret!)).toBe(true);
      expect(verifySignature(secondWebhooks[0].body, secondWebhooks[0].signature, ep2.secret!)).toBe(true);

      // Cross-verification should fail
      expect(verifySignature(capturedWebhooks[0].body, capturedWebhooks[0].signature, ep2.secret!)).toBe(false);
      expect(verifySignature(secondWebhooks[0].body, secondWebhooks[0].signature, ep1.secret!)).toBe(false);
    } finally {
      secondServer.stop();
    }
  });

  test("timestamp in signature is recent (within 10 seconds of now)", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "timestamp@example.com" });
    await waitForWebhooks(1);

    const { signature } = capturedWebhooks[0];
    const parts: Record<string, string> = {};
    for (const part of signature.split(",")) {
      const [key, value] = part.split("=");
      if (key && value) parts[key] = value;
    }

    const ts = parseInt(parts["t"], 10);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(nowSec - ts)).toBeLessThan(10);
  });

  test("each webhook delivery has a unique signature (different events)", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "unique-sig-1@example.com" });
    await stripe.customers.create({ email: "unique-sig-2@example.com" });

    await waitForWebhooks(2);

    // Different payloads produce different v1 signatures
    const sig1 = capturedWebhooks[0].signature;
    const sig2 = capturedWebhooks[1].signature;
    const v1_1 = sig1.split(",").find((p) => p.startsWith("v1="))!;
    const v1_2 = sig2.split(",").find((p) => p.startsWith("v1="))!;
    expect(v1_1).not.toBe(v1_2);
  });

  test("signature uses whsec_ secret with prefix stripped for HMAC computation", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });
    expect(endpoint.secret).toMatch(/^whsec_/);

    await stripe.customers.create({ email: "whsec@example.com" });
    await waitForWebhooks(1);

    const { body, signature } = capturedWebhooks[0];

    // Manual verification: strip whsec_ and compute HMAC
    const rawSecret = endpoint.secret!.slice("whsec_".length);
    const parts: Record<string, string> = {};
    for (const part of signature.split(",")) {
      const [key, value] = part.split("=");
      if (key && value) parts[key] = value;
    }

    const signedPayload = `${parts["t"]}.${body}`;
    const expected = createHmac("sha256", rawSecret).update(signedPayload).digest("hex");
    expect(parts["v1"]).toBe(expected);
  });

  test("v1 signature is a 64-character hex string", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "hexlen@example.com" });
    await waitForWebhooks(1);

    const { signature } = capturedWebhooks[0];
    const v1 = signature.split(",").find((p) => p.startsWith("v1="))!.split("=")[1];
    expect(v1.length).toBe(64);
    expect(v1).toMatch(/^[a-f0-9]+$/);
  });

  test("signature with wrong secret fails verification", async () => {
    await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    await stripe.customers.create({ email: "wrong-secret@example.com" });
    await waitForWebhooks(1);

    const { body, signature } = capturedWebhooks[0];
    expect(verifySignature(body, signature, "whsec_wrongsecretvalue")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event API
// ---------------------------------------------------------------------------
describe("Event API", () => {
  test("list all events after creating several resources", async () => {
    await stripe.customers.create({ email: "event-1@example.com" });
    await stripe.products.create({ name: "Event Product" });
    await stripe.customers.create({ email: "event-2@example.com" });

    const events = await stripe.events.list({ limit: 10 });
    expect(events.object).toBe("list");
    expect(events.data.length).toBeGreaterThanOrEqual(3);

    for (const event of events.data) {
      expect(event.id).toMatch(/^evt_/);
      expect(event.object).toBe("event");
      expect(typeof event.type).toBe("string");
    }
  });

  test("filter events by type", async () => {
    await stripe.customers.create({ email: "filter-evt@example.com" });
    await stripe.products.create({ name: "Filter Event Product" });
    await stripe.customers.create({ email: "filter-evt-2@example.com" });

    const customerEvents = await stripe.events.list({
      type: "customer.created",
      limit: 10,
    });

    expect(customerEvents.data.length).toBe(2);
    for (const event of customerEvents.data) {
      expect(event.type).toBe("customer.created");
    }
  });

  test("retrieve a specific event by ID", async () => {
    await stripe.customers.create({ email: "retrieve-evt@example.com" });

    const events = await stripe.events.list({ limit: 1 });
    expect(events.data.length).toBe(1);

    const eventId = events.data[0].id;
    const retrieved = await stripe.events.retrieve(eventId);

    expect(retrieved.id).toBe(eventId);
    expect(retrieved.object).toBe("event");
    expect(retrieved.type).toBe("customer.created");
  });

  test("event.data.object contains the full resource", async () => {
    const customer = await stripe.customers.create({
      email: "full-resource@example.com",
      name: "Full Resource",
      metadata: { key: "value" },
    });

    const events = await stripe.events.list({
      type: "customer.created",
      limit: 1,
    });

    const event = events.data[0];
    const obj = event.data.object as any;
    expect(obj.id).toBe(customer.id);
    expect(obj.email).toBe("full-resource@example.com");
    expect(obj.name).toBe("Full Resource");
    expect(obj.metadata.key).toBe("value");
    expect(obj.object).toBe("customer");
  });

  test("subscription update event has previous_attributes via events API", async () => {
    const customer = await stripe.customers.create({ email: "evt-prev@example.com" });
    const product = await stripe.products.create({ name: "Prev Attr Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1500,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    await stripe.subscriptions.update(sub.id, {
      metadata: { updated: "true" },
    });

    const events = await stripe.events.list({
      type: "customer.subscription.updated",
      limit: 1,
    });

    expect(events.data.length).toBe(1);
    const event = events.data[0];
    expect(event.type).toBe("customer.subscription.updated");
    expect(event.data.previous_attributes).toBeDefined();
    expect((event.data.previous_attributes as any).metadata).toBeDefined();
  });

  test("events are ordered newest first", async () => {
    await stripe.customers.create({ email: "order-1@example.com" });
    await stripe.customers.create({ email: "order-2@example.com" });
    await stripe.customers.create({ email: "order-3@example.com" });

    const events = await stripe.events.list({ limit: 10 });

    // All customer.created events
    const customerEvents = events.data.filter((e) => e.type === "customer.created");
    expect(customerEvents.length).toBe(3);

    // Newest first means created timestamps should be descending (or equal for near-simultaneous)
    for (let i = 0; i < customerEvents.length - 1; i++) {
      expect(customerEvents[i].created).toBeGreaterThanOrEqual(customerEvents[i + 1].created);
    }
  });

  test("events from different resource types all coexist", async () => {
    await stripe.customers.create({ email: "coexist@example.com" });
    await stripe.products.create({ name: "Coexist Product" });
    await stripe.paymentIntents.create({ amount: 500, currency: "usd" });

    const events = await stripe.events.list({ limit: 20 });

    const types = events.data.map((e) => e.type);
    expect(types).toContain("customer.created");
    expect(types).toContain("product.created");
    expect(types).toContain("payment_intent.created");
  });

  test("pagination: first page has_more flag and starting_after returns events", async () => {
    // Create enough events to paginate
    for (let i = 0; i < 5; i++) {
      await stripe.customers.create({ email: `page-${i}@example.com` });
    }

    const page1 = await stripe.events.list({ limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.has_more).toBe(true);

    // starting_after accepts the last event ID and returns results
    const page2 = await stripe.events.list({
      limit: 2,
      starting_after: page1.data[page1.data.length - 1].id,
    });
    expect(page2.data.length).toBe(2);

    // Both pages return valid events
    for (const event of [...page1.data, ...page2.data]) {
      expect(event.id).toMatch(/^evt_/);
      expect(event.object).toBe("event");
    }
  });

  test("each event has a unique ID", async () => {
    await stripe.customers.create({ email: "unique-1@example.com" });
    await stripe.customers.create({ email: "unique-2@example.com" });
    await stripe.customers.create({ email: "unique-3@example.com" });

    const events = await stripe.events.list({ limit: 10 });
    const ids = events.data.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("event has api_version field", async () => {
    await stripe.customers.create({ email: "api-ver@example.com" });

    const events = await stripe.events.list({ limit: 1 });
    const event = events.data[0];
    expect(event.api_version).toBeDefined();
    expect(typeof event.api_version).toBe("string");
  });
});
