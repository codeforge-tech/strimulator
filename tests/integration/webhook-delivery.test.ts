import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHmac } from "crypto";
import Stripe from "stripe";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;

// Captured webhooks from the in-process HTTP listener
interface CapturedWebhook {
  body: string;
  signature: string;
}

let capturedWebhooks: CapturedWebhook[] = [];
let webhookServer: ReturnType<typeof Bun.serve> | null = null;
let webhookPort: number;

beforeEach(async () => {
  capturedWebhooks = [];

  // Start a tiny Bun HTTP server to receive webhooks
  webhookServer = Bun.serve({
    port: 0, // random available port
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

  // Start strimulator
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
  // Parse t= and v1= from the Stripe-Signature header
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

describe("Webhook Delivery Integration", () => {
  test("customer.created event is delivered with valid Stripe-Signature", async () => {
    // Register a webhook endpoint pointing to our test server
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    expect(endpoint.secret).toMatch(/^whsec_/);

    // Create a customer — this should trigger a customer.created event
    const customer = await stripe.customers.create({
      email: "webhook-test@example.com",
      name: "Webhook Test",
    });

    expect(customer.id).toMatch(/^cus_/);

    // Wait for the webhook to be delivered
    await waitForWebhooks(1);

    expect(capturedWebhooks.length).toBe(1);

    const { body, signature } = capturedWebhooks[0];

    // Verify the Stripe-Signature header is present and correctly formatted
    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);

    // Verify the HMAC signature matches
    const isValid = verifySignature(body, signature, endpoint.secret!);
    expect(isValid).toBe(true);

    // Verify the event payload
    const event = JSON.parse(body) as Stripe.Event;
    expect(event.type).toBe("customer.created");
    expect(event.object).toBe("event");
    expect(event.id).toMatch(/^evt_/);
    expect((event.data.object as any).id).toBe(customer.id);
  });

  test("wildcard endpoint receives multiple event types", async () => {
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["*"],
    });

    // Create a product — triggers product.created
    await stripe.products.create({ name: "Test Product" });

    // Create a customer — triggers customer.created
    await stripe.customers.create({ email: "multi-event@example.com" });

    // Wait for both webhooks
    await waitForWebhooks(2);

    expect(capturedWebhooks.length).toBe(2);

    const eventTypes = capturedWebhooks.map((w) => {
      const event = JSON.parse(w.body) as Stripe.Event;
      return event.type;
    });

    expect(eventTypes).toContain("product.created");
    expect(eventTypes).toContain("customer.created");

    // All signatures should be valid
    for (const { body, signature } of capturedWebhooks) {
      expect(verifySignature(body, signature, endpoint.secret!)).toBe(true);
    }
  });

  test("disabled endpoint does not receive webhooks", async () => {
    // Register endpoint then delete it (simulating disabled)
    const endpoint = await stripe.webhookEndpoints.create({
      url: `http://localhost:${webhookPort}/webhooks`,
      enabled_events: ["customer.created"],
    });

    // Delete the endpoint
    await stripe.webhookEndpoints.del(endpoint.id);

    // Create a customer — should NOT trigger delivery to deleted endpoint
    await stripe.customers.create({ email: "no-webhook@example.com" });

    // Wait briefly to ensure no webhook arrives
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(capturedWebhooks.length).toBe(0);
  });
});
