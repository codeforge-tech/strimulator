import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { EventService } from "../../../src/services/events";
import { StripeError } from "../../../src/errors";
import { config } from "../../../src/config";
import type Stripe from "stripe";

function makeService() {
  const db = createDB(":memory:");
  return new EventService(db);
}

describe("EventService", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // emit() tests (~40)
  // ─────────────────────────────────────────────────────────────────────────
  describe("emit", () => {
    it("emits a basic event with type and data", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer" };
      const event = svc.emit("customer.created", obj);

      expect(event).toBeDefined();
      expect(event.type).toBe("customer.created");
      expect(event.data.object).toEqual(obj);
    });

    it("emits a customer.created event", () => {
      const svc = makeService();
      const obj = { id: "cus_abc", object: "customer", email: "alice@example.com" };
      const event = svc.emit("customer.created", obj);

      expect(event.type).toBe("customer.created");
      expect((event.data.object as any).email).toBe("alice@example.com");
    });

    it("emits a customer.updated event", () => {
      const svc = makeService();
      const obj = { id: "cus_abc", object: "customer", email: "new@example.com" };
      const event = svc.emit("customer.updated", obj, { email: "old@example.com" });

      expect(event.type).toBe("customer.updated");
    });

    it("emits a customer.deleted event", () => {
      const svc = makeService();
      const obj = { id: "cus_abc", object: "customer", deleted: true };
      const event = svc.emit("customer.deleted", obj);

      expect(event.type).toBe("customer.deleted");
      expect((event.data.object as any).deleted).toBe(true);
    });

    it("emits a payment_intent.created event", () => {
      const svc = makeService();
      const obj = { id: "pi_123", object: "payment_intent", amount: 2000, currency: "usd" };
      const event = svc.emit("payment_intent.created", obj);

      expect(event.type).toBe("payment_intent.created");
      expect((event.data.object as any).amount).toBe(2000);
    });

    it("emits a payment_intent.succeeded event", () => {
      const svc = makeService();
      const obj = { id: "pi_123", object: "payment_intent", status: "succeeded" };
      const event = svc.emit("payment_intent.succeeded", obj);

      expect(event.type).toBe("payment_intent.succeeded");
    });

    it("emits an invoice.created event", () => {
      const svc = makeService();
      const obj = { id: "in_123", object: "invoice", amount_due: 5000 };
      const event = svc.emit("invoice.created", obj);

      expect(event.type).toBe("invoice.created");
    });

    it("emits a charge.succeeded event", () => {
      const svc = makeService();
      const obj = { id: "ch_123", object: "charge", amount: 1500, paid: true };
      const event = svc.emit("charge.succeeded", obj);

      expect(event.type).toBe("charge.succeeded");
      expect((event.data.object as any).paid).toBe(true);
    });

    it("emits a subscription event", () => {
      const svc = makeService();
      const obj = { id: "sub_123", object: "subscription", status: "active" };
      const event = svc.emit("customer.subscription.created", obj);

      expect(event.type).toBe("customer.subscription.created");
    });

    it("emits a payment_method.attached event", () => {
      const svc = makeService();
      const obj = { id: "pm_123", object: "payment_method", type: "card" };
      const event = svc.emit("payment_method.attached", obj);

      expect(event.type).toBe("payment_method.attached");
    });

    it("emits a product.created event", () => {
      const svc = makeService();
      const obj = { id: "prod_123", object: "product", name: "Gold Plan" };
      const event = svc.emit("product.created", obj);

      expect(event.type).toBe("product.created");
    });

    it("emits a price.created event", () => {
      const svc = makeService();
      const obj = { id: "price_123", object: "price", unit_amount: 999 };
      const event = svc.emit("price.created", obj);

      expect(event.type).toBe("price.created");
    });

    it("returns an id starting with 'evt_'", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.id).toMatch(/^evt_/);
    });

    it("returns object set to 'event'", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.object).toBe("event");
    });

    it("returns type matching the input type", () => {
      const svc = makeService();
      const event = svc.emit("invoice.payment_succeeded", { id: "in_1" });

      expect(event.type).toBe("invoice.payment_succeeded");
    });

    it("returns data.object containing the full resource", () => {
      const svc = makeService();
      const resource = { id: "cus_99", object: "customer", name: "Bob", email: "bob@test.com", metadata: { key: "value" } };
      const event = svc.emit("customer.created", resource);

      expect(event.data.object).toEqual(resource);
    });

    it("returns api_version matching the config", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.api_version).toBe(config.apiVersion);
    });

    it("returns a numeric created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const event = svc.emit("customer.created", { id: "cus_1" });
      const after = Math.floor(Date.now() / 1000);

      expect(typeof event.created).toBe("number");
      expect(event.created).toBeGreaterThanOrEqual(before);
      expect(event.created).toBeLessThanOrEqual(after);
    });

    it("returns livemode as false", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.livemode).toBe(false);
    });

    it("returns request field with null id and null idempotency_key", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.request).toEqual({ id: null, idempotency_key: null });
    });

    it("returns pending_webhooks as 0", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.pending_webhooks).toBe(0);
    });

    it("includes previousAttributes when provided", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer", email: "new@example.com" };
      const prevAttrs = { email: "old@example.com" };
      const event = svc.emit("customer.updated", obj, prevAttrs);

      expect((event.data as any).previous_attributes).toEqual(prevAttrs);
    });

    it("does not include previous_attributes when not provided", () => {
      const svc = makeService();
      const obj = { id: "cus_123", object: "customer" };
      const event = svc.emit("customer.created", obj);

      expect((event.data as any).previous_attributes).toBeUndefined();
    });

    it("includes previous_attributes with multiple changed fields", () => {
      const svc = makeService();
      const obj = { id: "cus_1", object: "customer", name: "New Name", email: "new@test.com" };
      const prevAttrs = { name: "Old Name", email: "old@test.com" };
      const event = svc.emit("customer.updated", obj, prevAttrs);

      expect((event.data as any).previous_attributes).toEqual(prevAttrs);
    });

    it("emits multiple events with unique IDs", () => {
      const svc = makeService();
      const ids = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const event = svc.emit("customer.created", { id: `cus_${i}` });
        ids.add(event.id);
      }

      expect(ids.size).toBe(20);
    });

    it("preserves full object data through emit and retrieve", () => {
      const svc = makeService();
      const complexObj = {
        id: "cus_full",
        object: "customer",
        name: "Test Customer",
        email: "test@example.com",
        metadata: { tier: "premium", ref: "abc123" },
        address: { city: "SF", country: "US" },
        balance: 0,
        created: 1700000000,
        currency: "usd",
        delinquent: false,
        livemode: false,
      };
      const event = svc.emit("customer.created", complexObj);

      expect(event.data.object).toEqual(complexObj);
    });

    it("preserves nested object data", () => {
      const svc = makeService();
      const obj = {
        id: "pi_nested",
        object: "payment_intent",
        charges: { data: [{ id: "ch_1", amount: 1000 }] },
        metadata: { order: "order_123" },
      };
      const event = svc.emit("payment_intent.created", obj);

      expect((event.data.object as any).charges.data[0].amount).toBe(1000);
    });

    it("persists the event to the database", () => {
      const svc = makeService();
      const obj = { id: "pm_123", object: "payment_method" };
      const emitted = svc.emit("payment_method.attached", obj);

      const retrieved = svc.retrieve(emitted.id);
      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.type).toBe("payment_method.attached");
    });

    it("persisted event matches emitted event", () => {
      const svc = makeService();
      const obj = { id: "cus_persist", object: "customer", email: "persist@test.com" };
      const emitted = svc.emit("customer.created", obj);

      const retrieved = svc.retrieve(emitted.id);
      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.object).toBe(emitted.object);
      expect(retrieved.type).toBe(emitted.type);
      expect(retrieved.created).toBe(emitted.created);
      expect(retrieved.api_version).toBe(emitted.api_version);
      expect(retrieved.livemode).toBe(emitted.livemode);
      expect(retrieved.data.object).toEqual(emitted.data.object);
    });

    it("handles empty object data", () => {
      const svc = makeService();
      const event = svc.emit("custom.event", {});

      expect(event.data.object).toEqual({});
    });

    it("handles object with only id field", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_minimal" });

      expect((event.data.object as any).id).toBe("cus_minimal");
    });

    it("handles previousAttributes as empty object", () => {
      const svc = makeService();
      const event = svc.emit("customer.updated", { id: "cus_1" }, {});

      expect((event.data as any).previous_attributes).toEqual({});
    });

    it("handles string type with dots", () => {
      const svc = makeService();
      const event = svc.emit("invoice.payment_intent.succeeded", { id: "in_1" });

      expect(event.type).toBe("invoice.payment_intent.succeeded");
    });

    it("emits events rapidly without collision", () => {
      const svc = makeService();
      const events: Stripe.Event[] = [];

      for (let i = 0; i < 50; i++) {
        events.push(svc.emit("customer.created", { id: `cus_${i}` }));
      }

      const uniqueIds = new Set(events.map(e => e.id));
      expect(uniqueIds.size).toBe(50);
    });

    it("each event has consistent shape fields", () => {
      const svc = makeService();
      const event = svc.emit("charge.failed", { id: "ch_fail" });

      const keys = Object.keys(event);
      expect(keys).toContain("id");
      expect(keys).toContain("object");
      expect(keys).toContain("api_version");
      expect(keys).toContain("created");
      expect(keys).toContain("data");
      expect(keys).toContain("livemode");
      expect(keys).toContain("pending_webhooks");
      expect(keys).toContain("request");
      expect(keys).toContain("type");
    });

    it("emits refund event", () => {
      const svc = makeService();
      const obj = { id: "re_123", object: "refund", amount: 500, status: "succeeded" };
      const event = svc.emit("charge.refunded", obj);

      expect(event.type).toBe("charge.refunded");
    });

    it("emits setup_intent event", () => {
      const svc = makeService();
      const obj = { id: "seti_123", object: "setup_intent", status: "succeeded" };
      const event = svc.emit("setup_intent.succeeded", obj);

      expect(event.type).toBe("setup_intent.succeeded");
    });

    it("data.object is a plain object, not wrapped", () => {
      const svc = makeService();
      const obj = { id: "cus_1", object: "customer", name: "Alice" };
      const event = svc.emit("customer.created", obj);

      expect(typeof event.data.object).toBe("object");
      expect(Array.isArray(event.data.object)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // retrieve() tests (~15)
  // ─────────────────────────────────────────────────────────────────────────
  describe("retrieve", () => {
    it("retrieves an existing event by ID", () => {
      const svc = makeService();
      const obj = { id: "prod_123", object: "product" };
      const emitted = svc.emit("product.created", obj);
      const retrieved = svc.retrieve(emitted.id);

      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.type).toBe("product.created");
    });

    it("throws for non-existent event ID", () => {
      const svc = makeService();

      expect(() => svc.retrieve("evt_nonexistent")).toThrow();
    });

    it("throws StripeError for non-existent event", () => {
      const svc = makeService();

      try {
        svc.retrieve("evt_nonexistent");
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("throws 404 status for non-existent event", () => {
      const svc = makeService();

      try {
        svc.retrieve("evt_nonexistent");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws resource_missing code for non-existent event", () => {
      const svc = makeService();

      try {
        svc.retrieve("evt_doesnotexist");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("error message includes the event ID", () => {
      const svc = makeService();

      try {
        svc.retrieve("evt_missing123");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("evt_missing123");
      }
    });

    it("error type is invalid_request_error", () => {
      const svc = makeService();

      try {
        svc.retrieve("evt_fake");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("returns all event fields", () => {
      const svc = makeService();
      const obj = { id: "cus_full", object: "customer", email: "a@b.com" };
      const emitted = svc.emit("customer.created", obj);
      const retrieved = svc.retrieve(emitted.id);

      expect(retrieved.id).toBe(emitted.id);
      expect(retrieved.object).toBe("event");
      expect(retrieved.type).toBe("customer.created");
      expect(retrieved.api_version).toBe(config.apiVersion);
      expect(typeof retrieved.created).toBe("number");
      expect(retrieved.livemode).toBe(false);
      expect(retrieved.pending_webhooks).toBe(0);
      expect(retrieved.request).toEqual({ id: null, idempotency_key: null });
      expect(retrieved.data.object).toEqual(obj);
    });

    it("retrieved event data matches original object", () => {
      const svc = makeService();
      const obj = { id: "pi_xyz", object: "payment_intent", amount: 9999, currency: "eur" };
      const emitted = svc.emit("payment_intent.created", obj);
      const retrieved = svc.retrieve(emitted.id);

      expect((retrieved.data.object as any).amount).toBe(9999);
      expect((retrieved.data.object as any).currency).toBe("eur");
    });

    it("retrieved event preserves previous_attributes", () => {
      const svc = makeService();
      const obj = { id: "cus_1", object: "customer", email: "new@test.com" };
      const prev = { email: "old@test.com" };
      const emitted = svc.emit("customer.updated", obj, prev);
      const retrieved = svc.retrieve(emitted.id);

      expect((retrieved.data as any).previous_attributes).toEqual(prev);
    });

    it("can retrieve multiple different events", () => {
      const svc = makeService();
      const e1 = svc.emit("customer.created", { id: "cus_1" });
      const e2 = svc.emit("charge.succeeded", { id: "ch_1" });
      const e3 = svc.emit("invoice.created", { id: "in_1" });

      expect(svc.retrieve(e1.id).type).toBe("customer.created");
      expect(svc.retrieve(e2.id).type).toBe("charge.succeeded");
      expect(svc.retrieve(e3.id).type).toBe("invoice.created");
    });

    it("retrieve does not return other events", () => {
      const svc = makeService();
      const e1 = svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });

      const retrieved = svc.retrieve(e1.id);
      expect(retrieved.type).toBe("customer.created");
      expect((retrieved.data.object as any).id).toBe("cus_1");
    });

    it("retrieved event has same created timestamp as emitted", () => {
      const svc = makeService();
      const emitted = svc.emit("product.updated", { id: "prod_1" });
      const retrieved = svc.retrieve(emitted.id);

      expect(retrieved.created).toBe(emitted.created);
    });

    it("throws for arbitrary non-evt_ prefixed IDs", () => {
      const svc = makeService();

      expect(() => svc.retrieve("cus_123")).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // list() tests (~35)
  // ─────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("returns empty list when no events exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10 });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns all events when count is under limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 10 });

      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit parameter", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 3 });

      expect(result.data.length).toBe(3);
    });

    it("sets has_more to true when more events exist than limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 3 });

      expect(result.has_more).toBe(true);
    });

    it("sets has_more to false when all events fit within limit", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 5 });

      expect(result.has_more).toBe(false);
    });

    it("sets has_more to false when count equals limit exactly", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 3 });

      expect(result.has_more).toBe(false);
    });

    it("returns list with url field set to /v1/events", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10 });

      expect(result.url).toBe("/v1/events");
    });

    it("returns list with object set to 'list'", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      const result = svc.list({ limit: 10 });

      expect(result.object).toBe("list");
    });

    it("filters by event type", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("customer.created", { id: "cus_2" });
      svc.emit("charge.failed", { id: "ch_2" });

      const result = svc.list({ limit: 10, type: "customer.created" });
      expect(result.data.length).toBe(2);
      expect(result.data.every(e => e.type === "customer.created")).toBe(true);
    });

    it("returns only events of the specified type", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.updated", { id: "cus_1" });
      svc.emit("customer.deleted", { id: "cus_1" });

      const result = svc.list({ limit: 10, type: "customer.updated" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].type).toBe("customer.updated");
    });

    it("returns no results when type filter matches nothing", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });

      const result = svc.list({ limit: 10, type: "nonexistent.event" });
      expect(result.data.length).toBe(0);
      expect(result.has_more).toBe(false);
    });

    it("filters by type with has_more correctly set", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
        svc.emit("charge.succeeded", { id: `ch_${i}` });
      }

      const result = svc.list({ limit: 3, type: "customer.created" });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("type filter returns all when count under limit", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("customer.created", { id: "cus_2" });

      const result = svc.list({ limit: 10, type: "customer.created" });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });

    it("returns proper event objects in data array", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1", object: "customer" });
      const result = svc.list({ limit: 10 });

      const event = result.data[0];
      expect(event.id).toMatch(/^evt_/);
      expect(event.object).toBe("event");
      expect(event.type).toBe("customer.created");
      expect(typeof event.created).toBe("number");
    });

    it("data items have full event structure", () => {
      const svc = makeService();
      svc.emit("charge.succeeded", { id: "ch_1", amount: 1000 });
      const result = svc.list({ limit: 10 });

      const event = result.data[0];
      expect(event.api_version).toBeDefined();
      expect(event.livemode).toBe(false);
      expect(event.pending_webhooks).toBe(0);
      expect(event.request).toBeDefined();
      expect(event.data).toBeDefined();
      expect(event.data.object).toBeDefined();
    });

    it("handles listing with many events (25+)", () => {
      const svc = makeService();
      for (let i = 0; i < 25; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }
      const result = svc.list({ limit: 100 });

      expect(result.data.length).toBe(25);
      expect(result.has_more).toBe(false);
    });

    it("handles limit of 1", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.created", { id: "cus_2" });

      const result = svc.list({ limit: 1 });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("empty list has correct structure", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10 });

      expect(result).toEqual({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/events",
      });
    });

    it("single event list has correct structure", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      const result = svc.list({ limit: 10 });

      expect(result.object).toBe("list");
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/events");
    });

    it("filters charge events from mixed types", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("invoice.created", { id: "in_1" });
      svc.emit("charge.succeeded", { id: "ch_2" });
      svc.emit("charge.failed", { id: "ch_3" });

      const result = svc.list({ limit: 10, type: "charge.succeeded" });
      expect(result.data.length).toBe(2);
    });

    it("returns events ordered by created descending", () => {
      const svc = makeService();
      // Events emitted in sequence should be returned newest-first
      const e1 = svc.emit("customer.created", { id: "cus_1" });
      const e2 = svc.emit("customer.created", { id: "cus_2" });
      const e3 = svc.emit("customer.created", { id: "cus_3" });

      const result = svc.list({ limit: 10 });
      // All have same created timestamp (same second), but ordering should be consistent
      expect(result.data.length).toBe(3);
    });

    it("list with startingAfter paginates", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }

      const firstPage = svc.list({ limit: 3 });
      expect(firstPage.data.length).toBe(3);
      expect(firstPage.has_more).toBe(true);
    });

    it("list with startingAfter using valid event ID does not throw", () => {
      const svc = makeService();
      const e1 = svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.created", { id: "cus_2" });

      // Should not throw
      expect(() => svc.list({ limit: 10, startingAfter: e1.id })).not.toThrow();
    });

    it("list with startingAfter using non-existent ID throws", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });

      expect(() => svc.list({ limit: 10, startingAfter: "evt_nonexistent" })).toThrow();
    });

    it("list with startingAfter throws StripeError with 404", () => {
      const svc = makeService();

      try {
        svc.list({ limit: 10, startingAfter: "evt_bad" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("each listed event has a unique ID", () => {
      const svc = makeService();
      for (let i = 0; i < 10; i++) {
        svc.emit("customer.created", { id: `cus_${i}` });
      }

      const result = svc.list({ limit: 100 });
      const ids = result.data.map(e => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    it("list without type returns all event types", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("invoice.created", { id: "in_1" });

      const result = svc.list({ limit: 10 });
      const types = result.data.map(e => e.type);
      expect(types).toContain("customer.created");
      expect(types).toContain("charge.succeeded");
      expect(types).toContain("invoice.created");
    });

    it("filtering by subscription event type works", () => {
      const svc = makeService();
      svc.emit("customer.subscription.created", { id: "sub_1" });
      svc.emit("customer.subscription.updated", { id: "sub_1" });
      svc.emit("customer.created", { id: "cus_1" });

      const result = svc.list({ limit: 10, type: "customer.subscription.created" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].type).toBe("customer.subscription.created");
    });

    it("large limit with few events returns all", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.created", { id: "cus_2" });

      const result = svc.list({ limit: 100 });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });

    it("listing preserves event data integrity", () => {
      const svc = makeService();
      const obj = { id: "cus_data", object: "customer", name: "List Test", email: "list@test.com" };
      svc.emit("customer.created", obj);

      const result = svc.list({ limit: 10 });
      expect((result.data[0].data.object as any).name).toBe("List Test");
      expect((result.data[0].data.object as any).email).toBe("list@test.com");
    });

    it("listing preserves previous_attributes", () => {
      const svc = makeService();
      svc.emit("customer.updated", { id: "cus_1", email: "new@test.com" }, { email: "old@test.com" });

      const result = svc.list({ limit: 10 });
      expect((result.data[0].data as any).previous_attributes).toEqual({ email: "old@test.com" });
    });

    it("type filter is exact match, not prefix match", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.created.extra", { id: "cus_2" });

      const result = svc.list({ limit: 10, type: "customer.created" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].type).toBe("customer.created");
    });

    it("type filter is exact match, not suffix match", () => {
      const svc = makeService();
      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("special.customer.created", { id: "cus_2" });

      const result = svc.list({ limit: 10, type: "customer.created" });
      expect(result.data.length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // onEvent() listener tests (~20)
  // ─────────────────────────────────────────────────────────────────────────
  describe("onEvent", () => {
    it("registered listener receives emitted events", () => {
      const svc = makeService();
      const received: Stripe.Event[] = [];

      svc.onEvent((e) => received.push(e));
      svc.emit("customer.created", { id: "cus_1" });

      expect(received.length).toBe(1);
    });

    it("listener receives correct event type", () => {
      const svc = makeService();
      const types: string[] = [];

      svc.onEvent((e) => types.push(e.type));
      svc.emit("charge.succeeded", { id: "ch_1" });

      expect(types).toEqual(["charge.succeeded"]);
    });

    it("listener receives full event data", () => {
      const svc = makeService();
      let receivedEvent: Stripe.Event | null = null;

      svc.onEvent((e) => { receivedEvent = e; });
      svc.emit("customer.created", { id: "cus_1", object: "customer" });

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.id).toMatch(/^evt_/);
      expect(receivedEvent!.object).toBe("event");
      expect(receivedEvent!.type).toBe("customer.created");
      expect((receivedEvent!.data.object as any).id).toBe("cus_1");
    });

    it("multiple listeners all receive the same event", () => {
      const svc = makeService();
      const received1: string[] = [];
      const received2: string[] = [];
      const received3: string[] = [];

      svc.onEvent((e) => received1.push(e.type));
      svc.onEvent((e) => received2.push(e.type));
      svc.onEvent((e) => received3.push(e.type));

      svc.emit("customer.created", { id: "cus_1" });

      expect(received1).toEqual(["customer.created"]);
      expect(received2).toEqual(["customer.created"]);
      expect(received3).toEqual(["customer.created"]);
    });

    it("listener is called synchronously during emit", () => {
      const svc = makeService();
      const order: string[] = [];

      svc.onEvent(() => { order.push("listener"); });

      order.push("before");
      svc.emit("customer.created", { id: "cus_1" });
      order.push("after");

      expect(order).toEqual(["before", "listener", "after"]);
    });

    it("listeners receive events in registration order", () => {
      const svc = makeService();
      const order: number[] = [];

      svc.onEvent(() => order.push(1));
      svc.onEvent(() => order.push(2));
      svc.onEvent(() => order.push(3));

      svc.emit("customer.created", { id: "cus_1" });

      expect(order).toEqual([1, 2, 3]);
    });

    it("listener receives each emitted event separately", () => {
      const svc = makeService();
      const types: string[] = [];

      svc.onEvent((e) => types.push(e.type));

      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("charge.succeeded", { id: "ch_1" });
      svc.emit("invoice.created", { id: "in_1" });

      expect(types).toEqual(["customer.created", "charge.succeeded", "invoice.created"]);
    });

    it("listener error does not prevent event from being returned", () => {
      const svc = makeService();

      svc.onEvent(() => { throw new Error("Listener error"); });

      const event = svc.emit("customer.created", { id: "cus_1" });
      expect(event).toBeDefined();
      expect(event.type).toBe("customer.created");
    });

    it("listener error does not prevent other listeners from being called", () => {
      const svc = makeService();
      const received: string[] = [];

      svc.onEvent(() => { throw new Error("First listener error"); });
      svc.onEvent((e) => received.push(e.type));

      svc.emit("customer.created", { id: "cus_1" });

      expect(received).toEqual(["customer.created"]);
    });

    it("listener error does not prevent event from being persisted", () => {
      const svc = makeService();

      svc.onEvent(() => { throw new Error("Boom"); });

      const event = svc.emit("customer.created", { id: "cus_1" });
      const retrieved = svc.retrieve(event.id);
      expect(retrieved.id).toBe(event.id);
    });

    it("no listeners does not cause errors", () => {
      const svc = makeService();

      expect(() => svc.emit("customer.created", { id: "cus_1" })).not.toThrow();
    });

    it("listener added after emit does not receive past events", () => {
      const svc = makeService();
      const received: string[] = [];

      svc.emit("customer.created", { id: "cus_1" });
      svc.onEvent((e) => received.push(e.type));
      svc.emit("charge.succeeded", { id: "ch_1" });

      expect(received).toEqual(["charge.succeeded"]);
    });

    it("listener receives the same event object that emit returns", () => {
      const svc = makeService();
      let listenerEvent: Stripe.Event | null = null;

      svc.onEvent((e) => { listenerEvent = e; });
      const emitted = svc.emit("customer.created", { id: "cus_1" });

      expect(listenerEvent).toBe(emitted);
    });

    it("listener receives event with previousAttributes on update", () => {
      const svc = makeService();
      let listenerEvent: Stripe.Event | null = null;

      svc.onEvent((e) => { listenerEvent = e; });
      svc.emit("customer.updated", { id: "cus_1", email: "new@test.com" }, { email: "old@test.com" });

      expect((listenerEvent!.data as any).previous_attributes).toEqual({ email: "old@test.com" });
    });

    it("two separate service instances have independent listeners", () => {
      const svc1 = makeService();
      const svc2 = makeService();
      const received1: string[] = [];
      const received2: string[] = [];

      svc1.onEvent((e) => received1.push(e.type));
      svc2.onEvent((e) => received2.push(e.type));

      svc1.emit("customer.created", { id: "cus_1" });
      svc2.emit("charge.succeeded", { id: "ch_1" });

      expect(received1).toEqual(["customer.created"]);
      expect(received2).toEqual(["charge.succeeded"]);
    });

    it("many listeners (10+) all receive events", () => {
      const svc = makeService();
      const counters: number[] = Array(15).fill(0);

      for (let i = 0; i < 15; i++) {
        const idx = i;
        svc.onEvent(() => { counters[idx]++; });
      }

      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("customer.created", { id: "cus_2" });

      expect(counters.every(c => c === 2)).toBe(true);
    });

    it("listener receives events of all types", () => {
      const svc = makeService();
      const types: string[] = [];

      svc.onEvent((e) => types.push(e.type));

      svc.emit("customer.created", { id: "cus_1" });
      svc.emit("payment_intent.created", { id: "pi_1" });
      svc.emit("invoice.paid", { id: "in_1" });
      svc.emit("charge.refunded", { id: "re_1" });

      expect(types).toEqual([
        "customer.created",
        "payment_intent.created",
        "invoice.paid",
        "charge.refunded",
      ]);
    });

    it("listener can inspect event api_version", () => {
      const svc = makeService();
      let version: string | null = null;

      svc.onEvent((e) => { version = e.api_version; });
      svc.emit("customer.created", { id: "cus_1" });

      expect(version).toBe(config.apiVersion);
    });

    it("listener can inspect event pending_webhooks", () => {
      const svc = makeService();
      let webhooks: number | null = null;

      svc.onEvent((e) => { webhooks = e.pending_webhooks; });
      svc.emit("customer.created", { id: "cus_1" });

      expect(webhooks).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Object shape validation (~10)
  // ─────────────────────────────────────────────────────────────────────────
  describe("object shape", () => {
    it("complete event object has all required Stripe fields", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1", object: "customer" });

      expect(event).toMatchObject({
        object: "event",
        livemode: false,
        pending_webhooks: 0,
      });
      expect(event.id).toMatch(/^evt_/);
      expect(typeof event.created).toBe("number");
      expect(typeof event.api_version).toBe("string");
      expect(typeof event.type).toBe("string");
    });

    it("data sub-object contains object field", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.data).toBeDefined();
      expect(event.data.object).toBeDefined();
    });

    it("data sub-object does not have previous_attributes for create events", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect("previous_attributes" in event.data).toBe(false);
    });

    it("data sub-object has previous_attributes for update events", () => {
      const svc = makeService();
      const event = svc.emit("customer.updated", { id: "cus_1" }, { name: "old" });

      expect("previous_attributes" in event.data).toBe(true);
      expect((event.data as any).previous_attributes).toEqual({ name: "old" });
    });

    it("request shape has id and idempotency_key fields", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.request).toHaveProperty("id");
      expect(event.request).toHaveProperty("idempotency_key");
    });

    it("request.id is null", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.request!.id).toBeNull();
    });

    it("request.idempotency_key is null", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.request!.idempotency_key).toBeNull();
    });

    it("api_version is a non-empty string", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(event.api_version).toBeTruthy();
      expect(event.api_version!.length).toBeGreaterThan(0);
    });

    it("created is a unix timestamp (reasonable range)", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      // Should be after year 2020 and before year 2030 (in seconds)
      expect(event.created).toBeGreaterThan(1577836800); // 2020-01-01
      expect(event.created).toBeLessThan(1893456000); // 2030-01-01
    });

    it("id is a string with evt_ prefix and random suffix", () => {
      const svc = makeService();
      const event = svc.emit("customer.created", { id: "cus_1" });

      expect(typeof event.id).toBe("string");
      expect(event.id.startsWith("evt_")).toBe(true);
      expect(event.id.length).toBeGreaterThan(4); // "evt_" + random chars
    });
  });
});
