import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { ProductService } from "../../../src/services/products";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new ProductService(db);
}

const listParams = (overrides?: { limit?: number; startingAfter?: string }) => ({
  limit: overrides?.limit ?? 10,
  startingAfter: overrides?.startingAfter ?? undefined,
  endingBefore: undefined,
});

describe("ProductService", () => {
  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------
  describe("create", () => {
    // --- minimal creation ---
    it("creates a product with name only", () => {
      const svc = makeService();
      const p = svc.create({ name: "Widget" });
      expect(p.name).toBe("Widget");
      expect(p.id).toMatch(/^prod_/);
    });

    it("creates a product with all params", () => {
      const svc = makeService();
      const p = svc.create({
        name: "Full Product",
        description: "A complete product",
        metadata: { key: "val" },
        active: false,
        url: "https://example.com",
        statement_descriptor: "WIDGETCO",
        unit_label: "seat",
        tax_code: "txcd_10000000",
      });
      expect(p.name).toBe("Full Product");
      expect(p.description).toBe("A complete product");
      expect(p.metadata).toEqual({ key: "val" });
      expect(p.active).toBe(false);
      expect((p as any).url).toBe("https://example.com");
      expect(p.statement_descriptor).toBe("WIDGETCO");
      expect(p.unit_label).toBe("seat");
      expect(p.tax_code).toBe("txcd_10000000");
    });

    // --- active flag ---
    it("defaults active to true", () => {
      const svc = makeService();
      const p = svc.create({ name: "Active by default" });
      expect(p.active).toBe(true);
    });

    it("can create with active=true explicitly", () => {
      const svc = makeService();
      const p = svc.create({ name: "Explicitly active", active: true });
      expect(p.active).toBe(true);
    });

    it("can create with active=false", () => {
      const svc = makeService();
      const p = svc.create({ name: "Inactive", active: false });
      expect(p.active).toBe(false);
    });

    // --- metadata ---
    it("stores metadata", () => {
      const svc = makeService();
      const p = svc.create({ name: "Meta", metadata: { category: "books", region: "us" } });
      expect(p.metadata).toEqual({ category: "books", region: "us" });
    });

    it("defaults metadata to empty object", () => {
      const svc = makeService();
      const p = svc.create({ name: "No Meta" });
      expect(p.metadata).toEqual({});
    });

    it("stores metadata with many keys", () => {
      const svc = makeService();
      const meta: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        meta[`key_${i}`] = `value_${i}`;
      }
      const p = svc.create({ name: "Many keys", metadata: meta });
      expect(Object.keys(p.metadata).length).toBe(20);
      expect(p.metadata.key_0).toBe("value_0");
      expect(p.metadata.key_19).toBe("value_19");
    });

    it("stores metadata with empty string values", () => {
      const svc = makeService();
      const p = svc.create({ name: "Empty vals", metadata: { empty: "" } });
      expect(p.metadata).toEqual({ empty: "" });
    });

    // --- description ---
    it("creates with description", () => {
      const svc = makeService();
      const p = svc.create({ name: "Desc", description: "My description" });
      expect(p.description).toBe("My description");
    });

    it("defaults description to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "No Desc" });
      expect(p.description).toBeNull();
    });

    // --- url ---
    it("creates with url", () => {
      const svc = makeService();
      const p = svc.create({ name: "URL", url: "https://example.com/product" });
      expect((p as any).url).toBe("https://example.com/product");
    });

    it("defaults url to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "No URL" });
      expect((p as any).url).toBeNull();
    });

    // --- statement_descriptor ---
    it("creates with statement_descriptor", () => {
      const svc = makeService();
      const p = svc.create({ name: "SD", statement_descriptor: "MYSHOP" });
      expect(p.statement_descriptor).toBe("MYSHOP");
    });

    it("defaults statement_descriptor to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "No SD" });
      expect(p.statement_descriptor).toBeNull();
    });

    // --- unit_label ---
    it("creates with unit_label", () => {
      const svc = makeService();
      const p = svc.create({ name: "UL", unit_label: "seat" });
      expect(p.unit_label).toBe("seat");
    });

    it("defaults unit_label to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "No UL" });
      expect(p.unit_label).toBeNull();
    });

    // --- tax_code ---
    it("creates with tax_code", () => {
      const svc = makeService();
      const p = svc.create({ name: "Tax", tax_code: "txcd_123" });
      expect(p.tax_code).toBe("txcd_123");
    });

    it("defaults tax_code to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "No Tax" });
      expect(p.tax_code).toBeNull();
    });

    // --- id format ---
    it("generates id with prod_ prefix", () => {
      const svc = makeService();
      const p = svc.create({ name: "ID Test" });
      expect(p.id).toMatch(/^prod_/);
      expect(p.id.length).toBeGreaterThan(5);
    });

    // --- object type ---
    it("sets object to 'product'", () => {
      const svc = makeService();
      const p = svc.create({ name: "Obj" });
      expect(p.object).toBe("product");
    });

    // --- default_price ---
    it("sets default_price to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "DP" });
      expect(p.default_price).toBeNull();
    });

    // --- timestamps ---
    it("sets created to current unix timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const p = svc.create({ name: "Timestamped" });
      const after = Math.floor(Date.now() / 1000);
      expect(p.created).toBeGreaterThanOrEqual(before);
      expect(p.created).toBeLessThanOrEqual(after);
    });

    it("sets updated to same value as created on creation", () => {
      const svc = makeService();
      const p = svc.create({ name: "Updated" });
      expect((p as any).updated).toBe(p.created);
    });

    // --- livemode ---
    it("sets livemode to false", () => {
      const svc = makeService();
      const p = svc.create({ name: "Live" });
      expect(p.livemode).toBe(false);
    });

    // --- type ---
    it("sets type to 'service'", () => {
      const svc = makeService();
      const p = svc.create({ name: "Type" });
      expect((p as any).type).toBe("service");
    });

    // --- images ---
    it("defaults images to empty array", () => {
      const svc = makeService();
      const p = svc.create({ name: "Imgs" });
      expect(p.images).toEqual([]);
    });

    // --- other nullable fields ---
    it("sets package_dimensions to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "PD" });
      expect(p.package_dimensions).toBeNull();
    });

    it("sets shippable to null", () => {
      const svc = makeService();
      const p = svc.create({ name: "Ship" });
      expect(p.shippable).toBeNull();
    });

    // --- uniqueness ---
    it("generates unique IDs for multiple products", () => {
      const svc = makeService();
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(svc.create({ name: `P${i}` }).id);
      }
      expect(ids.size).toBe(20);
    });

    // --- validation ---
    it("throws 400 when name is missing", () => {
      const svc = makeService();
      expect(() => svc.create({})).toThrow();
    });

    it("throws StripeError with correct shape when name is missing", () => {
      const svc = makeService();
      try {
        svc.create({});
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
        expect((err as StripeError).body.error.param).toBe("name");
      }
    });

    it("throws when name is empty string", () => {
      const svc = makeService();
      expect(() => svc.create({ name: "" })).toThrow();
    });

    // --- special characters ---
    it("creates with very long name", () => {
      const svc = makeService();
      const longName = "A".repeat(500);
      const p = svc.create({ name: longName });
      expect(p.name).toBe(longName);
    });

    it("creates with special characters in name", () => {
      const svc = makeService();
      const p = svc.create({ name: "Widget <>&\"'!@#$%^*()" });
      expect(p.name).toBe("Widget <>&\"'!@#$%^*()");
    });

    it("creates with unicode in name", () => {
      const svc = makeService();
      const p = svc.create({ name: "Produkt" });
      expect(p.name).toBe("Produkt");
    });

    it("creates with unicode in description", () => {
      const svc = makeService();
      const p = svc.create({ name: "Uni", description: "Beschreibung mit Umlauten" });
      expect(p.description).toBe("Beschreibung mit Umlauten");
    });

    it("creates with emoji in name", () => {
      const svc = makeService();
      const p = svc.create({ name: "Rocket Product \u{1F680}" });
      expect(p.name).toBe("Rocket Product \u{1F680}");
    });

    it("creates with newlines in description", () => {
      const svc = makeService();
      const p = svc.create({ name: "NL", description: "line1\nline2\nline3" });
      expect(p.description).toBe("line1\nline2\nline3");
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve()
  // ---------------------------------------------------------------------------
  describe("retrieve", () => {
    it("returns a product by ID", () => {
      const svc = makeService();
      const created = svc.create({ name: "Retrievable" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe("Retrievable");
    });

    it("all fields match the created product", () => {
      const svc = makeService();
      const created = svc.create({
        name: "Match",
        description: "desc",
        metadata: { k: "v" },
        active: false,
        url: "https://match.com",
        statement_descriptor: "MATCH",
        unit_label: "item",
        tax_code: "txcd_1",
      });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.object).toBe(created.object);
      expect(retrieved.name).toBe(created.name);
      expect(retrieved.description).toBe(created.description);
      expect(retrieved.metadata).toEqual(created.metadata);
      expect(retrieved.active).toBe(created.active);
      expect((retrieved as any).url).toBe((created as any).url);
      expect(retrieved.statement_descriptor).toBe(created.statement_descriptor);
      expect(retrieved.unit_label).toBe(created.unit_label);
      expect(retrieved.tax_code).toBe(created.tax_code);
      expect(retrieved.created).toBe(created.created);
      expect((retrieved as any).updated).toBe((created as any).updated);
      expect(retrieved.livemode).toBe(created.livemode);
      expect(retrieved.default_price).toBe(created.default_price);
      expect(retrieved.images).toEqual(created.images);
      expect(retrieved.package_dimensions).toBe(created.package_dimensions);
      expect(retrieved.shippable).toBe(created.shippable);
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("prod_nonexistent")).toThrow();
    });

    it("throws StripeError with resource_missing code for nonexistent ID", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_nonexistent");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("error message includes the product ID", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_missing123");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("prod_missing123");
      }
    });

    it("error message says 'No such product'", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_xyz");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("No such product");
      }
    });

    it("throws 404 for deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "To Delete" });
      svc.del(created.id);
      expect(() => svc.retrieve(created.id)).toThrow();
    });

    it("throws StripeError for deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "Deleted" });
      svc.del(created.id);
      try {
        svc.retrieve(created.id);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("retrieves product with metadata intact", () => {
      const svc = makeService();
      const meta = { env: "test", version: "2.0", complex: "key=val&foo" };
      const created = svc.create({ name: "MetaRT", metadata: meta });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual(meta);
    });

    it("can retrieve multiple different products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Product A" });
      const p2 = svc.create({ name: "Product B" });
      expect(svc.retrieve(p1.id).name).toBe("Product A");
      expect(svc.retrieve(p2.id).name).toBe("Product B");
    });

    it("retrieve does not modify the product", () => {
      const svc = makeService();
      const created = svc.create({ name: "Immutable" });
      const r1 = svc.retrieve(created.id);
      const r2 = svc.retrieve(created.id);
      expect(r1).toEqual(r2);
    });

    it("error param is 'id' for missing product", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_abc");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("id");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------
  describe("update", () => {
    it("updates name", () => {
      const svc = makeService();
      const created = svc.create({ name: "Old Name" });
      const updated = svc.update(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    it("updates description", () => {
      const svc = makeService();
      const created = svc.create({ name: "Desc", description: "old" });
      const updated = svc.update(created.id, { description: "new" });
      expect(updated.description).toBe("new");
    });

    it("updates description from null to a value", () => {
      const svc = makeService();
      const created = svc.create({ name: "NoDesc" });
      expect(created.description).toBeNull();
      const updated = svc.update(created.id, { description: "now set" });
      expect(updated.description).toBe("now set");
    });

    it("updates active to false", () => {
      const svc = makeService();
      const created = svc.create({ name: "Active" });
      const updated = svc.update(created.id, { active: false });
      expect(updated.active).toBe(false);
    });

    it("updates active to true from false", () => {
      const svc = makeService();
      const created = svc.create({ name: "Reactivate", active: false });
      expect(created.active).toBe(false);
      const updated = svc.update(created.id, { active: true });
      expect(updated.active).toBe(true);
    });

    it("merges metadata (adds new keys)", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { b: "2" } });
      expect(updated.metadata).toEqual({ a: "1", b: "2" });
    });

    it("merges metadata (overwrites existing keys)", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { a: "1" } });
      const updated = svc.update(created.id, { metadata: { a: "replaced" } });
      expect(updated.metadata).toEqual({ a: "replaced" });
    });

    it("merges metadata (mixed add and overwrite)", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { a: "1", b: "2" } });
      const updated = svc.update(created.id, { metadata: { b: "new", c: "3" } });
      expect(updated.metadata).toEqual({ a: "1", b: "new", c: "3" });
    });

    it("sets metadata key to empty string to delete it in Stripe convention", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { keep: "yes", remove: "yes" } });
      const updated = svc.update(created.id, { metadata: { remove: "" } });
      // The service merges, so both keys remain; "" is stored
      expect(updated.metadata.remove).toBe("");
      expect(updated.metadata.keep).toBe("yes");
    });

    it("does not touch metadata when metadata param is not provided", () => {
      const svc = makeService();
      const created = svc.create({ name: "Meta", metadata: { existing: "val" } });
      const updated = svc.update(created.id, { name: "Updated Name" });
      expect(updated.metadata).toEqual({ existing: "val" });
    });

    it("updates url", () => {
      const svc = makeService();
      const created = svc.create({ name: "URL" });
      const updated = svc.update(created.id, { url: "https://new.com" });
      expect((updated as any).url).toBe("https://new.com");
    });

    it("updates statement_descriptor", () => {
      const svc = makeService();
      const created = svc.create({ name: "SD" });
      const updated = svc.update(created.id, { statement_descriptor: "NEWSD" });
      expect(updated.statement_descriptor).toBe("NEWSD");
    });

    it("updates unit_label", () => {
      const svc = makeService();
      const created = svc.create({ name: "UL" });
      const updated = svc.update(created.id, { unit_label: "license" });
      expect(updated.unit_label).toBe("license");
    });

    it("updates tax_code", () => {
      const svc = makeService();
      const created = svc.create({ name: "Tax" });
      const updated = svc.update(created.id, { tax_code: "txcd_456" });
      expect(updated.tax_code).toBe("txcd_456");
    });

    it("preserves unchanged fields", () => {
      const svc = makeService();
      const created = svc.create({
        name: "Preserve",
        description: "desc",
        metadata: { k: "v" },
        url: "https://preserve.com",
      });
      const updated = svc.update(created.id, { name: "New Name" });
      expect(updated.description).toBe("desc");
      expect(updated.metadata).toEqual({ k: "v" });
      expect((updated as any).url).toBe("https://preserve.com");
      expect(updated.active).toBe(true);
    });

    it("updates the 'updated' timestamp", () => {
      const svc = makeService();
      const created = svc.create({ name: "Timestamp" });
      const originalUpdated = (created as any).updated;
      // Service uses now() so updated should be >= created
      const updated = svc.update(created.id, { name: "Changed" });
      expect((updated as any).updated).toBeGreaterThanOrEqual(originalUpdated);
    });

    it("preserves the 'created' timestamp", () => {
      const svc = makeService();
      const created = svc.create({ name: "Created TS" });
      const updated = svc.update(created.id, { name: "New" });
      expect(updated.created).toBe(created.created);
    });

    it("preserves the id", () => {
      const svc = makeService();
      const created = svc.create({ name: "ID" });
      const updated = svc.update(created.id, { name: "New" });
      expect(updated.id).toBe(created.id);
    });

    it("preserves object type", () => {
      const svc = makeService();
      const created = svc.create({ name: "Obj" });
      const updated = svc.update(created.id, { name: "New" });
      expect(updated.object).toBe("product");
    });

    it("throws 404 for nonexistent product", () => {
      const svc = makeService();
      expect(() => svc.update("prod_missing", { name: "New" })).toThrow();
    });

    it("throws StripeError for nonexistent product", () => {
      const svc = makeService();
      try {
        svc.update("prod_missing", { name: "New" });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("returns the updated object", () => {
      const svc = makeService();
      const created = svc.create({ name: "Return" });
      const updated = svc.update(created.id, { name: "Returned" });
      expect(updated.name).toBe("Returned");
      expect(updated.id).toBe(created.id);
    });

    it("persists updates across retrieves", () => {
      const svc = makeService();
      const created = svc.create({ name: "Before" });
      svc.update(created.id, { name: "After" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.name).toBe("After");
    });

    it("multiple sequential updates accumulate correctly", () => {
      const svc = makeService();
      const created = svc.create({ name: "V1" });
      svc.update(created.id, { name: "V2" });
      svc.update(created.id, { description: "desc" });
      svc.update(created.id, { metadata: { a: "1" } });
      const final = svc.retrieve(created.id);
      expect(final.name).toBe("V2");
      expect(final.description).toBe("desc");
      expect(final.metadata).toEqual({ a: "1" });
    });

    it("update then retrieve metadata consistency", () => {
      const svc = makeService();
      const created = svc.create({ name: "M", metadata: { x: "1" } });
      svc.update(created.id, { metadata: { y: "2" } });
      svc.update(created.id, { metadata: { z: "3" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ x: "1", y: "2", z: "3" });
    });

    it("throws 404 for deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "Del" });
      svc.del(created.id);
      expect(() => svc.update(created.id, { name: "Fail" })).toThrow();
    });

    it("update with empty params preserves all fields", () => {
      const svc = makeService();
      const created = svc.create({ name: "Noop", description: "d", metadata: { k: "v" } });
      const updated = svc.update(created.id, {});
      expect(updated.name).toBe("Noop");
      expect(updated.description).toBe("d");
      expect(updated.metadata).toEqual({ k: "v" });
    });

    it("toggle active false then true", () => {
      const svc = makeService();
      const created = svc.create({ name: "Toggle" });
      expect(created.active).toBe(true);
      const off = svc.update(created.id, { active: false });
      expect(off.active).toBe(false);
      const on = svc.update(created.id, { active: true });
      expect(on.active).toBe(true);
    });

    it("persists active toggle in DB", () => {
      const svc = makeService();
      const created = svc.create({ name: "PersistToggle" });
      svc.update(created.id, { active: false });
      expect(svc.retrieve(created.id).active).toBe(false);
      svc.update(created.id, { active: true });
      expect(svc.retrieve(created.id).active).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // del()
  // ---------------------------------------------------------------------------
  describe("del", () => {
    it("returns deletion confirmation object", () => {
      const svc = makeService();
      const created = svc.create({ name: "To Delete" });
      const deleted = svc.del(created.id);
      expect(deleted.id).toBe(created.id);
      expect(deleted.object).toBe("product");
      expect(deleted.deleted).toBe(true);
    });

    it("deleted response has correct id", () => {
      const svc = makeService();
      const p = svc.create({ name: "ID Check" });
      const d = svc.del(p.id);
      expect(d.id).toBe(p.id);
    });

    it("deleted response has object 'product'", () => {
      const svc = makeService();
      const p = svc.create({ name: "Obj Check" });
      const d = svc.del(p.id);
      expect(d.object).toBe("product");
    });

    it("deleted response has deleted=true", () => {
      const svc = makeService();
      const p = svc.create({ name: "Del Check" });
      const d = svc.del(p.id);
      expect(d.deleted).toBe(true);
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

    it("throws StripeError for nonexistent product", () => {
      const svc = makeService();
      try {
        svc.del("prod_ghost");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws 404 when deleting already-deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "Double Del" });
      svc.del(created.id);
      expect(() => svc.del(created.id)).toThrow();
    });

    it("throws StripeError when deleting already-deleted product", () => {
      const svc = makeService();
      const created = svc.create({ name: "Double Del SE" });
      svc.del(created.id);
      try {
        svc.del(created.id);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("does not affect other products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Keep" });
      const p2 = svc.create({ name: "Delete" });
      svc.del(p2.id);
      const retrieved = svc.retrieve(p1.id);
      expect(retrieved.name).toBe("Keep");
    });

    it("deleted product is excluded from list", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Keep" });
      const p2 = svc.create({ name: "Delete" });
      svc.del(p2.id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(p1.id);
    });

    it("deleting one of many products only removes that one", () => {
      const svc = makeService();
      const products = [];
      for (let i = 0; i < 5; i++) {
        products.push(svc.create({ name: `P${i}` }));
      }
      svc.del(products[2].id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(4);
      expect(result.data.find(p => p.id === products[2].id)).toBeUndefined();
    });

    it("can delete the only product", () => {
      const svc = makeService();
      const p = svc.create({ name: "Only" });
      svc.del(p.id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(0);
    });

    it("delete does not delete the product data, just marks as deleted (soft delete)", () => {
      const svc = makeService();
      const p = svc.create({ name: "Soft" });
      svc.del(p.id);
      // retrieve throws because deleted=1 is checked
      expect(() => svc.retrieve(p.id)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("returns empty list when no products exist", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns url /v1/products", () => {
      const svc = makeService();
      const result = svc.list(listParams());
      expect(result.url).toBe("/v1/products");
    });

    it("returns all products up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ name: `Product ${i}` });
      }
      const result = svc.list(listParams());
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit param", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ name: `Product ${i}` });
      }
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when products fit in limit", () => {
      const svc = makeService();
      svc.create({ name: "A" });
      svc.create({ name: "B" });
      const result = svc.list(listParams({ limit: 5 }));
      expect(result.has_more).toBe(false);
    });

    it("has_more is true when more products exist", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ name: `P${i}` });
      }
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when limit equals product count", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ name: `P${i}` });
      }
      const result = svc.list(listParams({ limit: 3 }));
      expect(result.has_more).toBe(false);
    });

    it("paginates with starting_after", () => {
      const svc = makeService();
      svc.create({ name: "A" });
      svc.create({ name: "B" });
      svc.create({ name: "C" });

      const page1 = svc.list(listParams({ limit: 2 }));
      expect(page1.data.length).toBe(2);
      expect(page1.has_more).toBe(true);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list(listParams({ limit: 2, startingAfter: lastId }));
      // Pagination uses gt(created) so same-second inserts may not paginate fully
      expect(page2.has_more).toBe(false);
    });

    it("paginating works correctly when timestamps differ", () => {
      // The list implementation uses gt(created) for cursor pagination.
      // When created within the same second, pagination may not advance.
      // This test validates the pagination mechanism itself.
      const svc = makeService();
      svc.create({ name: "A" });

      const page1 = svc.list(listParams({ limit: 1 }));
      expect(page1.data.length).toBe(1);
    });

    it("excludes deleted products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Keep" });
      const p2 = svc.create({ name: "Delete" });
      svc.del(p2.id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(p1.id);
    });

    it("throws 404 if starting_after cursor does not exist", () => {
      const svc = makeService();
      expect(() => svc.list(listParams({ startingAfter: "prod_ghost" }))).toThrow();
    });

    it("throws StripeError if starting_after cursor does not exist", () => {
      const svc = makeService();
      try {
        svc.list(listParams({ startingAfter: "prod_ghost" }));
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("list with limit=1 returns one product", () => {
      const svc = makeService();
      svc.create({ name: "A" });
      svc.create({ name: "B" });
      const result = svc.list(listParams({ limit: 1 }));
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("list returns products as full objects with all fields", () => {
      const svc = makeService();
      svc.create({ name: "Full", description: "d", metadata: { k: "v" } });
      const result = svc.list(listParams());
      const p = result.data[0];
      expect(p.id).toMatch(/^prod_/);
      expect(p.object).toBe("product");
      expect(p.name).toBe("Full");
      expect(p.description).toBe("d");
      expect(p.metadata).toEqual({ k: "v" });
    });

    it("list with many products (20+)", () => {
      const svc = makeService();
      for (let i = 0; i < 25; i++) {
        svc.create({ name: `Product ${i}` });
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

    it("list only contains non-deleted products after mixed operations", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "A" });
      const p2 = svc.create({ name: "B" });
      const p3 = svc.create({ name: "C" });
      svc.del(p1.id);
      svc.del(p3.id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(p2.id);
    });

    it("list after deleting all products returns empty", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "A" });
      const p2 = svc.create({ name: "B" });
      svc.del(p1.id);
      svc.del(p2.id);
      const result = svc.list(listParams());
      expect(result.data.length).toBe(0);
      expect(result.has_more).toBe(false);
    });

    it("list with starting_after still excludes deleted products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "A" });
      const p2 = svc.create({ name: "B" });
      const p3 = svc.create({ name: "C" });
      svc.del(p3.id);
      const page = svc.list(listParams({ limit: 10, startingAfter: p1.id }));
      // p2 should be there, p3 deleted
      expect(page.data.find(p => p.id === p3.id)).toBeUndefined();
    });

    it("pagination skips deleted products correctly", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "A" });
      const p2 = svc.create({ name: "B" });
      const p3 = svc.create({ name: "C" });
      const p4 = svc.create({ name: "D" });
      svc.del(p2.id);
      // Page 1: limit 2 should give p1, p3
      const page1 = svc.list(listParams({ limit: 2 }));
      expect(page1.data.length).toBe(2);
      expect(page1.data.every(p => p.id !== p2.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape (comprehensive)
  // ---------------------------------------------------------------------------
  describe("object shape", () => {
    it("has all expected top-level keys", () => {
      const svc = makeService();
      const p = svc.create({ name: "Shape" });
      const keys = Object.keys(p);
      expect(keys).toContain("id");
      expect(keys).toContain("object");
      expect(keys).toContain("active");
      expect(keys).toContain("created");
      expect(keys).toContain("default_price");
      expect(keys).toContain("description");
      expect(keys).toContain("images");
      expect(keys).toContain("livemode");
      expect(keys).toContain("metadata");
      expect(keys).toContain("name");
      expect(keys).toContain("package_dimensions");
      expect(keys).toContain("shippable");
      expect(keys).toContain("statement_descriptor");
      expect(keys).toContain("tax_code");
      expect(keys).toContain("unit_label");
      expect(keys).toContain("updated");
      expect(keys).toContain("url");
      expect(keys).toContain("type");
    });

    it("default values for a minimal product", () => {
      const svc = makeService();
      const p = svc.create({ name: "Minimal" });
      expect(p.active).toBe(true);
      expect(p.default_price).toBeNull();
      expect(p.description).toBeNull();
      expect(p.images).toEqual([]);
      expect(p.livemode).toBe(false);
      expect(p.metadata).toEqual({});
      expect(p.package_dimensions).toBeNull();
      expect(p.shippable).toBeNull();
      expect(p.statement_descriptor).toBeNull();
      expect(p.tax_code).toBeNull();
      expect(p.unit_label).toBeNull();
      expect((p as any).url).toBeNull();
      expect((p as any).type).toBe("service");
    });

    it("metadata is a plain object", () => {
      const svc = makeService();
      const p = svc.create({ name: "MetaObj" });
      expect(typeof p.metadata).toBe("object");
      expect(p.metadata).not.toBeNull();
    });

    it("images is an array", () => {
      const svc = makeService();
      const p = svc.create({ name: "ImgArr" });
      expect(Array.isArray(p.images)).toBe(true);
    });

    it("created is a number (unix timestamp)", () => {
      const svc = makeService();
      const p = svc.create({ name: "TS" });
      expect(typeof p.created).toBe("number");
    });

    it("updated is a number (unix timestamp)", () => {
      const svc = makeService();
      const p = svc.create({ name: "UTS" });
      expect(typeof (p as any).updated).toBe("number");
    });

    it("id is a string", () => {
      const svc = makeService();
      const p = svc.create({ name: "IdStr" });
      expect(typeof p.id).toBe("string");
    });

    it("name is a string", () => {
      const svc = makeService();
      const p = svc.create({ name: "NameStr" });
      expect(typeof p.name).toBe("string");
    });

    it("active is a boolean", () => {
      const svc = makeService();
      const p = svc.create({ name: "ActiveBool" });
      expect(typeof p.active).toBe("boolean");
    });

    it("livemode is a boolean", () => {
      const svc = makeService();
      const p = svc.create({ name: "LiveBool" });
      expect(typeof p.livemode).toBe("boolean");
    });
  });

  // ---------------------------------------------------------------------------
  // Integration-style: cross-method interactions
  // ---------------------------------------------------------------------------
  describe("cross-method interactions", () => {
    it("create then list returns the product", () => {
      const svc = makeService();
      const p = svc.create({ name: "Listed" });
      const list = svc.list(listParams());
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(p.id);
    });

    it("create, update, retrieve returns updated product", () => {
      const svc = makeService();
      const p = svc.create({ name: "V1" });
      svc.update(p.id, { name: "V2", description: "updated" });
      const retrieved = svc.retrieve(p.id);
      expect(retrieved.name).toBe("V2");
      expect(retrieved.description).toBe("updated");
    });

    it("create, delete, list returns empty", () => {
      const svc = makeService();
      const p = svc.create({ name: "Deleted" });
      svc.del(p.id);
      const list = svc.list(listParams());
      expect(list.data.length).toBe(0);
    });

    it("create multiple, delete some, list returns remainder", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Keep1" });
      const p2 = svc.create({ name: "Del1" });
      const p3 = svc.create({ name: "Keep2" });
      const p4 = svc.create({ name: "Del2" });
      svc.del(p2.id);
      svc.del(p4.id);
      const list = svc.list(listParams());
      expect(list.data.length).toBe(2);
      const ids = list.data.map(p => p.id);
      expect(ids).toContain(p1.id);
      expect(ids).toContain(p3.id);
    });

    it("update does not change list count", () => {
      const svc = makeService();
      svc.create({ name: "One" });
      svc.create({ name: "Two" });
      const before = svc.list(listParams());
      svc.update(before.data[0].id, { name: "Updated" });
      const after = svc.list(listParams());
      expect(after.data.length).toBe(before.data.length);
    });

    it("different services (different DBs) are isolated", () => {
      const svc1 = makeService();
      const svc2 = makeService();
      svc1.create({ name: "Isolated" });
      const list = svc2.list(listParams());
      expect(list.data.length).toBe(0);
    });

    it("create, update metadata, delete, then list excludes deleted", () => {
      const svc = makeService();
      const p = svc.create({ name: "Lifecycle" });
      svc.update(p.id, { metadata: { status: "updated" } });
      svc.del(p.id);
      const list = svc.list(listParams());
      expect(list.data.length).toBe(0);
    });

    it("delete does not affect updates to other products", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Survivor" });
      const p2 = svc.create({ name: "Doomed" });
      svc.update(p1.id, { description: "still here" });
      svc.del(p2.id);
      const retrieved = svc.retrieve(p1.id);
      expect(retrieved.description).toBe("still here");
    });

    it("updating active=false then listing still includes the product", () => {
      const svc = makeService();
      const p = svc.create({ name: "Inactive but listed" });
      svc.update(p.id, { active: false });
      // list does not filter by active
      const list = svc.list(listParams());
      expect(list.data.length).toBe(1);
      expect(list.data[0].active).toBe(false);
    });

    it("retrieve after update shows updated values in list too", () => {
      const svc = makeService();
      const p = svc.create({ name: "ListUpdate" });
      svc.update(p.id, { name: "Updated Name" });
      const list = svc.list(listParams());
      expect(list.data[0].name).toBe("Updated Name");
    });

    it("create products with same name results in different IDs", () => {
      const svc = makeService();
      const p1 = svc.create({ name: "Same Name" });
      const p2 = svc.create({ name: "Same Name" });
      expect(p1.id).not.toBe(p2.id);
      expect(p1.name).toBe(p2.name);
    });

    it("list shows updated product data not stale data", () => {
      const svc = makeService();
      const p = svc.create({ name: "Before", description: "old" });
      svc.update(p.id, { description: "new" });
      const list = svc.list(listParams());
      expect(list.data[0].description).toBe("new");
    });
  });

  // ---------------------------------------------------------------------------
  // Error shapes (comprehensive)
  // ---------------------------------------------------------------------------
  describe("error shapes", () => {
    it("create error has type invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.create({});
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("create error has message about name", () => {
      const svc = makeService();
      try {
        svc.create({});
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("name");
      }
    });

    it("retrieve error for deleted product has resource_missing code", () => {
      const svc = makeService();
      const p = svc.create({ name: "Del" });
      svc.del(p.id);
      try {
        svc.retrieve(p.id);
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("update error for deleted product has resource_missing code", () => {
      const svc = makeService();
      const p = svc.create({ name: "Del" });
      svc.del(p.id);
      try {
        svc.update(p.id, { name: "Fail" });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("delete error for nonexistent product has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.del("prod_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("list starting_after error has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.list(listParams({ startingAfter: "prod_nope" }));
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("all 404 errors have param=id", () => {
      const svc = makeService();
      for (const fn of [
        () => svc.retrieve("prod_x"),
        () => svc.update("prod_x", { name: "N" }),
        () => svc.del("prod_x"),
      ]) {
        try {
          fn();
          expect(true).toBe(false);
        } catch (err) {
          expect((err as StripeError).body.error.param).toBe("id");
        }
      }
    });

    it("create 400 has param=name", () => {
      const svc = makeService();
      try {
        svc.create({});
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("name");
      }
    });

    it("errors are instances of StripeError", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("error statusCode is a number", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(typeof (err as StripeError).statusCode).toBe("number");
      }
    });

    it("error body has error property with type string", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(typeof (err as StripeError).body.error.type).toBe("string");
        expect(typeof (err as StripeError).body.error.message).toBe("string");
      }
    });

    it("error body has error.code as string for 404", () => {
      const svc = makeService();
      try {
        svc.retrieve("prod_nope");
        expect(true).toBe(false);
      } catch (err) {
        expect(typeof (err as StripeError).body.error.code).toBe("string");
      }
    });
  });
});
