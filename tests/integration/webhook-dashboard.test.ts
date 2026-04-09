import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let baseUrl: string;

beforeEach(() => {
  app = createApp();
  app.listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
});

afterEach(() => {
  app.server?.stop();
});

async function dashPost(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/dashboard/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dashPatch(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/dashboard/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dashDelete(path: string) {
  return fetch(`${baseUrl}/dashboard/api${path}`, { method: "DELETE" });
}

async function dashGet(path: string) {
  return fetch(`${baseUrl}/dashboard/api${path}`);
}

describe("Dashboard Webhook API", () => {
  describe("CRUD", () => {
    test("create, update, and delete a webhook endpoint", async () => {
      // Create
      const createRes = await dashPost("/webhooks", {
        url: "https://example.com/hook",
        enabled_events: ["customer.created"],
      });
      expect(createRes.status).toBe(200);
      const endpoint = await createRes.json();
      expect(endpoint.id).toMatch(/^we_/);
      expect(endpoint.url).toBe("https://example.com/hook");
      expect(endpoint.secret).toMatch(/^whsec_/);

      // Update URL
      const updateRes = await dashPatch(`/webhooks/${endpoint.id}`, {
        url: "https://new.example.com/hook",
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.url).toBe("https://new.example.com/hook");

      // Update status
      const disableRes = await dashPatch(`/webhooks/${endpoint.id}`, {
        status: "disabled",
      });
      expect(disableRes.status).toBe(200);
      const disabled = await disableRes.json();
      expect(disabled.status).toBe("disabled");

      // Delete
      const deleteRes = await dashDelete(`/webhooks/${endpoint.id}`);
      expect(deleteRes.status).toBe(200);
      const deleted = await deleteRes.json();
      expect(deleted.deleted).toBe(true);
    });

    test("returns 400 for missing required fields on create", async () => {
      const res = await dashPost("/webhooks", { url: "https://example.com" });
      expect(res.status).toBe(400);
    });
  });

  describe("Delivery listing", () => {
    test("lists deliveries after event is triggered", async () => {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe("sk_test_strimulator", {
        host: "localhost",
        port: app.server!.port,
        protocol: "http",
      } as any);

      const endpoint = await stripe.webhookEndpoints.create({
        url: "http://localhost:1/nonexistent",
        enabled_events: ["customer.created"],
      });

      await stripe.customers.create({ email: "delivery-test@example.com" });

      // Wait for delivery attempt
      await new Promise((r) => setTimeout(r, 500));

      // Check unified delivery log
      const res = await dashGet("/deliveries");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.length).toBeGreaterThanOrEqual(1);
      expect(data.data[0].event_type).toBe("customer.created");

      // Check per-endpoint delivery log
      const epRes = await dashGet(`/webhooks/${endpoint.id}/deliveries`);
      expect(epRes.status).toBe(200);
      const epData = await epRes.json();
      expect(epData.data.length).toBeGreaterThanOrEqual(1);
      expect(epData.data[0].endpoint_id).toBe(endpoint.id);
    });
  });

  describe("Test event", () => {
    test("sends a test event to a specific endpoint", async () => {
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      const testRes = await dashPost(`/webhooks/${endpoint.id}/test`, {
        event_type: "customer.created",
      });
      expect(testRes.status).toBe(200);
      const testData = await testRes.json();
      expect(testData.ok).toBe(true);
      expect(testData.event_id).toMatch(/^evt_/);
      expect(testData.delivery_id).toMatch(/^whdel_/);
    });

    test("returns 400 for missing event_type", async () => {
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      const res = await dashPost(`/webhooks/${endpoint.id}/test`, {});
      expect(res.status).toBe(400);
    });
  });

  describe("Retry delivery", () => {
    test("retries a failed delivery", async () => {
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      const testRes = await dashPost(`/webhooks/${endpoint.id}/test`, {
        event_type: "charge.succeeded",
      });
      const testData = await testRes.json();

      // Wait for delivery to be attempted
      await new Promise((r) => setTimeout(r, 500));

      const retryRes = await dashPost(`/deliveries/${testData.delivery_id}/retry`);
      expect(retryRes.status).toBe(200);
      const retryData = await retryRes.json();
      expect(retryData.ok).toBe(true);
      expect(retryData.delivery_id).toMatch(/^whdel_/);
      expect(retryData.delivery_id).not.toBe(testData.delivery_id);
    });

    test("returns 404 for nonexistent delivery", async () => {
      const res = await dashPost("/deliveries/whdel_nonexistent/retry");
      expect(res.status).toBe(404);
    });
  });
});
