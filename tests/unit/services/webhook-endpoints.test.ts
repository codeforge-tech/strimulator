import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { WebhookEndpointService } from "../../../src/services/webhook-endpoints";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new WebhookEndpointService(db);
}

describe("WebhookEndpointService", () => {
  describe("update", () => {
    it("updates the url", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://old.example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.url).toBe("https://new.example.com/hook");
      expect(updated.id).toBe(ep.id);
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.url).toBe("https://new.example.com/hook");
    });

    it("updates enabled_events", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { enabled_events: ["customer.created", "invoice.paid"] });
      expect(updated.enabled_events).toEqual(["customer.created", "invoice.paid"]);
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.enabled_events).toEqual(["customer.created", "invoice.paid"]);
    });

    it("updates status to disabled", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { status: "disabled" });
      expect(updated.status).toBe("disabled");
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.status).toBe("disabled");
    });

    it("preserves unchanged fields", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["customer.created"] });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.enabled_events).toEqual(["customer.created"]);
      expect(updated.secret).toBe(ep.secret);
      expect(updated.created).toBe(ep.created);
    });

    it("throws 404 for nonexistent endpoint", () => {
      const svc = makeService();
      expect(() => svc.update("we_nonexistent", { url: "https://example.com" })).toThrow();
      try {
        svc.update("we_nonexistent", { url: "https://example.com" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });
});
