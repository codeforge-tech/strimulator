import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;

beforeEach(() => {
  app = createApp();
  app.listen(0); // random port
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

describe("Webhook Flow SDK Tests", () => {
  test("create and retrieve webhook endpoint: verify id, url, secret", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: "https://example.com/webhooks",
      enabled_events: ["payment_intent.succeeded", "customer.created"],
    });

    expect(endpoint.id).toMatch(/^we_/);
    expect(endpoint.url).toBe("https://example.com/webhooks");
    expect(endpoint.secret).toMatch(/^whsec_/);
    expect(endpoint.enabled_events).toEqual([
      "payment_intent.succeeded",
      "customer.created",
    ]);
    expect(endpoint.status).toBe("enabled");

    // Retrieve and verify same data
    const retrieved = await stripe.webhookEndpoints.retrieve(endpoint.id);
    expect(retrieved.id).toBe(endpoint.id);
    expect(retrieved.url).toBe(endpoint.url);
  });

  test("list events: create a customer then verify events.list returns list shape", async () => {
    // Create a customer to trigger events
    const customer = await stripe.customers.create({
      email: "events-test@example.com",
      name: "Events Test",
    });
    expect(customer.id).toMatch(/^cus_/);

    // List events
    const eventList = await stripe.events.list({ limit: 10 });

    expect(eventList.object).toBe("list");
    expect(Array.isArray(eventList.data)).toBe(true);
    // Should have at least one event from creating the customer
    expect(eventList.data.length).toBeGreaterThan(0);
    // Each event should have expected shape
    const event = eventList.data[0];
    expect(event.id).toMatch(/^evt_/);
    expect(event.object).toBe("event");
    expect(typeof event.type).toBe("string");
    expect(typeof event.created).toBe("number");
  });
});
