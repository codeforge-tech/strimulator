import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { ProductService } from "../../../src/services/products";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new ProductService(db);
}

describe("ProductService", () => {
  describe("create", () => {
    it("returns a product with the correct shape", () => {
      const svc = makeService();
      const product = svc.create({ name: "Test Product" });

      expect(product.id).toMatch(/^prod_/);
      expect(product.object).toBe("product");
      expect(product.name).toBe("Test Product");
      expect(product.active).toBe(true);
      expect(product.livemode).toBe(false);
      expect(product.images).toEqual([]);
      expect(product.default_price).toBeNull();
      expect(product.description).toBeNull();
      expect(product.package_dimensions).toBeNull();
      expect(product.shippable).toBeNull();
      expect(product.statement_descriptor).toBeNull();
      expect(product.tax_code).toBeNull();
      expect(product.unit_label).toBeNull();
      expect((product as any).url).toBeNull();
      expect((product as any).type).toBe("service");
    });

    it("sets id with prod_ prefix", () => {
      const svc = makeService();
      const product = svc.create({ name: "My Product" });
      expect(product.id).toMatch(/^prod_/);
    });

    it("stores metadata", () => {
      const svc = makeService();
      const product = svc.create({ name: "Meta Product", metadata: { category: "books", region: "us" } });
      expect(product.metadata).toEqual({ category: "books", region: "us" });
    });

    it("defaults active to true", () => {
      const svc = makeService();
      const product = svc.create({ name: "Active Product" });
      expect(product.active).toBe(true);
    });

    it("can create an inactive product", () => {
      const svc = makeService();
      const product = svc.create({ name: "Inactive Product", active: false });
      expect(product.active).toBe(false);
    });

    it("throws 400 if name is missing", () => {
      const svc = makeService();
      expect(() => svc.create({})).toThrow();
      try {
        svc.create({});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("sets created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const product = svc.create({ name: "Timestamped" });
      const after = Math.floor(Date.now() / 1000);
      expect(product.created).toBeGreaterThanOrEqual(before);
      expect(product.created).toBeLessThanOrEqual(after);
    });
  });

  describe("retrieve", () => {
    it("returns a product by ID", () => {
      const svc = makeService();
      const created = svc.create({ name: "Retrievable" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe("Retrievable");
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("prod_nonexistent")).toThrow();
      try {
        svc.retrieve("prod_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("throws 404 for deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "To Delete" });
      svc.del(created.id);
      expect(() => svc.retrieve(created.id)).toThrow();
    });
  });

  describe("update", () => {
    it("updates name", () => {
      const svc = makeService();
      const created = svc.create({ name: "Old Name" });
      const updated = svc.update(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    it("updates active status", () => {
      const svc = makeService();
      const created = svc.create({ name: "Active" });
      const updated = svc.update(created.id, { active: false });
      expect(updated.active).toBe(false);
    });

    it("persists updates across retrieves", () => {
      const svc = makeService();
      const created = svc.create({ name: "Before" });
      svc.update(created.id, { name: "After" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.name).toBe("After");
    });

    it("merges metadata", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { b: "2" } });
      expect(updated.metadata).toEqual({ a: "1", b: "2" });
    });

    it("throws 404 for nonexistent product", () => {
      const svc = makeService();
      expect(() => svc.update("prod_missing", { name: "New" })).toThrow();
    });
  });

  describe("del", () => {
    it("marks product as deleted", () => {
      const svc = makeService();
      const created = svc.create({ name: "To Delete" });
      const deleted = svc.del(created.id);
      expect(deleted.id).toBe(created.id);
      expect(deleted.object).toBe("product");
      expect(deleted.deleted).toBe(true);
    });

    it("prevents retrieval after deletion", () => {
      const svc = makeService();
      const created = svc.create({ name: "Gone" });
      svc.del(created.id);
      expect(() => svc.retrieve(created.id)).toThrow();
    });

    it("throws 404 for nonexistent product", () => {
      const svc = makeService();
      expect(() => svc.del("prod_ghost")).toThrow();
    });
  });

  describe("list", () => {
    it("returns empty list when no products exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/products");
    });

    it("returns all products up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ name: `Product ${i}` });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ name: `Product ${i}` });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("paginates with starting_after", () => {
      const svc = makeService();
      svc.create({ name: "A" });
      svc.create({ name: "B" });
      svc.create({ name: "C" });

      const page1 = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });

    it("excludes deleted products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Keep" });
      const p2 = svc.create({ name: "Delete Me" });
      svc.del(p2.id);
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(p1.id);
    });

    it("throws 404 if starting_after cursor does not exist", () => {
      const svc = makeService();
      expect(() =>
        svc.list({ limit: 10, startingAfter: "prod_ghost", endingBefore: undefined })
      ).toThrow();
    });
  });
});
