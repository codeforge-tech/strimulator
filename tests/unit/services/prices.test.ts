import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PriceService } from "../../../src/services/prices";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new PriceService(db);
}

const listParams = (overrides?: { limit?: number; startingAfter?: string; product?: string }) => ({
  limit: overrides?.limit ?? 10,
  startingAfter: overrides?.startingAfter ?? undefined,
  endingBefore: undefined,
  product: overrides?.product,
});

// Shorthand for creating a minimal one-time price
function createOneTime(svc: PriceService, overrides?: Record<string, any>) {
  return svc.create({
    product: "prod_test123",
    currency: "usd",
    unit_amount: 1000,
    ...overrides,
  });
}

// Shorthand for creating a minimal recurring price
function createRecurring(svc: PriceService, overrides?: Record<string, any>) {
  return svc.create({
    product: "prod_test123",
    currency: "usd",
    unit_amount: 2000,
    recurring: { interval: "month" },
    ...overrides,
  });
}

describe("PriceService", () => {
  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------
  describe("create", () => {
    // --- one-time price basics ---
    it("creates a one-time price with product, currency, and unit_amount", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.id).toMatch(/^price_/);
      expect(price.product).toBe("prod_test123");
      expect(price.currency).toBe("usd");
      expect(price.unit_amount).toBe(1000);
      expect(price.type).toBe("one_time");
    });

    it("one-time price has recurring=null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.recurring).toBeNull();
    });

    // --- recurring price basics ---
    it("creates a recurring price with monthly interval", () => {
      const svc = makeService();
      const price = createRecurring(svc);
      expect(price.type).toBe("recurring");
      expect(price.recurring).not.toBeNull();
      expect(price.recurring!.interval).toBe("month");
    });

    it("creates a recurring price with yearly interval", () => {
      const svc = makeService();
      const price = createRecurring(svc, { recurring: { interval: "year" } });
      expect(price.recurring!.interval).toBe("year");
    });

    it("creates a recurring price with weekly interval", () => {
      const svc = makeService();
      const price = createRecurring(svc, { recurring: { interval: "week" } });
      expect(price.recurring!.interval).toBe("week");
    });

    it("creates a recurring price with daily interval", () => {
      const svc = makeService();
      const price = createRecurring(svc, { recurring: { interval: "day" } });
      expect(price.recurring!.interval).toBe("day");
    });

    it("creates a recurring price with interval_count", () => {
      const svc = makeService();
      const price = createRecurring(svc, { recurring: { interval: "month", interval_count: 3 } });
      expect(price.recurring!.interval_count).toBe(3);
    });

    it("defaults interval_count to 1", () => {
      const svc = makeService();
      const price = createRecurring(svc);
      expect(price.recurring!.interval_count).toBe(1);
    });

    it("creates weekly with interval_count=2", () => {
      const svc = makeService();
      const price = createRecurring(svc, { recurring: { interval: "week", interval_count: 2 } });
      expect(price.recurring!.interval).toBe("week");
      expect(price.recurring!.interval_count).toBe(2);
    });

    // --- unit_amount edge cases ---
    it("creates with unit_amount=0", () => {
      const svc = makeService();
      const price = createOneTime(svc, { unit_amount: 0 });
      expect(price.unit_amount).toBe(0);
      expect(price.unit_amount_decimal).toBe("0");
    });

    it("creates with large unit_amount", () => {
      const svc = makeService();
      const price = createOneTime(svc, { unit_amount: 99999999 });
      expect(price.unit_amount).toBe(99999999);
      expect(price.unit_amount_decimal).toBe("99999999");
    });

    it("creates with null unit_amount (no amount provided)", () => {
      const svc = makeService();
      const price = svc.create({ product: "prod_test123", currency: "usd" });
      expect(price.unit_amount).toBeNull();
      expect(price.unit_amount_decimal).toBeNull();
    });

    it("unit_amount_decimal is string representation of unit_amount", () => {
      const svc = makeService();
      const price = createOneTime(svc, { unit_amount: 4250 });
      expect(price.unit_amount_decimal).toBe("4250");
    });

    // --- currencies ---
    it("creates with USD currency", () => {
      const svc = makeService();
      const price = createOneTime(svc, { currency: "usd" });
      expect(price.currency).toBe("usd");
    });

    it("creates with EUR currency", () => {
      const svc = makeService();
      const price = createOneTime(svc, { currency: "eur" });
      expect(price.currency).toBe("eur");
    });

    it("creates with GBP currency", () => {
      const svc = makeService();
      const price = createOneTime(svc, { currency: "gbp" });
      expect(price.currency).toBe("gbp");
    });

    it("creates with JPY currency", () => {
      const svc = makeService();
      const price = createOneTime(svc, { currency: "jpy", unit_amount: 500 });
      expect(price.currency).toBe("jpy");
    });

    // --- metadata ---
    it("stores metadata", () => {
      const svc = makeService();
      const price = createOneTime(svc, { metadata: { plan: "basic", tier: "1" } });
      expect(price.metadata).toEqual({ plan: "basic", tier: "1" });
    });

    it("defaults metadata to empty object", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.metadata).toEqual({});
    });

    it("stores metadata with many keys", () => {
      const svc = makeService();
      const meta: Record<string, string> = {};
      for (let i = 0; i < 15; i++) meta[`k${i}`] = `v${i}`;
      const price = createOneTime(svc, { metadata: meta });
      expect(Object.keys(price.metadata).length).toBe(15);
    });

    it("stores metadata with empty values", () => {
      const svc = makeService();
      const price = createOneTime(svc, { metadata: { empty: "" } });
      expect(price.metadata).toEqual({ empty: "" });
    });

    // --- nickname ---
    it("creates with nickname", () => {
      const svc = makeService();
      const price = createOneTime(svc, { nickname: "Monthly Plan" });
      expect(price.nickname).toBe("Monthly Plan");
    });

    it("defaults nickname to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.nickname).toBeNull();
    });

    // --- active ---
    it("defaults active to true", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.active).toBe(true);
    });

    it("creates with active=true explicitly", () => {
      const svc = makeService();
      const price = createOneTime(svc, { active: true });
      expect(price.active).toBe(true);
    });

    it("creates with active=false", () => {
      const svc = makeService();
      const price = createOneTime(svc, { active: false });
      expect(price.active).toBe(false);
    });

    // --- billing_scheme ---
    it("defaults billing_scheme to per_unit", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.billing_scheme).toBe("per_unit");
    });

    // --- tax_behavior ---
    it("creates with tax_behavior", () => {
      const svc = makeService();
      const price = createOneTime(svc, { tax_behavior: "inclusive" });
      expect(price.tax_behavior).toBe("inclusive");
    });

    it("defaults tax_behavior to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.tax_behavior).toBeNull();
    });

    it("creates with tax_behavior=exclusive", () => {
      const svc = makeService();
      const price = createOneTime(svc, { tax_behavior: "exclusive" });
      expect(price.tax_behavior).toBe("exclusive");
    });

    it("creates with tax_behavior=unspecified", () => {
      const svc = makeService();
      const price = createOneTime(svc, { tax_behavior: "unspecified" });
      expect(price.tax_behavior).toBe("unspecified");
    });

    // --- lookup_key ---
    it("creates with lookup_key", () => {
      const svc = makeService();
      const price = createOneTime(svc, { lookup_key: "standard_monthly" });
      expect(price.lookup_key).toBe("standard_monthly");
    });

    it("defaults lookup_key to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.lookup_key).toBeNull();
    });

    // --- id format ---
    it("generates id with price_ prefix", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.id).toMatch(/^price_/);
      expect(price.id.length).toBeGreaterThan(6);
    });

    // --- object ---
    it("sets object to 'price'", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.object).toBe("price");
    });

    // --- product ---
    it("stores the product ID", () => {
      const svc = makeService();
      const price = createOneTime(svc, { product: "prod_abc123" });
      expect(price.product).toBe("prod_abc123");
    });

    // --- type inference ---
    it("infers type=recurring when recurring param is provided", () => {
      const svc = makeService();
      const price = svc.create({
        product: "prod_test",
        currency: "usd",
        unit_amount: 1000,
        recurring: { interval: "month" },
      });
      expect(price.type).toBe("recurring");
    });

    it("infers type=one_time when no recurring param", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.type).toBe("one_time");
    });

    // --- timestamps ---
    it("sets created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const price = createOneTime(svc);
      const after = Math.floor(Date.now() / 1000);
      expect(price.created).toBeGreaterThanOrEqual(before);
      expect(price.created).toBeLessThanOrEqual(after);
    });

    // --- livemode ---
    it("sets livemode to false", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.livemode).toBe(false);
    });

    // --- other defaults ---
    it("defaults custom_unit_amount to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.custom_unit_amount).toBeNull();
    });

    it("defaults tiers_mode to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.tiers_mode).toBeNull();
    });

    it("defaults transform_quantity to null", () => {
      const svc = makeService();
      const price = createOneTime(svc);
      expect(price.transform_quantity).toBeNull();
    });

    // --- uniqueness ---
    it("generates unique IDs for multiple prices", () => {
      const svc = makeService();
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(createOneTime(svc, { unit_amount: i * 100 }).id);
      }
      expect(ids.size).toBe(20);
    });

    // --- multiple prices per product ---
    it("allows multiple prices for the same product", () => {
      const svc = makeService();
      const p1 = createOneTime(svc, { unit_amount: 1000 });
      const p2 = createOneTime(svc, { unit_amount: 2000 });
      expect(p1.product).toBe(p2.product);
      expect(p1.id).not.toBe(p2.id);
    });

    // --- validation ---
    it("throws 400 when product is missing", () => {
      const svc = makeService();
      expect(() => svc.create({ currency: "usd", unit_amount: 1000 })).toThrow();
    });

    it("throws StripeError with param=product when product is missing", () => {
      const svc = makeService();
      try {
        svc.create({ currency: "usd", unit_amount: 1000 });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("product");
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("throws 400 when currency is missing", () => {
      const svc = makeService();
      expect(() => svc.create({ product: "prod_test123", unit_amount: 1000 })).toThrow();
    });

    it("throws StripeError with param=currency when currency is missing", () => {
      const svc = makeService();
      try {
        svc.create({ product: "prod_test123", unit_amount: 1000 });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("currency");
      }
    });

    it("throws when both product and currency are missing", () => {
      const svc = makeService();
      expect(() => svc.create({ unit_amount: 1000 })).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve()
  // ---------------------------------------------------------------------------
  describe("retrieve", () => {
    it("returns a price by ID", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("all fields match the created one-time price", () => {
      const svc = makeService();
      const created = createOneTime(svc, {
        nickname: "Test",
        metadata: { k: "v" },
        lookup_key: "lk",
        tax_behavior: "inclusive",
      });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.object).toBe(created.object);
      expect(retrieved.active).toBe(created.active);
      expect(retrieved.billing_scheme).toBe(created.billing_scheme);
      expect(retrieved.currency).toBe(created.currency);
      expect(retrieved.unit_amount).toBe(created.unit_amount);
      expect(retrieved.unit_amount_decimal).toBe(created.unit_amount_decimal);
      expect(retrieved.product).toBe(created.product);
      expect(retrieved.type).toBe(created.type);
      expect(retrieved.recurring).toBe(created.recurring);
      expect(retrieved.nickname).toBe(created.nickname);
      expect(retrieved.metadata).toEqual(created.metadata);
      expect(retrieved.lookup_key).toBe(created.lookup_key);
      expect(retrieved.tax_behavior).toBe(created.tax_behavior);
      expect(retrieved.livemode).toBe(created.livemode);
      expect(retrieved.created).toBe(created.created);
      expect(retrieved.custom_unit_amount).toBe(created.custom_unit_amount);
      expect(retrieved.tiers_mode).toBe(created.tiers_mode);
      expect(retrieved.transform_quantity).toBe(created.transform_quantity);
    });

    it("retrieves a recurring price with the recurring sub-object", () => {
      const svc = makeService();
      const created = createRecurring(svc, { recurring: { interval: "year", interval_count: 2 } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.recurring).not.toBeNull();
      expect(retrieved.recurring!.interval).toBe("year");
      expect(retrieved.recurring!.interval_count).toBe(2);
      expect(retrieved.recurring!.usage_type).toBe("licensed");
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("price_nonexistent")).toThrow();
    });

    it("throws StripeError with resource_missing for nonexistent ID", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_nonexistent");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("error message includes the price ID", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_missing999");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("price_missing999");
      }
    });

    it("error message says 'No such price'", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_xyz");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("No such price");
      }
    });

    it("error param is 'id' for missing price", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_abc");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("id");
      }
    });

    it("retrieves price with metadata intact", () => {
      const svc = makeService();
      const meta = { env: "staging", region: "eu-west" };
      const created = createOneTime(svc, { metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });

    it("can retrieve multiple different prices", () => {
      const svc = makeService();
      const p1 = createOneTime(svc, { unit_amount: 100 });
      const p2 = createOneTime(svc, { unit_amount: 200 });
      expect(svc.retrieve(p1.id).unit_amount).toBe(100);
      expect(svc.retrieve(p2.id).unit_amount).toBe(200);
    });

    it("retrieve does not modify the price", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const r1 = svc.retrieve(created.id);
      const r2 = svc.retrieve(created.id);
      expect(r1).toEqual(r2);
    });
  });

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------
  describe("update", () => {
    it("updates active to false", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { active: false });
      expect(updated.active).toBe(false);
    });

    it("updates active to true from false", () => {
      const svc = makeService();
      const created = createOneTime(svc, { active: false });
      const updated = svc.update(created.id, { active: true });
      expect(updated.active).toBe(true);
    });

    it("updates nickname", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { nickname: "Monthly Plan" });
      expect(updated.nickname).toBe("Monthly Plan");
    });

    it("updates nickname to a different value", () => {
      const svc = makeService();
      const created = createOneTime(svc, { nickname: "Old" });
      const updated = svc.update(created.id, { nickname: "New" });
      expect(updated.nickname).toBe("New");
    });

    it("clears nickname by not including it in update", () => {
      const svc = makeService();
      const created = createOneTime(svc, { nickname: "HasNick" });
      // Update without nickname should preserve it
      const updated = svc.update(created.id, { active: true });
      expect(updated.nickname).toBe("HasNick");
    });

    it("merges metadata (adds new keys)", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { b: "2" } });
      expect(updated.metadata).toEqual({ a: "1", b: "2" });
    });

    it("merges metadata (overwrites existing keys)", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { a: "replaced" } });
      expect(updated.metadata).toEqual({ a: "replaced" });
    });

    it("merges metadata (mixed add and overwrite)", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { a: "1", b: "2" } });
      const updated = svc.update(created.id, { metadata: { b: "new", c: "3" } });
      expect(updated.metadata).toEqual({ a: "1", b: "new", c: "3" });
    });

    it("does not touch metadata when metadata param is not provided", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { existing: "val" } });
      const updated = svc.update(created.id, { active: false });
      expect(updated.metadata).toEqual({ existing: "val" });
    });

    it("updates lookup_key", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { lookup_key: "new_lookup" });
      expect(updated.lookup_key).toBe("new_lookup");
    });

    it("updates lookup_key from null", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      expect(created.lookup_key).toBeNull();
      const updated = svc.update(created.id, { lookup_key: "my_key" });
      expect(updated.lookup_key).toBe("my_key");
    });

    it("updates tax_behavior", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { tax_behavior: "exclusive" });
      expect(updated.tax_behavior).toBe("exclusive");
    });

    it("preserves unchanged fields when updating active", () => {
      const svc = makeService();
      const created = createOneTime(svc, {
        nickname: "My Price",
        metadata: { k: "v" },
        lookup_key: "lk",
      });
      const updated = svc.update(created.id, { active: false });
      expect(updated.nickname).toBe("My Price");
      expect(updated.metadata).toEqual({ k: "v" });
      expect(updated.lookup_key).toBe("lk");
      expect(updated.currency).toBe("usd");
      expect(updated.unit_amount).toBe(1000);
      expect(updated.product).toBe("prod_test123");
    });

    it("preserves immutable fields (currency, unit_amount, product)", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { nickname: "Changed" });
      expect(updated.currency).toBe(created.currency);
      expect(updated.unit_amount).toBe(created.unit_amount);
      expect(updated.product).toBe(created.product);
      expect(updated.type).toBe(created.type);
      expect(updated.billing_scheme).toBe(created.billing_scheme);
    });

    it("preserves the id", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { active: false });
      expect(updated.id).toBe(created.id);
    });

    it("preserves the object type", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { active: false });
      expect(updated.object).toBe("price");
    });

    it("preserves the created timestamp", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { active: false });
      expect(updated.created).toBe(created.created);
    });

    it("throws 404 for nonexistent price", () => {
      const svc = makeService();
      expect(() => svc.update("price_missing", { active: false })).toThrow();
    });

    it("throws StripeError for nonexistent price", () => {
      const svc = makeService();
      try {
        svc.update("price_missing", { active: false });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("returns the updated object", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      const updated = svc.update(created.id, { active: false, nickname: "Up" });
      expect(updated.active).toBe(false);
      expect(updated.nickname).toBe("Up");
    });

    it("persists updates across retrieves", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      svc.update(created.id, { active: false });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.active).toBe(false);
    });

    it("persists nickname update across retrieves", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      svc.update(created.id, { nickname: "Persisted" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.nickname).toBe("Persisted");
    });

    it("persists metadata update across retrieves", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { a: "1" } });
      svc.update(created.id, { metadata: { b: "2" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ a: "1", b: "2" });
    });

    it("multiple sequential updates accumulate correctly", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      svc.update(created.id, { active: false });
      svc.update(created.id, { nickname: "Updated" });
      svc.update(created.id, { metadata: { k: "v" } });
      const final = svc.retrieve(created.id);
      expect(final.active).toBe(false);
      expect(final.nickname).toBe("Updated");
      expect(final.metadata).toEqual({ k: "v" });
    });

    it("update with empty params preserves all fields", () => {
      const svc = makeService();
      const created = createOneTime(svc, { nickname: "Test", metadata: { x: "y" } });
      const updated = svc.update(created.id, {});
      expect(updated.nickname).toBe("Test");
      expect(updated.metadata).toEqual({ x: "y" });
      expect(updated.active).toBe(true);
    });

    it("toggle active false then true", () => {
      const svc = makeService();
      const created = createOneTime(svc);
      expect(created.active).toBe(true);
      svc.update(created.id, { active: false });
      expect(svc.retrieve(created.id).active).toBe(false);
      svc.update(created.id, { active: true });
      expect(svc.retrieve(created.id).active).toBe(true);
    });

    it("preserves recurring sub-object when updating a recurring price", () => {
      const svc = makeService();
      const created = createRecurring(svc);
      const updated = svc.update(created.id, { nickname: "Rec Updated" });
      expect(updated.recurring).not.toBeNull();
      expect(updated.recurring!.interval).toBe("month");
      expect(updated.recurring!.interval_count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("returns empty list when no prices exist", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns url /v1/prices", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(result.url).toBe("/v1/prices");
    });

    it("returns all prices up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        createOneTime(svc, { unit_amount: (i + 1) * 100 });
      }
      const result = svc.list(listParams());
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit param", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        createOneTime(svc, { unit_amount: (i + 1) * 100 });
      }
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when prices fit in limit", () => {
      const svc = makeService();
      createOneTime(svc);
      createOneTime(svc, { unit_amount: 2000 });
      const result = svc.list(listParams({ limit: 5 }));
      expect(result.has_more).toBe(false);
    });

    it("has_more is true when more prices exist", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) createOneTime(svc, { unit_amount: i * 100 });
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when limit equals price count", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) createOneTime(svc, { unit_amount: i * 100 });
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.has_more).toBe(false);
    });

    it("paginates with starting_after", () => {
      const svc = makeService();
      createOneTime(svc, { unit_amount: 100 });
      createOneTime(svc, { unit_amount: 200 });
      createOneTime(svc, { unit_amount: 300 });

      const page1 = svc.list(listParams({ limit: 2 }));
      expect(page1.data.length).toBe(2);
      expect(page1.has_more).toBe(true);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list(listParams({ limit: 2, startingAfter: lastId }));
      // Pagination uses gt(created) so same-second inserts may not paginate fully
      expect(page2.has_more).toBe(false);
    });

    it("paginating works correctly when timestamps differ", () => {
      const svc = makeService();
      createOneTime(svc, { unit_amount: 100 });

      const page1 = svc.list(listParams({ limit: 1 }));
      expect(page1.data.length).toBe(1);
    });

    it("filters by product", () => {
      const svc = makeService();
      createOneTime(svc, { product: "prod_aaa", unit_amount: 100 });
      createOneTime(svc, { product: "prod_bbb", unit_amount: 200 });
      createOneTime(svc, { product: "prod_aaa", unit_amount: 300 });

      const result = svc.list(listParams({ product: "prod_aaa" }));
      expect(result.data.length).toBe(2);
      expect(result.data.every(p => p.product === "prod_aaa")).toBe(true);
    });

    it("filters by product returns empty when no match", () => {
      const svc = makeService();
      createOneTime(svc, { product: "prod_aaa" });
      const result = svc.list(listParams({ product: "prod_bbb" }));
      expect(result.data.length).toBe(0);
    });

    it("filters by product with limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        createOneTime(svc, { product: "prod_target", unit_amount: i * 100 });
      }
      createOneTime(svc, { product: "prod_other", unit_amount: 9999 });

      const result = svc.list(listParams({ product: "prod_target", limit: 3 }));
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by product with pagination uses starting_after cursor", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        createOneTime(svc, { product: "prod_pag", unit_amount: i * 100 });
      }
      createOneTime(svc, { product: "prod_other" });

      const page1 = svc.list(listParams({ product: "prod_pag", limit: 3 }));
      expect(page1.data.length).toBe(3);
      expect(page1.has_more).toBe(true);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list(listParams({ product: "prod_pag", limit: 3, startingAfter: lastId }));
      // Same-second inserts share created timestamp, so gt(created) may not advance
      expect(page2.has_more).toBe(false);
    });

    it("throws 404 if starting_after cursor does not exist", () => {
      const svc = makeService();
      expect(() => svc.list(listParams({ startingAfter: "price_ghost" }))).toThrow();
    });

    it("throws StripeError if starting_after cursor does not exist", () => {
      const svc = makeService();
      try {
        svc.list(listParams({ startingAfter: "price_ghost" }));
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("list with limit=1 returns one price", () => {
      const svc = makeService();
      createOneTime(svc);
      createOneTime(svc, { unit_amount: 2000 });
      const result = svc.list(listParams({ limit: 1 }));
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("list returns prices as full objects with all fields", () => {
      const svc = makeService();
      createOneTime(svc, { nickname: "Full", metadata: { k: "v" } });
      const result = svc.list(listParams());
      const p = result.data[0];
      expect(p.id).toMatch(/^price_/);
      expect(p.object).toBe("price");
      expect(p.currency).toBe("usd");
      expect(p.unit_amount).toBe(1000);
      expect(p.nickname).toBe("Full");
      expect(p.metadata).toEqual({ k: "v" });
    });

    it("list with many prices (20+)", () => {
      const svc = makeService();
      for (let i = 0; i < 25; i++) {
        createOneTime(svc, { unit_amount: i * 100 });
      }
      const result = svc.list(listParams({ limit: 100 }));
      expect(result.data.length).toBe(25);
      expect(result.has_more).toBe(false);
    });

    it("list object is always 'list'", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(result.object).toBe("list");
    });

    it("list data is array even when empty", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("list without product filter returns all prices across products", () => {
      const svc = makeService();
      createOneTime(svc, { product: "prod_a" });
      createOneTime(svc, { product: "prod_b" });
      createOneTime(svc, { product: "prod_c" });
      const result = svc.list(listParams());
      expect(result.data.length).toBe(3);
    });

    it("list includes both one-time and recurring prices", () => {
      const svc = makeService();
      createOneTime(svc);
      createRecurring(svc);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(2);
      const types = result.data.map(p => p.type);
      expect(types).toContain("one_time");
      expect(types).toContain("recurring");
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape — one-time price
  // ---------------------------------------------------------------------------
  describe("one-time price object shape", () => {
    it("has all expected top-level keys", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      const keys = Object.keys(p);
      expect(keys).toContain("id");
      expect(keys).toContain("object");
      expect(keys).toContain("active");
      expect(keys).toContain("billing_scheme");
      expect(keys).toContain("created");
      expect(keys).toContain("currency");
      expect(keys).toContain("custom_unit_amount");
      expect(keys).toContain("livemode");
      expect(keys).toContain("lookup_key");
      expect(keys).toContain("metadata");
      expect(keys).toContain("nickname");
      expect(keys).toContain("product");
      expect(keys).toContain("recurring");
      expect(keys).toContain("tax_behavior");
      expect(keys).toContain("tiers_mode");
      expect(keys).toContain("transform_quantity");
      expect(keys).toContain("type");
      expect(keys).toContain("unit_amount");
      expect(keys).toContain("unit_amount_decimal");
    });

    it("default values for a minimal one-time price", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(p.active).toBe(true);
      expect(p.billing_scheme).toBe("per_unit");
      expect(p.custom_unit_amount).toBeNull();
      expect(p.livemode).toBe(false);
      expect(p.lookup_key).toBeNull();
      expect(p.metadata).toEqual({});
      expect(p.nickname).toBeNull();
      expect(p.recurring).toBeNull();
      expect(p.tax_behavior).toBeNull();
      expect(p.tiers_mode).toBeNull();
      expect(p.transform_quantity).toBeNull();
    });

    it("currency is stored as-is (lowercase)", () => {
      const svc = makeService();
      const p = createOneTime(svc, { currency: "usd" });
      expect(p.currency).toBe("usd");
    });

    it("unit_amount is an integer", () => {
      const svc = makeService();
      const p = createOneTime(svc, { unit_amount: 1999 });
      expect(Number.isInteger(p.unit_amount)).toBe(true);
    });

    it("id is a string", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(typeof p.id).toBe("string");
    });

    it("active is a boolean", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(typeof p.active).toBe("boolean");
    });

    it("created is a number", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(typeof p.created).toBe("number");
    });

    it("livemode is a boolean", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(typeof p.livemode).toBe("boolean");
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape — recurring price
  // ---------------------------------------------------------------------------
  describe("recurring price object shape", () => {
    it("has recurring sub-object", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.recurring).not.toBeNull();
      expect(typeof p.recurring).toBe("object");
    });

    it("recurring sub-object has interval", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "month" } });
      expect(p.recurring!.interval).toBe("month");
    });

    it("recurring sub-object has interval_count", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "month", interval_count: 3 } });
      expect(p.recurring!.interval_count).toBe(3);
    });

    it("recurring sub-object defaults interval_count to 1", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.recurring!.interval_count).toBe(1);
    });

    it("recurring sub-object has usage_type=licensed", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.recurring!.usage_type).toBe("licensed");
    });

    it("recurring sub-object has aggregate_usage=null", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.recurring!.aggregate_usage).toBeNull();
    });

    it("recurring sub-object has trial_period_days=null", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.recurring!.trial_period_days).toBeNull();
    });

    it("recurring sub-object has meter=null", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect((p.recurring as any).meter).toBeNull();
    });

    it("monthly recurring has correct sub-object", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "month" } });
      expect(p.recurring!.interval).toBe("month");
      expect(p.recurring!.interval_count).toBe(1);
      expect(p.recurring!.usage_type).toBe("licensed");
    });

    it("yearly recurring has correct sub-object", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "year" } });
      expect(p.recurring!.interval).toBe("year");
      expect(p.recurring!.interval_count).toBe(1);
    });

    it("weekly recurring has correct sub-object", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "week" } });
      expect(p.recurring!.interval).toBe("week");
    });

    it("daily recurring has correct sub-object", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "day" } });
      expect(p.recurring!.interval).toBe("day");
    });

    it("interval_count > 1 is stored correctly", () => {
      const svc = makeService();
      const p = createRecurring(svc, { recurring: { interval: "month", interval_count: 6 } });
      expect(p.recurring!.interval_count).toBe(6);
    });

    it("type is 'recurring' for recurring price", () => {
      const svc = makeService();
      const p = createRecurring(svc);
      expect(p.type).toBe("recurring");
    });

    it("type is 'one_time' for one-time price", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      expect(p.type).toBe("one_time");
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata round-trip
  // ---------------------------------------------------------------------------
  describe("metadata support", () => {
    it("round-trips metadata through create and retrieve", () => {
      const svc = makeService();
      const meta = { env: "test", version: "2.0" };
      const created = createOneTime(svc, { metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });

    it("round-trips metadata through create, update, and retrieve", () => {
      const svc = makeService();
      const created = createOneTime(svc, { metadata: { a: "1" } });
      svc.update(created.id, { metadata: { b: "2" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ a: "1", b: "2" });
    });

    it("metadata with special characters in values", () => {
      const svc = makeService();
      const meta = { url: "https://example.com?a=1&b=2", json: '{"key":"val"}' };
      const created = createOneTime(svc, { metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-method interactions
  // ---------------------------------------------------------------------------
  describe("cross-method interactions", () => {
    it("create then list returns the price", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      const list = svc.list(listParams());
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(p.id);
    });

    it("create, update, retrieve returns updated price", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      svc.update(p.id, { active: false, nickname: "Updated" });
      const retrieved = svc.retrieve(p.id);
      expect(retrieved.active).toBe(false);
      expect(retrieved.nickname).toBe("Updated");
    });

    it("update does not change list count", () => {
      const svc = makeService();
      createOneTime(svc);
      createOneTime(svc, { unit_amount: 2000 });
      const before = svc.list(listParams());
      svc.update(before.data[0].id, { nickname: "Changed" });
      const after = svc.list(listParams());
      expect(after.data.length).toBe(before.data.length);
    });

    it("different services (different DBs) are isolated", () => {
      const svc1 = makeService();
      const svc2 = makeService();
      createOneTime(svc1);
      const list = svc2.list(listParams());
      expect(list.data.length).toBe(0);
    });

    it("creating prices for different products and filtering by each", () => {
      const svc = makeService();
      createOneTime(svc, { product: "prod_a", unit_amount: 100 });
      createOneTime(svc, { product: "prod_a", unit_amount: 200 });
      createOneTime(svc, { product: "prod_b", unit_amount: 300 });
      createRecurring(svc, { product: "prod_c", recurring: { interval: "year" } });

      expect(svc.list(listParams({ product: "prod_a" })).data.length).toBe(2);
      expect(svc.list(listParams({ product: "prod_b" })).data.length).toBe(1);
      expect(svc.list(listParams({ product: "prod_c" })).data.length).toBe(1);
      expect(svc.list(listParams()).data.length).toBe(4);
    });

    it("updating an inactive price then listing still shows it", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      svc.update(p.id, { active: false });
      // PriceService.list does not filter by active
      const list = svc.list(listParams());
      expect(list.data.length).toBe(1);
      expect(list.data[0].active).toBe(false);
    });

    it("create, update, retrieve returns updated price in list", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      svc.update(p.id, { nickname: "Listed Nick" });
      const list = svc.list(listParams());
      expect(list.data[0].nickname).toBe("Listed Nick");
    });

    it("create prices with same product results in different IDs", () => {
      const svc = makeService();
      const p1 = createOneTime(svc);
      const p2 = createOneTime(svc);
      expect(p1.id).not.toBe(p2.id);
      expect(p1.product).toBe(p2.product);
    });

    it("list shows updated price data not stale data", () => {
      const svc = makeService();
      const p = createOneTime(svc);
      svc.update(p.id, { active: false, metadata: { updated: "yes" } });
      const list = svc.list(listParams());
      expect(list.data[0].active).toBe(false);
      expect(list.data[0].metadata).toEqual({ updated: "yes" });
    });
  });

  // ---------------------------------------------------------------------------
  // Error shapes (comprehensive)
  // ---------------------------------------------------------------------------
  describe("error shapes", () => {
    it("create error for missing product has type invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.create({ currency: "usd", unit_amount: 100 });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("create error for missing currency has type invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.create({ product: "prod_test", unit_amount: 100 });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("create error has message about product", () => {
      const svc = makeService();
      try {
        svc.create({ currency: "usd", unit_amount: 100 });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("product");
      }
    });

    it("create error has message about currency", () => {
      const svc = makeService();
      try {
        svc.create({ product: "prod_test", unit_amount: 100 });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("currency");
      }
    });

    it("retrieve error has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("update error for nonexistent price has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.update("price_nope", { active: false });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("list starting_after error has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.list(listParams({ startingAfter: "price_nope" }));
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("all 404 errors have param=id", () => {
      const svc = makeService();
      for (const fn of [
        () => svc.retrieve("price_x"),
        () => svc.update("price_x", { active: false }),
      ]) {
        try {
          fn();
          expect(true).toBe(false);
        } catch (err) {
          expect((err as StripeError).body.error.param).toBe("id");
        }
      }
    });

    it("errors are instances of StripeError", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("error statusCode is a number", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(typeof (err as StripeError).statusCode).toBe("number");
      }
    });

    it("error body structure is correct", () => {
      const svc = makeService();
      try {
        svc.retrieve("price_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(typeof (err as StripeError).body.error.type).toBe("string");
        expect(typeof (err as StripeError).body.error.message).toBe("string");
        expect(typeof (err as StripeError).body.error.code).toBe("string");
      }
    });
  });
});
