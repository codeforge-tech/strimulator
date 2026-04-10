import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import type { StrimulatorDB } from "../../../src/db";
import { TestClockService } from "../../../src/services/test-clocks";
import { EventService } from "../../../src/services/events";
import { InvoiceService } from "../../../src/services/invoices";
import { PriceService } from "../../../src/services/prices";
import { SubscriptionService } from "../../../src/services/subscriptions";
import { StripeError } from "../../../src/errors";
import { subscriptions, subscriptionItems } from "../../../src/db/schema/subscriptions";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

function makeService() {
  const db = createDB(":memory:");
  return new TestClockService(db);
}

/** Creates all services needed for billing-related test clock tests. */
function makeServices() {
  const db = createDB(":memory:");
  const eventService = new EventService(db);
  const invoiceService = new InvoiceService(db);
  const priceService = new PriceService(db);
  const subscriptionService = new SubscriptionService(db, invoiceService, priceService);
  const testClockService = new TestClockService(db, eventService, invoiceService);

  return { db, eventService, invoiceService, priceService, subscriptionService, testClockService };
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/**
 * Helper: creates a product-less price and a subscription linked to a test clock.
 * Returns the subscription, price, and clock.
 */
function createLinkedSubscription(
  services: ReturnType<typeof makeServices>,
  opts: {
    frozenTime: number;
    unitAmount?: number;
    quantity?: number;
    trialDays?: number;
    clockId?: string;
    clockName?: string;
  },
) {
  const { db, priceService, testClockService } = services;

  // Create or reuse clock
  const clock = opts.clockId
    ? testClockService.retrieve(opts.clockId)
    : testClockService.create({ frozen_time: opts.frozenTime, name: opts.clockName });

  // Create a price
  const price = priceService.create({
    product: "prod_test",
    currency: "usd",
    unit_amount: opts.unitAmount ?? 2000,
    recurring: { interval: "month" },
  });

  const createdAt = opts.frozenTime;
  const periodEnd = createdAt + THIRTY_DAYS;
  const quantity = opts.quantity ?? 1;

  // Determine status and trial
  let status = "active";
  let trialStart: number | null = null;
  let trialEnd: number | null = null;
  if (opts.trialDays && opts.trialDays > 0) {
    status = "trialing";
    trialStart = createdAt;
    trialEnd = createdAt + opts.trialDays * 24 * 60 * 60;
  }

  // Build subscription item shape
  const itemId = `si_test_${Math.random().toString(36).slice(2, 8)}`;
  const itemShape = {
    id: itemId,
    object: "subscription_item",
    created: createdAt,
    metadata: {},
    price: {
      id: price.id,
      object: "price",
      active: true,
      currency: "usd",
      unit_amount: opts.unitAmount ?? 2000,
      type: "recurring",
      recurring: { interval: "month", interval_count: 1 },
    },
    quantity,
    subscription: "",
  };

  // Insert subscription directly into DB (bypasses SubscriptionService to control timestamps)
  const subId = `sub_test_${Math.random().toString(36).slice(2, 8)}`;
  itemShape.subscription = subId;

  const subShape = {
    id: subId,
    object: "subscription",
    billing_cycle_anchor: createdAt,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    collection_method: "charge_automatically",
    created: createdAt,
    currency: "usd",
    current_period_end: periodEnd,
    current_period_start: createdAt,
    customer: "cus_test",
    default_payment_method: null,
    ended_at: null,
    items: {
      object: "list",
      data: [itemShape],
      has_more: false,
      url: `/v1/subscription_items?subscription=${subId}`,
    },
    latest_invoice: null,
    livemode: false,
    metadata: {},
    status,
    test_clock: clock.id,
    trial_end: trialEnd,
    trial_start: trialStart,
  };

  db.insert(subscriptions).values({
    id: subId,
    customerId: "cus_test",
    status,
    currentPeriodStart: createdAt,
    currentPeriodEnd: periodEnd,
    testClockId: clock.id,
    created: createdAt,
    data: JSON.stringify(subShape),
  }).run();

  db.insert(subscriptionItems).values({
    id: itemId,
    subscriptionId: subId,
    priceId: price.id,
    quantity,
    created: createdAt,
    data: JSON.stringify(itemShape),
  }).run();

  return { clock, price, subscription: subShape, subId, itemId };
}

describe("TestClockService", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // create() tests (~25)
  // ─────────────────────────────────────────────────────────────────────────
  describe("create", () => {
    it("creates a test clock with the given frozen_time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      expect(clock.frozen_time).toBe(frozenTime);
    });

    it("creates a test clock with a name", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000, name: "My Clock" });

      expect(clock.name).toBe("My Clock");
    });

    it("creates a test clock without a name (defaults to null)", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.name).toBeNull();
    });

    it("returns id starting with 'clock_'", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.id).toMatch(/^clock_/);
    });

    it("returns object as 'test_helpers.test_clock'", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.object).toBe("test_helpers.test_clock");
    });

    it("returns status as 'ready'", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.status).toBe("ready");
    });

    it("returns frozen_time matching the input", () => {
      const svc = makeService();
      const frozenTime = 1710000000;
      const clock = svc.create({ frozen_time: frozenTime });

      expect(clock.frozen_time).toBe(frozenTime);
    });

    it("returns a numeric created timestamp", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(typeof clock.created).toBe("number");
    });

    it("created timestamp is approximately now", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: 1700000000 });
      const after = Math.floor(Date.now() / 1000);

      expect(clock.created).toBeGreaterThanOrEqual(before);
      expect(clock.created).toBeLessThanOrEqual(after);
    });

    it("returns livemode as false", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.livemode).toBe(false);
    });

    it("stores name correctly when provided", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000, name: "Billing Test Clock" });

      expect(clock.name).toBe("Billing Test Clock");
    });

    it("creates multiple clocks with unique IDs", () => {
      const svc = makeService();
      const ids = new Set<string>();

      for (let i = 0; i < 15; i++) {
        const clock = svc.create({ frozen_time: 1700000000 + i });
        ids.add(clock.id);
      }

      expect(ids.size).toBe(15);
    });

    it("sets deletes_after to 30 days after created", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: 1700000000 });
      const after = Math.floor(Date.now() / 1000);

      expect(clock.deletes_after).toBeGreaterThanOrEqual(before + THIRTY_DAYS);
      expect(clock.deletes_after).toBeLessThanOrEqual(after + THIRTY_DAYS);
    });

    it("deletes_after is exactly created + 30 days", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.deletes_after).toBe(clock.created + THIRTY_DAYS);
    });

    it("frozen_time can be in the past", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1000000000 }); // year 2001

      expect(clock.frozen_time).toBe(1000000000);
    });

    it("frozen_time can be in the future", () => {
      const svc = makeService();
      const futureTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year from now
      const clock = svc.create({ frozen_time: futureTime });

      expect(clock.frozen_time).toBe(futureTime);
    });

    it("name can be an empty string", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000, name: "" });

      expect(clock.name).toBe("");
    });

    it("name can be a long string", () => {
      const svc = makeService();
      const longName = "A".repeat(200);
      const clock = svc.create({ frozen_time: 1700000000, name: longName });

      expect(clock.name).toBe(longName);
    });

    it("clock is persisted and retrievable", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000, name: "Persist Test" });
      const retrieved = svc.retrieve(clock.id);

      expect(retrieved.id).toBe(clock.id);
      expect(retrieved.frozen_time).toBe(1700000000);
      expect(retrieved.name).toBe("Persist Test");
    });

    it("each clock has its own frozen_time", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000 });
      const c2 = svc.create({ frozen_time: 1800000000 });

      expect(c1.frozen_time).toBe(1700000000);
      expect(c2.frozen_time).toBe(1800000000);
    });

    it("complete object shape has all expected fields", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000, name: "Shape Test" });

      const keys = Object.keys(clock);
      expect(keys).toContain("id");
      expect(keys).toContain("object");
      expect(keys).toContain("created");
      expect(keys).toContain("deletes_after");
      expect(keys).toContain("frozen_time");
      expect(keys).toContain("livemode");
      expect(keys).toContain("name");
      expect(keys).toContain("status");
    });

    it("id is a string", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(typeof clock.id).toBe("string");
    });

    it("id has more than just the prefix", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      expect(clock.id.length).toBeGreaterThan("clock_".length);
    });

    it("frozen_time of 0 is allowed", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 0 });

      expect(clock.frozen_time).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // retrieve() tests (~15)
  // ─────────────────────────────────────────────────────────────────────────
  describe("retrieve", () => {
    it("retrieves an existing clock by ID", () => {
      const svc = makeService();
      const created = svc.create({ frozen_time: 1700000000, name: "Test" });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.id).toBe(created.id);
    });

    it("retrieved clock has correct frozen_time", () => {
      const svc = makeService();
      const created = svc.create({ frozen_time: 1700000000 });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.frozen_time).toBe(1700000000);
    });

    it("retrieved clock has correct name", () => {
      const svc = makeService();
      const created = svc.create({ frozen_time: 1700000000, name: "Named" });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.name).toBe("Named");
    });

    it("retrieved clock has correct status", () => {
      const svc = makeService();
      const created = svc.create({ frozen_time: 1700000000 });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.status).toBe("ready");
    });

    it("retrieved clock has all fields", () => {
      const svc = makeService();
      const created = svc.create({ frozen_time: 1700000000, name: "Full" });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.object).toBe("test_helpers.test_clock");
      expect(retrieved.livemode).toBe(false);
      expect(typeof retrieved.created).toBe("number");
      expect(typeof retrieved.deletes_after).toBe("number");
    });

    it("throws for non-existent clock ID", () => {
      const svc = makeService();

      expect(() => svc.retrieve("clock_nonexistent")).toThrow();
    });

    it("throws StripeError for non-existent clock", () => {
      const svc = makeService();

      try {
        svc.retrieve("clock_fake");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("throws 404 for non-existent clock", () => {
      const svc = makeService();

      try {
        svc.retrieve("clock_missing");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws resource_missing code for non-existent clock", () => {
      const svc = makeService();

      try {
        svc.retrieve("clock_gone");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("error message includes the clock ID", () => {
      const svc = makeService();

      try {
        svc.retrieve("clock_xyz123");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("clock_xyz123");
      }
    });

    it("retrieve after advance shows updated frozen_time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const newTime = frozenTime + 3600;
      svc.advance(clock.id, newTime);

      const retrieved = svc.retrieve(clock.id);
      expect(retrieved.frozen_time).toBe(newTime);
    });

    it("retrieve after advance shows status ready", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });
      svc.advance(clock.id, frozenTime + 3600);

      const retrieved = svc.retrieve(clock.id);
      expect(retrieved.status).toBe("ready");
    });

    it("can retrieve multiple different clocks", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000, name: "Clock 1" });
      const c2 = svc.create({ frozen_time: 1800000000, name: "Clock 2" });
      const c3 = svc.create({ frozen_time: 1900000000, name: "Clock 3" });

      expect(svc.retrieve(c1.id).name).toBe("Clock 1");
      expect(svc.retrieve(c2.id).name).toBe("Clock 2");
      expect(svc.retrieve(c3.id).name).toBe("Clock 3");
    });

    it("retrieve does not return other clocks", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000, name: "First" });
      svc.create({ frozen_time: 1800000000, name: "Second" });

      const retrieved = svc.retrieve(c1.id);
      expect(retrieved.name).toBe("First");
    });

    it("error type is invalid_request_error", () => {
      const svc = makeService();

      try {
        svc.retrieve("clock_nope");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // del() tests (~15)
  // ─────────────────────────────────────────────────────────────────────────
  describe("del", () => {
    it("deletes an existing clock", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      const result = svc.del(clock.id);
      expect(result).toBeDefined();
    });

    it("returns object with deleted: true", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      const result = svc.del(clock.id);
      expect(result.deleted).toBe(true);
    });

    it("returns the clock ID in the response", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      const result = svc.del(clock.id);
      expect(result.id).toBe(clock.id);
    });

    it("returns object type in the response", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      const result = svc.del(clock.id);
      expect(result.object).toBe("test_helpers.test_clock");
    });

    it("deleted response has correct shape", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      const result = svc.del(clock.id);
      expect(result).toEqual({
        id: clock.id,
        object: "test_helpers.test_clock",
        deleted: true,
      });
    });

    it("retrieve throws after deletion", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      svc.del(clock.id);
      expect(() => svc.retrieve(clock.id)).toThrow();
    });

    it("deleted clock no longer appears in list", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000 });
      const c2 = svc.create({ frozen_time: 1800000000 });

      svc.del(c1.id);
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(c2.id);
    });

    it("throws for non-existent clock", () => {
      const svc = makeService();

      expect(() => svc.del("clock_nonexistent")).toThrow();
    });

    it("throws StripeError for non-existent clock", () => {
      const svc = makeService();

      try {
        svc.del("clock_fake");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("throws 404 for non-existent clock", () => {
      const svc = makeService();

      try {
        svc.del("clock_missing");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("deleting twice throws on second attempt", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });

      svc.del(clock.id);
      expect(() => svc.del(clock.id)).toThrow();
    });

    it("deleting one clock does not affect others", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000, name: "Keep" });
      const c2 = svc.create({ frozen_time: 1800000000, name: "Delete" });

      svc.del(c2.id);

      const retrieved = svc.retrieve(c1.id);
      expect(retrieved.name).toBe("Keep");
    });

    it("preserves the original ID in delete response", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });
      const originalId = clock.id;

      const result = svc.del(clock.id);
      expect(result.id).toBe(originalId);
    });

    it("can create a new clock after deleting all", () => {
      const svc = makeService();
      const c1 = svc.create({ frozen_time: 1700000000 });
      svc.del(c1.id);

      const c2 = svc.create({ frozen_time: 1800000000 });
      expect(c2.id).toMatch(/^clock_/);
      expect(svc.retrieve(c2.id).frozen_time).toBe(1800000000);
    });

    it("delete after advance works", () => {
      const svc = makeService();
      const clock = svc.create({ frozen_time: 1700000000 });
      svc.advance(clock.id, 1700003600);

      const result = svc.del(clock.id);
      expect(result.deleted).toBe(true);
      expect(() => svc.retrieve(clock.id)).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // advance() tests (~40)
  // ─────────────────────────────────────────────────────────────────────────
  describe("advance", () => {
    it("advances to a future time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + 3600);
      expect(advanced.frozen_time).toBe(frozenTime + 3600);
    });

    it("updates the frozen_time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      svc.advance(clock.id, frozenTime + 7200);

      const retrieved = svc.retrieve(clock.id);
      expect(retrieved.frozen_time).toBe(frozenTime + 7200);
    });

    it("throws when advancing to the same time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      expect(() => svc.advance(clock.id, frozenTime)).toThrow();
    });

    it("throws when advancing to a past time", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      expect(() => svc.advance(clock.id, frozenTime - 100)).toThrow();
    });

    it("throws StripeError when advancing backward", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      try {
        svc.advance(clock.id, frozenTime - 1);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error message mentions frozen_time when advancing backward", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      try {
        svc.advance(clock.id, frozenTime - 1);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("frozen_time");
      }
    });

    it("error param is frozen_time when advancing backward", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      try {
        svc.advance(clock.id, frozenTime - 1);
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("frozen_time");
      }
    });

    it("throws 404 when advancing non-existent clock", () => {
      const svc = makeService();

      try {
        svc.advance("clock_nonexistent", 1700000000);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("status is ready after advance completes", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + 3600);
      expect(advanced.status).toBe("ready");
    });

    it("can advance multiple times sequentially", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      svc.advance(clock.id, frozenTime + 3600);
      svc.advance(clock.id, frozenTime + 7200);
      const advanced = svc.advance(clock.id, frozenTime + 10800);

      expect(advanced.frozen_time).toBe(frozenTime + 10800);
    });

    it("advance with no linked subscriptions succeeds", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + THIRTY_DAYS + 1);
      expect(advanced.frozen_time).toBe(frozenTime + THIRTY_DAYS + 1);
    });

    it("advance by small amount (1 second)", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + 1);
      expect(advanced.frozen_time).toBe(frozenTime + 1);
    });

    it("advance by large amount (1 year)", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });
      const oneYear = 365 * 24 * 60 * 60;

      const advanced = svc.advance(clock.id, frozenTime + oneYear);
      expect(advanced.frozen_time).toBe(frozenTime + oneYear);
    });

    it("advance preserves other clock fields", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime, name: "My Clock" });

      const advanced = svc.advance(clock.id, frozenTime + 3600);
      expect(advanced.name).toBe("My Clock");
      expect(advanced.object).toBe("test_helpers.test_clock");
      expect(advanced.livemode).toBe(false);
    });

    it("advance preserves the created timestamp", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + 3600);
      expect(advanced.created).toBe(clock.created);
    });

    it("advance preserves deletes_after", () => {
      const svc = makeService();
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + 3600);
      expect(advanced.deletes_after).toBe(clock.deletes_after);
    });

    // --- Advance with subscriptions ---

    it("advance processes a linked subscription: rolls period", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      // Advance past period end
      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime + THIRTY_DAYS);
      expect(sub.current_period_end).toBe(frozenTime + 2 * THIRTY_DAYS);
    });

    it("advance creates an invoice for billing cycle crossing", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime, unitAmount: 2000 });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data.length).toBeGreaterThanOrEqual(1);
    });

    it("advance creates invoice with correct amount", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime, unitAmount: 5000 });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      // The invoice should have amount_due matching the price
      const invoice = invoiceList.data[0];
      expect(invoice.amount_due).toBe(5000);
    });

    it("advance finalizes created invoices", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      // Invoice should be paid (finalized then paid)
      const invoice = invoiceList.data[0];
      expect(invoice.status).toBe("paid");
    });

    it("advance pays finalized invoices", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      const invoice = invoiceList.data[0];
      expect(invoice.paid).toBe(true);
      expect(invoice.amount_paid).toBe(invoice.amount_due);
    });

    it("advance handles trial end (trialing to active)", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        trialDays: 7,
      });

      // Advance past trial end (7 days)
      const trialEnd = frozenTime + 7 * 24 * 60 * 60;
      services.testClockService.advance(clock.id, trialEnd + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.status).toBe("active");
    });

    it("advance emits subscription.updated event on trial end", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const emittedTypes: string[] = [];

      services.eventService.onEvent((e) => emittedTypes.push(e.type));

      const { clock } = createLinkedSubscription(services, {
        frozenTime,
        trialDays: 7,
      });

      const trialEnd = frozenTime + 7 * 24 * 60 * 60;
      services.testClockService.advance(clock.id, trialEnd + 1);

      expect(emittedTypes).toContain("customer.subscription.updated");
    });

    it("advance with multiple linked subscriptions processes all", () => {
      const services = makeServices();
      const frozenTime = 1700000000;

      const { clock, subId: subId1 } = createLinkedSubscription(services, { frozenTime, unitAmount: 1000 });
      const { subId: subId2 } = createLinkedSubscription(services, {
        frozenTime,
        unitAmount: 2000,
        clockId: clock.id,
      });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      // Both subscriptions should have rolled periods
      const sub1Row = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId1)).get();
      const sub2Row = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId2)).get();

      const sub1 = JSON.parse(sub1Row!.data as string) as any;
      const sub2 = JSON.parse(sub2Row!.data as string) as any;

      expect(sub1.current_period_start).toBe(frozenTime + THIRTY_DAYS);
      expect(sub2.current_period_start).toBe(frozenTime + THIRTY_DAYS);
    });

    it("advance across multiple billing periods creates multiple invoices", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime, unitAmount: 2000 });

      // Advance across 3 billing periods
      services.testClockService.advance(clock.id, frozenTime + 3 * THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 100,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data.length).toBe(3);
    });

    it("advance across multiple periods rolls period correctly", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + 3 * THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime + 3 * THIRTY_DAYS);
      expect(sub.current_period_end).toBe(frozenTime + 4 * THIRTY_DAYS);
    });

    it("advance preserves subscription customer", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.customer).toBe("cus_test");
    });

    it("advance emits events for each billing cycle", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const emittedTypes: string[] = [];

      services.eventService.onEvent((e) => emittedTypes.push(e.type));

      const { clock } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + 2 * THIRTY_DAYS + 1);

      // Should have subscription.updated events for period rolls
      const subUpdates = emittedTypes.filter(t => t === "customer.subscription.updated");
      expect(subUpdates.length).toBeGreaterThanOrEqual(2);
    });

    it("advance does not process canceled subscriptions", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      // Manually cancel the subscription
      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;
      sub.status = "canceled";
      services.db.update(subscriptions)
        .set({ status: "canceled", data: JSON.stringify(sub) })
        .where(eq(subscriptions.id, subId))
        .run();

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 100,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data.length).toBe(0);
    });

    it("advance with subscription quantity multiplies invoice amount", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        unitAmount: 1000,
        quantity: 3,
      });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      const invoice = invoiceList.data[0];
      expect(invoice.amount_due).toBe(3000); // 1000 * 3
    });

    it("advance that does not cross period end does not create invoice", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      // Advance to just before period end
      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS - 1);

      const invoiceList = services.invoiceService.list({
        limit: 100,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data.length).toBe(0);
    });

    it("advance that does not cross period end does not roll period", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS - 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime);
      expect(sub.current_period_end).toBe(frozenTime + THIRTY_DAYS);
    });

    it("advance to exact period end triggers roll", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      // Advance to exactly the period end
      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime + THIRTY_DAYS);
    });

    it("advance without eventService or invoiceService skips billing", () => {
      const db = createDB(":memory:");
      const svc = new TestClockService(db);
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      // Should not throw even though no services are provided
      const advanced = svc.advance(clock.id, frozenTime + THIRTY_DAYS + 1);
      expect(advanced.frozen_time).toBe(frozenTime + THIRTY_DAYS + 1);
    });

    it("advance with only eventService (no invoiceService) skips billing", () => {
      const db = createDB(":memory:");
      const eventService = new EventService(db);
      const svc = new TestClockService(db, eventService);
      const frozenTime = 1700000000;
      const clock = svc.create({ frozen_time: frozenTime });

      const advanced = svc.advance(clock.id, frozenTime + THIRTY_DAYS + 1);
      expect(advanced.frozen_time).toBe(frozenTime + THIRTY_DAYS + 1);
    });

    it("advance with trialing subscription not past trial does not activate", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        trialDays: 14,
      });

      // Advance to day 7 (before trial ends at day 14)
      services.testClockService.advance(clock.id, frozenTime + 7 * 24 * 60 * 60);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.status).toBe("trialing");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // list() tests (~15)
  // ─────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("returns empty list when no clocks exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns all clocks when count is under limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit parameter", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });

      expect(result.data.length).toBe(3);
    });

    it("sets has_more to true when more clocks exist", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });

      expect(result.has_more).toBe(true);
    });

    it("sets has_more to false when all clocks fit", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 5, startingAfter: undefined, endingBefore: undefined });

      expect(result.has_more).toBe(false);
    });

    it("has_more is false when count equals limit exactly", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });

      expect(result.has_more).toBe(false);
    });

    it("returns url set to /v1/test_helpers/test_clocks", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.url).toBe("/v1/test_helpers/test_clocks");
    });

    it("returns object set to 'list'", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.object).toBe("list");
    });

    it("data items are proper test clock objects", () => {
      const svc = makeService();
      svc.create({ frozen_time: 1700000000, name: "Clock A" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      const clock = result.data[0];
      expect(clock.id).toMatch(/^clock_/);
      expect(clock.object).toBe("test_helpers.test_clock");
      expect(clock.status).toBe("ready");
      expect(clock.name).toBe("Clock A");
    });

    it("handles limit of 1", () => {
      const svc = makeService();
      svc.create({ frozen_time: 1700000000 });
      svc.create({ frozen_time: 1800000000 });

      const result = svc.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("each listed clock has a unique ID", () => {
      const svc = makeService();
      for (let i = 0; i < 8; i++) {
        svc.create({ frozen_time: 1700000000 + i });
      }
      const result = svc.list({ limit: 100, startingAfter: undefined, endingBefore: undefined });

      const ids = result.data.map(c => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(8);
    });

    it("list with startingAfter using non-existent ID throws", () => {
      const svc = makeService();
      svc.create({ frozen_time: 1700000000 });

      expect(() =>
        svc.list({ limit: 10, startingAfter: "clock_nonexistent", endingBefore: undefined })
      ).toThrow();
    });

    it("list with startingAfter throws StripeError with 404", () => {
      const svc = makeService();

      try {
        svc.list({ limit: 10, startingAfter: "clock_bad", endingBefore: undefined });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("empty list structure is correct", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result).toEqual({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/test_helpers/test_clocks",
      });
    });

    it("large limit with few clocks returns all", () => {
      const svc = makeService();
      svc.create({ frozen_time: 1700000000 });
      svc.create({ frozen_time: 1800000000 });

      const result = svc.list({ limit: 100, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration with subscriptions (~20)
  // ─────────────────────────────────────────────────────────────────────────
  describe("integration with subscriptions", () => {
    it("clock linked to subscription via test_clock_id", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      expect(subRow!.testClockId).toBe(clock.id);
    });

    it("subscription data contains test_clock reference", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.test_clock).toBe(clock.id);
    });

    it("multiple subscriptions on same clock are all processed", () => {
      const services = makeServices();
      const frozenTime = 1700000000;

      const { clock, subId: sub1 } = createLinkedSubscription(services, { frozenTime, unitAmount: 1000 });
      const { subId: sub2 } = createLinkedSubscription(services, {
        frozenTime,
        unitAmount: 3000,
        clockId: clock.id,
      });
      const { subId: sub3 } = createLinkedSubscription(services, {
        frozenTime,
        unitAmount: 5000,
        clockId: clock.id,
      });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      // All three should have invoices
      for (const subId of [sub1, sub2, sub3]) {
        const invoiceList = services.invoiceService.list({
          limit: 10,
          startingAfter: undefined,
          endingBefore: undefined,
          subscriptionId: subId,
        });
        expect(invoiceList.data.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("subscription periods roll correctly after one cycle", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime + THIRTY_DAYS);
      expect(sub.current_period_end).toBe(frozenTime + 2 * THIRTY_DAYS);
    });

    it("subscription periods roll correctly after two cycles", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + 2 * THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime + 2 * THIRTY_DAYS);
      expect(sub.current_period_end).toBe(frozenTime + 3 * THIRTY_DAYS);
    });

    it("invoice amounts match subscription price times quantity", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        unitAmount: 4999,
        quantity: 2,
      });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data[0].amount_due).toBe(9998); // 4999 * 2
    });

    it("trial period prevents billing during trial", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        trialDays: 14,
      });

      // Advance within trial period
      services.testClockService.advance(clock.id, frozenTime + 10 * 24 * 60 * 60);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.status).toBe("trialing");
    });

    it("trial end activates subscription and enables billing", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, {
        frozenTime,
        trialDays: 7,
      });

      const trialEnd = frozenTime + 7 * 24 * 60 * 60;
      // Advance past trial end AND past the period end
      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.status).toBe("active");

      // Should have created an invoice for the billing cycle
      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });
      expect(invoiceList.data.length).toBeGreaterThanOrEqual(1);
    });

    it("invoices are created for the correct customer", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data[0].customer).toBe("cus_test");
    });

    it("invoices have subscription ID set", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data[0].subscription).toBe(subId);
    });

    it("invoices have billing_reason set to subscription_cycle", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect((invoiceList.data[0] as any).billing_reason).toBe("subscription_cycle");
    });

    it("invoices have currency from subscription", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      expect(invoiceList.data[0].currency).toBe("usd");
    });

    it("advance emits subscription.updated with previous_attributes for period roll", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      let prevAttrs: any = null;

      services.eventService.onEvent((e) => {
        if (e.type === "customer.subscription.updated" && (e.data as any).previous_attributes?.current_period_start !== undefined) {
          prevAttrs = (e.data as any).previous_attributes;
        }
      });

      const { clock } = createLinkedSubscription(services, { frozenTime });
      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      expect(prevAttrs).not.toBeNull();
      expect(prevAttrs.current_period_start).toBe(frozenTime);
      expect(prevAttrs.current_period_end).toBe(frozenTime + THIRTY_DAYS);
    });

    it("subscription unlinked from clock is not processed on advance", () => {
      const services = makeServices();
      const frozenTime = 1700000000;

      // Create a clock
      const clock = services.testClockService.create({ frozen_time: frozenTime });

      // Create a subscription NOT linked to the clock
      const price = services.priceService.create({
        product: "prod_test",
        currency: "usd",
        unit_amount: 2000,
        recurring: { interval: "month" },
      });

      const subId = `sub_unlinked_${Math.random().toString(36).slice(2, 8)}`;
      services.db.insert(subscriptions).values({
        id: subId,
        customerId: "cus_test",
        status: "active",
        currentPeriodStart: frozenTime,
        currentPeriodEnd: frozenTime + THIRTY_DAYS,
        testClockId: null, // Not linked
        created: frozenTime,
        data: JSON.stringify({
          id: subId, object: "subscription", status: "active",
          current_period_start: frozenTime, current_period_end: frozenTime + THIRTY_DAYS,
          customer: "cus_test", currency: "usd", test_clock: null,
        }),
      }).run();

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      // Unlinked subscription should NOT have been rolled
      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime);
    });

    it("subscription linked to different clock is not processed", () => {
      const services = makeServices();
      const frozenTime = 1700000000;

      const clock1 = services.testClockService.create({ frozen_time: frozenTime });
      const { subId } = createLinkedSubscription(services, {
        frozenTime,
        clockId: clock1.id,
      });

      // Create a second clock and advance it
      const clock2 = services.testClockService.create({ frozen_time: frozenTime });
      services.testClockService.advance(clock2.id, frozenTime + THIRTY_DAYS + 1);

      // Subscription linked to clock1 should not be affected
      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.current_period_start).toBe(frozenTime);
    });

    it("advance preserves subscription status as active after billing", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + THIRTY_DAYS + 1);

      const subRow = services.db.select().from(subscriptions).where(eq(subscriptions.id, subId)).get();
      const sub = JSON.parse(subRow!.data as string) as any;

      expect(sub.status).toBe("active");
    });

    it("all invoices created during advance are paid", () => {
      const services = makeServices();
      const frozenTime = 1700000000;
      const { clock, subId } = createLinkedSubscription(services, { frozenTime });

      services.testClockService.advance(clock.id, frozenTime + 3 * THIRTY_DAYS + 1);

      const invoiceList = services.invoiceService.list({
        limit: 100,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: subId,
      });

      for (const invoice of invoiceList.data) {
        expect(invoice.status).toBe("paid");
        expect(invoice.paid).toBe(true);
      }
    });
  });
});
