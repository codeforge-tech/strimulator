import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { CustomerService } from "../../../src/services/customers";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new CustomerService(db);
}

describe("CustomerService", () => {
  describe("create", () => {
    it("returns a customer with the correct shape", () => {
      const svc = makeService();
      const customer = svc.create({ email: "test@example.com", name: "Alice" });

      expect(customer.id).toMatch(/^cus_/);
      expect(customer.object).toBe("customer");
      expect(customer.email).toBe("test@example.com");
      expect(customer.name).toBe("Alice");
      expect(customer.livemode).toBe(false);
      expect(customer.balance).toBe(0);
      expect(customer.delinquent).toBe(false);
      expect(customer.preferred_locales).toEqual([]);
      expect(customer.tax_exempt).toBe("none");
      expect(customer.test_clock).toBeNull();
      expect(customer.discount).toBeNull();
      expect(customer.shipping).toBeNull();
    });

    it("sets id with cus_ prefix", () => {
      const svc = makeService();
      const customer = svc.create({});
      expect(customer.id).toMatch(/^cus_/);
    });

    it("stores metadata", () => {
      const svc = makeService();
      const customer = svc.create({ metadata: { plan: "pro", tier: "gold" } });
      expect(customer.metadata).toEqual({ plan: "pro", tier: "gold" });
    });

    it("handles empty params", () => {
      const svc = makeService();
      const customer = svc.create({});
      expect(customer.email).toBeNull();
      expect(customer.name).toBeNull();
      expect(customer.metadata).toEqual({});
    });

    it("sets created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const customer = svc.create({});
      const after = Math.floor(Date.now() / 1000);
      expect(customer.created).toBeGreaterThanOrEqual(before);
      expect(customer.created).toBeLessThanOrEqual(after);
    });
  });

  describe("retrieve", () => {
    it("returns a customer by ID", () => {
      const svc = makeService();
      const created = svc.create({ email: "retrieve@example.com" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.email).toBe("retrieve@example.com");
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("cus_nonexistent")).toThrow();
      try {
        svc.retrieve("cus_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("throws 404 for deleted customer", () => {
      const svc = makeService();
      const created = svc.create({ email: "todel@example.com" });
      svc.del(created.id);
      expect(() => svc.retrieve(created.id)).toThrow();
    });
  });

  describe("update", () => {
    it("updates email and name", () => {
      const svc = makeService();
      const created = svc.create({ email: "old@example.com", name: "Old Name" });
      const updated = svc.update(created.id, { email: "new@example.com", name: "New Name" });
      expect(updated.email).toBe("new@example.com");
      expect(updated.name).toBe("New Name");
    });

    it("persists updates across retrieves", () => {
      const svc = makeService();
      const created = svc.create({ email: "before@example.com" });
      svc.update(created.id, { email: "after@example.com" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.email).toBe("after@example.com");
    });

    it("merges metadata", () => {
      const svc = makeService();
      const created = svc.create({ metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { b: "2" } });
      expect(updated.metadata).toEqual({ a: "1", b: "2" });
    });

    it("throws 404 for nonexistent customer", () => {
      const svc = makeService();
      expect(() => svc.update("cus_missing", { email: "x@y.com" })).toThrow();
    });
  });

  describe("del", () => {
    it("marks customer as deleted", () => {
      const svc = makeService();
      const created = svc.create({ email: "del@example.com" });
      const deleted = svc.del(created.id);
      expect(deleted.id).toBe(created.id);
      expect(deleted.object).toBe("customer");
      expect(deleted.deleted).toBe(true);
    });

    it("prevents retrieval after deletion", () => {
      const svc = makeService();
      const created = svc.create({});
      svc.del(created.id);
      expect(() => svc.retrieve(created.id)).toThrow();
    });

    it("throws 404 for nonexistent customer", () => {
      const svc = makeService();
      expect(() => svc.del("cus_ghost")).toThrow();
    });
  });

  describe("list", () => {
    it("returns empty list when no customers exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/customers");
    });

    it("returns all customers up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ email: `user${i}@example.com` });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ email: `user${i}@example.com` });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("paginates with starting_after", () => {
      const svc = makeService();
      const c1 = svc.create({ email: "a@example.com" });
      const c2 = svc.create({ email: "b@example.com" });
      const c3 = svc.create({ email: "c@example.com" });

      // Get first page
      const page1 = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      // Get next page using last item from page1 as cursor
      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      // Should have remaining items
      expect(page2.has_more).toBe(false);
    });

    it("excludes deleted customers", () => {
      const svc = makeService();
      const c1 = svc.create({ email: "keep@example.com" });
      const c2 = svc.create({ email: "delete@example.com" });
      svc.del(c2.id);
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(c1.id);
    });

    it("throws 404 if starting_after cursor does not exist", () => {
      const svc = makeService();
      expect(() =>
        svc.list({ limit: 10, startingAfter: "cus_ghost", endingBefore: undefined })
      ).toThrow();
    });
  });

  describe("metadata support", () => {
    it("round-trips metadata through create and retrieve", () => {
      const svc = makeService();
      const meta = { env: "test", version: "1.2.3" };
      const created = svc.create({ metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });
  });
});
