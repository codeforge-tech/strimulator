import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { PriceService } from "../../../src/services/prices";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new PriceService(db);
}

describe("PriceService", () => {
  describe("create", () => {
    it("creates a one_time price with the correct shape", () => {
      const svc = makeService();
      const price = svc.create({
        product: "prod_test123",
        currency: "usd",
        unit_amount: 1000,
      });

      expect(price.id).toMatch(/^price_/);
      expect(price.object).toBe("price");
      expect(price.active).toBe(true);
      expect(price.billing_scheme).toBe("per_unit");
      expect(price.currency).toBe("usd");
      expect(price.livemode).toBe(false);
      expect(price.lookup_key).toBeNull();
      expect(price.product).toBe("prod_test123");
      expect(price.recurring).toBeNull();
      expect(price.tiers_mode).toBeNull();
      expect(price.transform_quantity).toBeNull();
      expect(price.type).toBe("one_time");
      expect(price.unit_amount).toBe(1000);
      expect(price.unit_amount_decimal).toBe("1000");
      expect(price.custom_unit_amount).toBeNull();
      expect(price.nickname).toBeNull();
    });

    it("creates a recurring price with the correct shape", () => {
      const svc = makeService();
      const price = svc.create({
        product: "prod_test123",
        currency: "usd",
        unit_amount: 2000,
        recurring: { interval: "month", interval_count: 1 },
      });

      expect(price.type).toBe("recurring");
      expect(price.recurring).not.toBeNull();
      expect(price.recurring!.interval).toBe("month");
      expect(price.recurring!.interval_count).toBe(1);
      expect(price.recurring!.usage_type).toBe("licensed");
      expect(price.recurring!.aggregate_usage).toBeNull();
      expect(price.recurring!.trial_period_days).toBeNull();
    });

    it("creates a recurring price with weekly interval", () => {
      const svc = makeService();
      const price = svc.create({
        product: "prod_test123",
        currency: "eur",
        unit_amount: 500,
        recurring: { interval: "week", interval_count: 2 },
      });

      expect(price.type).toBe("recurring");
      expect(price.recurring!.interval).toBe("week");
      expect(price.recurring!.interval_count).toBe(2);
    });

    it("throws 400 if product is missing", () => {
      const svc = makeService();
      expect(() => svc.create({ currency: "usd", unit_amount: 1000 })).toThrow();
      try {
        svc.create({ currency: "usd", unit_amount: 1000 });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("product");
      }
    });

    it("throws 400 if currency is missing", () => {
      const svc = makeService();
      expect(() => svc.create({ product: "prod_test123", unit_amount: 1000 })).toThrow();
      try {
        svc.create({ product: "prod_test123", unit_amount: 1000 });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("currency");
      }
    });

    it("stores metadata", () => {
      const svc = makeService();
      const price = svc.create({
        product: "prod_test123",
        currency: "usd",
        unit_amount: 1000,
        metadata: { plan: "basic", tier: "1" },
      });
      expect(price.metadata).toEqual({ plan: "basic", tier: "1" });
    });

    it("sets created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const price = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 500 });
      const after = Math.floor(Date.now() / 1000);
      expect(price.created).toBeGreaterThanOrEqual(before);
      expect(price.created).toBeLessThanOrEqual(after);
    });

    it("handles null unit_amount", () => {
      const svc = makeService();
      const price = svc.create({ product: "prod_test123", currency: "usd" });
      expect(price.unit_amount).toBeNull();
      expect(price.unit_amount_decimal).toBeNull();
    });
  });

  describe("retrieve", () => {
    it("returns a price by ID", () => {
      const svc = makeService();
      const created = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 1000 });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.currency).toBe("usd");
      expect(retrieved.unit_amount).toBe(1000);
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("price_nonexistent")).toThrow();
      try {
        svc.retrieve("price_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });
  });

  describe("update", () => {
    it("updates active status", () => {
      const svc = makeService();
      const created = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 1000 });
      const updated = svc.update(created.id, { active: false });
      expect(updated.active).toBe(false);
    });

    it("updates nickname", () => {
      const svc = makeService();
      const created = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 1000 });
      const updated = svc.update(created.id, { nickname: "Monthly Plan" });
      expect(updated.nickname).toBe("Monthly Plan");
    });

    it("merges metadata", () => {
      const svc = makeService();
      const created = svc.create({
        product: "prod_test123",
        currency: "usd",
        unit_amount: 1000,
        metadata: { a: "1" },
      });
      const updated = svc.update(created.id, { metadata: { b: "2" } });
      expect(updated.metadata).toEqual({ a: "1", b: "2" });
    });

    it("persists updates across retrieves", () => {
      const svc = makeService();
      const created = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 1000 });
      svc.update(created.id, { active: false });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.active).toBe(false);
    });

    it("throws 404 for nonexistent price", () => {
      const svc = makeService();
      expect(() => svc.update("price_missing", { active: false })).toThrow();
    });
  });

  describe("list", () => {
    it("returns empty list when no prices exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/prices");
    });

    it("returns all prices up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ product: "prod_test123", currency: "usd", unit_amount: (i + 1) * 100 });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ product: "prod_test123", currency: "usd", unit_amount: (i + 1) * 100 });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by product", () => {
      const svc = makeService();
      svc.create({ product: "prod_aaa", currency: "usd", unit_amount: 1000 });
      svc.create({ product: "prod_bbb", currency: "usd", unit_amount: 2000 });
      svc.create({ product: "prod_aaa", currency: "eur", unit_amount: 1500 });

      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, product: "prod_aaa" });
      expect(result.data.length).toBe(2);
      expect(result.data.every(p => p.product === "prod_aaa")).toBe(true);
    });

    it("paginates with starting_after", () => {
      const svc = makeService();
      svc.create({ product: "prod_test123", currency: "usd", unit_amount: 100 });
      svc.create({ product: "prod_test123", currency: "usd", unit_amount: 200 });
      svc.create({ product: "prod_test123", currency: "usd", unit_amount: 300 });

      const page1 = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });

    it("throws 404 if starting_after cursor does not exist", () => {
      const svc = makeService();
      expect(() =>
        svc.list({ limit: 10, startingAfter: "price_ghost", endingBefore: undefined })
      ).toThrow();
    });
  });

  describe("metadata support", () => {
    it("round-trips metadata through create and retrieve", () => {
      const svc = makeService();
      const meta = { env: "test", version: "2.0" };
      const created = svc.create({ product: "prod_test123", currency: "usd", unit_amount: 999, metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });
  });
});
