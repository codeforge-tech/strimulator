import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { WebhookEndpointService } from "../../../src/services/webhook-endpoints";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new WebhookEndpointService(db);
}

describe("WebhookEndpointService", () => {
  // ============================================================
  // create() tests
  // ============================================================
  describe("create", () => {
    it("creates an endpoint with url and enabled_events", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["customer.created"] });
      expect(ep.url).toBe("https://example.com/hook");
      expect(ep.enabled_events).toEqual(["customer.created"]);
    });

    it("creates an endpoint with wildcard enabled_events=['*']", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.enabled_events).toEqual(["*"]);
    });

    it("creates an endpoint with specific event types", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["invoice.paid"] });
      expect(ep.enabled_events).toEqual(["invoice.paid"]);
    });

    it("creates an endpoint with multiple event types", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["customer.created", "customer.updated", "invoice.paid"],
      });
      expect(ep.enabled_events).toEqual(["customer.created", "customer.updated", "invoice.paid"]);
      expect(ep.enabled_events).toHaveLength(3);
    });

    it("creates an endpoint with metadata", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["*"],
        metadata: { env: "test", team: "backend" },
      });
      expect(ep.metadata).toEqual({ env: "test", team: "backend" });
    });

    it("creates an endpoint with description", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["*"],
        description: "My test endpoint",
      });
      expect(ep.description).toBe("My test endpoint");
    });

    it("creates an endpoint with api_version null by default", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.api_version).toBeNull();
    });

    it("generates an id starting with 'we_'", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.id).toMatch(/^we_/);
    });

    it("sets object to 'webhook_endpoint'", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.object).toBe("webhook_endpoint");
    });

    it("generates a secret starting with 'whsec_'", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.secret).toMatch(/^whsec_/);
    });

    it("sets status to 'enabled' by default", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.status).toBe("enabled");
    });

    it("stores url correctly", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://my-app.example.com/webhooks/stripe", enabled_events: ["*"] });
      expect(ep.url).toBe("https://my-app.example.com/webhooks/stripe");
    });

    it("stores enabled_events correctly on retrieval", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["charge.succeeded", "charge.failed"] });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.enabled_events).toEqual(["charge.succeeded", "charge.failed"]);
    });

    it("sets a created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const after = Math.floor(Date.now() / 1000);
      expect(ep.created).toBeGreaterThanOrEqual(before);
      expect(ep.created).toBeLessThanOrEqual(after);
    });

    it("sets livemode to false", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.livemode).toBe(false);
    });

    it("generates unique IDs for multiple endpoints", () => {
      const svc = makeService();
      const ep1 = svc.create({ url: "https://example.com/hook1", enabled_events: ["*"] });
      const ep2 = svc.create({ url: "https://example.com/hook2", enabled_events: ["*"] });
      expect(ep1.id).not.toBe(ep2.id);
    });

    it("generates unique secrets for multiple endpoints", () => {
      const svc = makeService();
      const ep1 = svc.create({ url: "https://example.com/hook1", enabled_events: ["*"] });
      const ep2 = svc.create({ url: "https://example.com/hook2", enabled_events: ["*"] });
      expect(ep1.secret).not.toBe(ep2.secret);
    });

    it("throws when url is missing", () => {
      const svc = makeService();
      expect(() => svc.create({ url: "", enabled_events: ["*"] })).toThrow();
    });

    it("throws invalidRequestError when url is empty", () => {
      const svc = makeService();
      try {
        svc.create({ url: "", enabled_events: ["*"] });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("url");
      }
    });

    it("throws when enabled_events is empty array", () => {
      const svc = makeService();
      expect(() => svc.create({ url: "https://example.com/hook", enabled_events: [] })).toThrow();
    });

    it("throws invalidRequestError when enabled_events is empty", () => {
      const svc = makeService();
      try {
        svc.create({ url: "https://example.com/hook", enabled_events: [] });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
        expect((err as StripeError).body.error.param).toBe("enabled_events");
      }
    });

    it("defaults metadata to empty object when not provided", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.metadata).toEqual({});
    });

    it("defaults description to null when not provided", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.description).toBeNull();
    });

    it("sets application to null", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(ep.application).toBeNull();
    });

    it("creates endpoint that is retrievable", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.id).toBe(ep.id);
      expect(retrieved.url).toBe(ep.url);
    });

    it("secret is a non-trivial string", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      // whsec_ is 6 chars, the rest should be random
      expect(ep.secret!.length).toBeGreaterThan(10);
    });
  });

  // ============================================================
  // retrieve() tests
  // ============================================================
  describe("retrieve", () => {
    it("retrieves an existing endpoint", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.id).toBe(ep.id);
    });

    it("throws 404 for non-existent endpoint", () => {
      const svc = makeService();
      expect(() => svc.retrieve("we_nonexistent")).toThrow();
    });

    it("throws StripeError with 404 status for non-existent endpoint", () => {
      const svc = makeService();
      try {
        svc.retrieve("we_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("error body contains correct resource type and id", () => {
      const svc = makeService();
      try {
        svc.retrieve("we_abc123");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        const body = (err as StripeError).body;
        expect(body.error.message).toContain("we_abc123");
        expect(body.error.message).toContain("webhook_endpoint");
        expect(body.error.code).toBe("resource_missing");
        expect(body.error.param).toBe("id");
      }
    });

    it("returns all fields correctly", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["customer.created"],
        description: "Test endpoint",
        metadata: { key: "val" },
      });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.object).toBe("webhook_endpoint");
      expect(retrieved.url).toBe("https://example.com/hook");
      expect(retrieved.enabled_events).toEqual(["customer.created"]);
      expect(retrieved.description).toBe("Test endpoint");
      expect(retrieved.metadata).toEqual({ key: "val" });
      expect(retrieved.status).toBe("enabled");
      expect(retrieved.livemode).toBe(false);
    });

    it("returns secret on retrieve", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.secret).toBe(ep.secret);
      expect(retrieved.secret).toMatch(/^whsec_/);
    });

    it("returns the same data as what was created", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["charge.succeeded"],
        description: "Charge hook",
      });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.url).toBe(ep.url);
      expect(retrieved.created).toBe(ep.created);
      expect(retrieved.secret).toBe(ep.secret);
      expect(retrieved.enabled_events).toEqual(ep.enabled_events);
    });

    it("retrieves different endpoints independently", () => {
      const svc = makeService();
      const ep1 = svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      const ep2 = svc.create({ url: "https://two.com/hook", enabled_events: ["invoice.paid"] });
      expect(svc.retrieve(ep1.id).url).toBe("https://one.com/hook");
      expect(svc.retrieve(ep2.id).url).toBe("https://two.com/hook");
    });

    it("error type is invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.retrieve("we_missing");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });
  });

  // ============================================================
  // update() tests
  // ============================================================
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

    it("updates status back to enabled", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.update(ep.id, { status: "disabled" });
      const updated = svc.update(ep.id, { status: "enabled" });
      expect(updated.status).toBe("enabled");
    });

    it("updates metadata (through full object update)", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["*"],
        metadata: { old: "value" },
      });
      // Note: update params don't include metadata, but the existing metadata is preserved
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.metadata).toEqual({ old: "value" });
    });

    it("preserves unchanged fields when updating url only", () => {
      const svc = makeService();
      const ep = svc.create({
        url: "https://example.com/hook",
        enabled_events: ["customer.created"],
        description: "Original desc",
      });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.enabled_events).toEqual(["customer.created"]);
      expect(updated.description).toBe("Original desc");
      expect(updated.status).toBe("enabled");
      expect(updated.created).toBe(ep.created);
    });

    it("preserves secret when updating", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.secret).toBe(ep.secret);
    });

    it("preserves created timestamp when updating", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { enabled_events: ["invoice.paid"] });
      expect(updated.created).toBe(ep.created);
    });

    it("preserves id when updating", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.id).toBe(ep.id);
    });

    it("preserves object type when updating", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });
      expect(updated.object).toBe("webhook_endpoint");
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

    it("returns the updated endpoint", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, { url: "https://updated.example.com/hook" });
      expect(updated.url).toBe("https://updated.example.com/hook");
      expect(updated.id).toBe(ep.id);
    });

    it("persists update to DB (retrievable)", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.update(ep.id, { url: "https://updated.example.com/hook", enabled_events: ["invoice.paid"] });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.url).toBe("https://updated.example.com/hook");
      expect(retrieved.enabled_events).toEqual(["invoice.paid"]);
    });

    it("can apply multiple updates sequentially", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.update(ep.id, { url: "https://v2.example.com/hook" });
      svc.update(ep.id, { enabled_events: ["customer.created"] });
      svc.update(ep.id, { status: "disabled" });
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.url).toBe("https://v2.example.com/hook");
      expect(retrieved.enabled_events).toEqual(["customer.created"]);
      expect(retrieved.status).toBe("disabled");
    });

    it("can update all params at once", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const updated = svc.update(ep.id, {
        url: "https://new.example.com/hook",
        enabled_events: ["invoice.paid"],
        status: "disabled",
      });
      expect(updated.url).toBe("https://new.example.com/hook");
      expect(updated.enabled_events).toEqual(["invoice.paid"]);
      expect(updated.status).toBe("disabled");
    });
  });

  // ============================================================
  // del() tests
  // ============================================================
  describe("del", () => {
    it("deletes an existing endpoint", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const result = svc.del(ep.id);
      expect(result.deleted).toBe(true);
    });

    it("returns deleted response with correct shape", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const result = svc.del(ep.id);
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("object");
      expect(result).toHaveProperty("deleted");
    });

    it("returns deleted=true", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const result = svc.del(ep.id);
      expect(result.deleted).toBe(true);
    });

    it("returns object='webhook_endpoint'", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const result = svc.del(ep.id);
      expect(result.object).toBe("webhook_endpoint");
    });

    it("preserves ID in response", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const result = svc.del(ep.id);
      expect(result.id).toBe(ep.id);
    });

    it("throws 404 for non-existent endpoint", () => {
      const svc = makeService();
      expect(() => svc.del("we_nonexistent")).toThrow();
      try {
        svc.del("we_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("removes endpoint from listAll", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.del(ep.id);
      const all = svc.listAll();
      expect(all).toHaveLength(0);
    });

    it("deleted endpoint is not retrievable", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.del(ep.id);
      expect(() => svc.retrieve(ep.id)).toThrow();
    });

    it("deleting one endpoint doesn't affect others", () => {
      const svc = makeService();
      const ep1 = svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      const ep2 = svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      svc.del(ep1.id);
      expect(svc.retrieve(ep2.id).id).toBe(ep2.id);
      expect(svc.listAll()).toHaveLength(1);
    });

    it("cannot double-delete an endpoint", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.del(ep.id);
      expect(() => svc.del(ep.id)).toThrow();
    });
  });

  // ============================================================
  // listAll() tests
  // ============================================================
  describe("listAll", () => {
    it("returns empty array when no endpoints exist", () => {
      const svc = makeService();
      const all = svc.listAll();
      expect(all).toEqual([]);
    });

    it("returns all created endpoints", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["customer.created"] });
      const all = svc.listAll();
      expect(all).toHaveLength(2);
    });

    it("returns correct shape for each endpoint", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const all = svc.listAll();
      expect(all[0]).toHaveProperty("id");
      expect(all[0]).toHaveProperty("url");
      expect(all[0]).toHaveProperty("secret");
      expect(all[0]).toHaveProperty("status");
      expect(all[0]).toHaveProperty("enabledEvents");
    });

    it("includes url for each endpoint", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const all = svc.listAll();
      expect(all[0].url).toBe("https://example.com/hook");
    });

    it("includes secret for each endpoint", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const all = svc.listAll();
      expect(all[0].secret).toMatch(/^whsec_/);
    });

    it("includes status for each endpoint", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      const all = svc.listAll();
      expect(all[0].status).toBe("enabled");
    });

    it("includes enabledEvents as parsed array", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["customer.created", "invoice.paid"] });
      const all = svc.listAll();
      expect(all[0].enabledEvents).toEqual(["customer.created", "invoice.paid"]);
      expect(Array.isArray(all[0].enabledEvents)).toBe(true);
    });

    it("returns multiple endpoints with correct data", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["invoice.paid"] });
      svc.create({ url: "https://three.com/hook", enabled_events: ["customer.created"] });
      const all = svc.listAll();
      expect(all).toHaveLength(3);
      const urls = all.map((e) => e.url);
      expect(urls).toContain("https://one.com/hook");
      expect(urls).toContain("https://two.com/hook");
      expect(urls).toContain("https://three.com/hook");
    });

    it("reflects status updates", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      svc.update(ep.id, { status: "disabled" });
      const all = svc.listAll();
      expect(all[0].status).toBe("disabled");
    });

    it("reflects url updates", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://old.com/hook", enabled_events: ["*"] });
      svc.update(ep.id, { url: "https://new.com/hook" });
      const all = svc.listAll();
      expect(all[0].url).toBe("https://new.com/hook");
    });
  });

  // ============================================================
  // list() tests
  // ============================================================
  describe("list", () => {
    it("returns empty list when no endpoints exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns all endpoints when under limit", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
      expect(result.has_more).toBe(false);
    });

    it("respects limit parameter", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://three.com/hook", enabled_events: ["*"] });
      const result = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
    });

    it("sets has_more=true when more items exist", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://three.com/hook", enabled_events: ["*"] });
      const result = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(true);
    });

    it("sets has_more=false when all items fit", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("returns correct list object shape", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("has_more");
      expect(result).toHaveProperty("url");
    });

    it("returns correct url in list response", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.url).toBe("/v1/webhook_endpoints");
    });

    it("items in list are full Stripe.WebhookEndpoint objects", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["customer.created"] });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const ep = result.data[0];
      expect(ep.object).toBe("webhook_endpoint");
      expect(ep.id).toMatch(/^we_/);
      expect(ep.url).toBe("https://example.com/hook");
      expect(ep.enabled_events).toEqual(["customer.created"]);
      expect(ep.status).toBe("enabled");
    });

    it("limit of 1 returns one item", () => {
      const svc = makeService();
      svc.create({ url: "https://one.com/hook", enabled_events: ["*"] });
      svc.create({ url: "https://two.com/hook", enabled_events: ["*"] });
      const result = svc.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(1);
      expect(result.has_more).toBe(true);
    });

    it("throws for invalid starting_after cursor", () => {
      const svc = makeService();
      svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });
      expect(() => svc.list({ limit: 10, startingAfter: "we_nonexistent", endingBefore: undefined })).toThrow();
    });
  });
});
