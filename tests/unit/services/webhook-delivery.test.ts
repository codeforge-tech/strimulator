import { describe, it, expect } from "bun:test";
import { createHmac } from "crypto";
import { createDB } from "../../../src/db";
import { WebhookEndpointService } from "../../../src/services/webhook-endpoints";
import { WebhookDeliveryService } from "../../../src/services/webhook-delivery";

function makeServices() {
  const db = createDB(":memory:");
  const endpointService = new WebhookEndpointService(db);
  const deliveryService = new WebhookDeliveryService(db, endpointService);
  return { db, endpointService, deliveryService };
}

describe("WebhookDeliveryService", () => {
  describe("generateSignature", () => {
    it("produces the correct format t=...,v1=...", () => {
      const { deliveryService } = makeServices();
      const payload = '{"id":"evt_123","type":"customer.created"}';
      const secret = "whsec_testsecret123";
      const timestamp = 1700000000;

      const signature = deliveryService.generateSignature(payload, secret, timestamp);

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
      expect(signature).toContain(`t=${timestamp}`);
    });

    it("produces a correct HMAC-SHA256", () => {
      const { deliveryService } = makeServices();
      const payload = '{"id":"evt_123","type":"customer.created"}';
      const secret = "whsec_testsecret123";
      const timestamp = 1700000000;

      const signature = deliveryService.generateSignature(payload, secret, timestamp);

      // Manually compute expected HMAC (strip whsec_ prefix)
      const rawSecret = "testsecret123";
      const signedPayload = `${timestamp}.${payload}`;
      const expectedHmac = createHmac("sha256", rawSecret).update(signedPayload).digest("hex");

      expect(signature).toBe(`t=${timestamp},v1=${expectedHmac}`);
    });

    it("produces different signatures for different timestamps", () => {
      const { deliveryService } = makeServices();
      const payload = '{"id":"evt_123"}';
      const secret = "whsec_mysecret";

      const sig1 = deliveryService.generateSignature(payload, secret, 1000);
      const sig2 = deliveryService.generateSignature(payload, secret, 2000);

      expect(sig1).not.toBe(sig2);
    });

    it("produces different signatures for different payloads", () => {
      const { deliveryService } = makeServices();
      const secret = "whsec_mysecret";
      const timestamp = 1700000000;

      const sig1 = deliveryService.generateSignature('{"id":"evt_1"}', secret, timestamp);
      const sig2 = deliveryService.generateSignature('{"id":"evt_2"}', secret, timestamp);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("findMatchingEndpoints", () => {
    it("matches endpoints with wildcard '*' for any event type", () => {
      const { endpointService, deliveryService } = makeServices();

      endpointService.create({
        url: "https://example.com/webhook",
        enabled_events: ["*"],
      });

      const matches = deliveryService.findMatchingEndpoints("customer.created");
      expect(matches.length).toBe(1);
      expect(matches[0].url).toBe("https://example.com/webhook");
    });

    it("matches endpoints with specific event type", () => {
      const { endpointService, deliveryService } = makeServices();

      endpointService.create({
        url: "https://example.com/webhook",
        enabled_events: ["customer.created", "charge.succeeded"],
      });

      const matches = deliveryService.findMatchingEndpoints("customer.created");
      expect(matches.length).toBe(1);
    });

    it("does not match endpoints with non-matching event type", () => {
      const { endpointService, deliveryService } = makeServices();

      endpointService.create({
        url: "https://example.com/webhook",
        enabled_events: ["charge.succeeded"],
      });

      const matches = deliveryService.findMatchingEndpoints("customer.created");
      expect(matches.length).toBe(0);
    });

    it("returns multiple matching endpoints", () => {
      const { endpointService, deliveryService } = makeServices();

      endpointService.create({
        url: "https://endpoint1.com/webhook",
        enabled_events: ["*"],
      });
      endpointService.create({
        url: "https://endpoint2.com/webhook",
        enabled_events: ["customer.created"],
      });
      endpointService.create({
        url: "https://endpoint3.com/webhook",
        enabled_events: ["charge.succeeded"],
      });

      const matches = deliveryService.findMatchingEndpoints("customer.created");
      expect(matches.length).toBe(2);
      const urls = matches.map((m) => m.url);
      expect(urls).toContain("https://endpoint1.com/webhook");
      expect(urls).toContain("https://endpoint2.com/webhook");
      expect(urls).not.toContain("https://endpoint3.com/webhook");
    });

    it("returns empty array when no endpoints exist", () => {
      const { deliveryService } = makeServices();
      const matches = deliveryService.findMatchingEndpoints("customer.created");
      expect(matches).toEqual([]);
    });

    it("returns matching endpoint url and secret", () => {
      const { endpointService, deliveryService } = makeServices();

      endpointService.create({
        url: "https://example.com/webhook",
        enabled_events: ["*"],
      });

      const matches = deliveryService.findMatchingEndpoints("any.event");
      expect(matches[0]).toHaveProperty("url");
      expect(matches[0]).toHaveProperty("secret");
      expect(matches[0]).toHaveProperty("id");
      expect(matches[0].secret).toMatch(/^whsec_/);
    });
  });
});
