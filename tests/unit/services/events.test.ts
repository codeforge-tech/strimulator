import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { EventService } from "../../../src/services/events";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new EventService(db);
}

describe("EventService", () => {
  describe("emit", () => {
    it("creates an event with the correct shape", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer", email: "test@example.com" };
      const event = svc.emit("customer.created", obj);

      expect(event.id).toMatch(/^evt_/);
      expect(event.object).toBe("event");
      expect(event.type).toBe("customer.created");
      expect(event.livemode).toBe(false);
      expect(event.pending_webhooks).toBe(0);
      expect(event.data.object).toEqual(obj);
      expect(event.request).toEqual({ id: null, idempotency_key: null });
      expect(typeof event.created).toBe("number");
      expect(typeof event.api_version).toBe("string");
    });

    it("sets previous_attributes when provided", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer", email: "new@example.com" };
      const prevAttrs = { email: "old@example.com" };
      const event = svc.emit("customer.updated", obj, prevAttrs);

      expect((event.data as { previous_attributes?: unknown }).previous_attributes).toEqual(prevAttrs);
    });

    it("does not set previous_attributes when not provided", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer" };
      const event = svc.emit("customer.created", obj);

      expect((event.data as { previous_attributes?: unknown }).previous_attributes).toBeUndefined();
    });

    it("notifies onEvent listeners", () => {
      const svc = makeService();
      const received: string[] = [];

      svc.onEvent((e) => {
        received.push(e.type);
      });

      svc.emit("payment_intent.created", { id: "pi_123" });
      svc.emit("charge.succeeded", { id: "ch_456" });

      expect(received).toEqual(["payment_intent.created", "charge.succeeded"]);
    });

    it("persists the event in the database", () => {
      const svc = makeService();
      const obj = { id: "pm_123", object: "payment_method" };
      const emitted = svc.emit("payment_method.attached", obj);

      const retrieved = svc.retrieve(emitted.id);
      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.type).toBe("payment_method.attached");
    });
  });

  describe("retrieve", () => {
    it("returns an event by ID", () => {
      const svc = makeService();
      const obj = { id: "prod_123", object: "product" };
      const emitted = svc.emit("product.created", obj);
      const retrieved = svc.retrieve(emitted.id);

      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.type).toBe("product.created");
    });

    it("throws 404 for nonexistent event", () => {
      const svc = makeService();
      expect(() => svc.retrieve("evt_nonexistent")).toThrow();
      try {
        svc.retrieve("evt_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });
  });

  describe("list", () => {
    it("returns empty list when no events", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10 });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/events");
    });

    it("returns all events up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 10 });
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 3 });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by type", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("customer.created", { id: "cus_2" });
      svc.emit("charge.failed", { id: "ch_2" });

      const result = svc.list({ limit: 10, type: "customer.created" });
      expect(result.data.length).toBe(2);
      expect(result.data.every((e) => e.type === "customer.created")).toBe(true);
    });

    it("returns no results when type filter matches nothing", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });

      const result = svc.list({ limit: 10, type: "nonexistent.event" });
      expect(result.data.length).toBe(0);
      expect(result.has_more).toBe(false);
    });
  });
});
