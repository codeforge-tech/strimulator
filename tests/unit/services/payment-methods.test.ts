import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new PaymentMethodService(db);
}

describe("PaymentMethodService", () => {
  describe("create", () => {
    it("creates a payment method with the correct shape", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });

      expect(pm.id).toMatch(/^pm_/);
      expect(pm.object).toBe("payment_method");
      expect(pm.type).toBe("card");
      expect(pm.livemode).toBe(false);
      expect(pm.customer).toBeNull();
    });

    it("sets id with pm_ prefix", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.id).toMatch(/^pm_/);
    });

    it("sets billing_details with null defaults", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.billing_details.address).toBeNull();
      expect(pm.billing_details.email).toBeNull();
      expect(pm.billing_details.name).toBeNull();
      expect(pm.billing_details.phone).toBeNull();
    });

    it("stores metadata", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", metadata: { key: "value" } });
      expect(pm.metadata).toEqual({ key: "value" });
    });

    it("sets created timestamp", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const pm = svc.create({ type: "card" });
      const after = Math.floor(Date.now() / 1000);
      expect(pm.created).toBeGreaterThanOrEqual(before);
      expect(pm.created).toBeLessThanOrEqual(after);
    });

    it("throws for unsupported type", () => {
      const svc = makeService();
      expect(() => svc.create({ type: "sepa_debit" })).toThrow(StripeError);
    });
  });

  describe("magic tokens", () => {
    it("tok_visa → visa last4 4242", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_mastercard → mastercard last4 4444", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect(pm.card?.brand).toBe("mastercard");
      expect(pm.card?.last4).toBe("4444");
    });

    it("tok_amex → amex last4 8431", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect(pm.card?.brand).toBe("amex");
      expect(pm.card?.last4).toBe("8431");
    });

    it("tok_visa_debit → visa last4 5556 funding debit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa_debit" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("5556");
      expect(pm.card?.funding).toBe("debit");
    });

    it("unknown token defaults to tok_visa", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_unknown_xyz" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });

    it("no token defaults to tok_visa", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });
  });

  describe("retrieve", () => {
    it("returns a payment method by ID", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.card?.last4).toBe("4242");
    });

    it("throws 404 for nonexistent ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("pm_nonexistent")).toThrow();
      try {
        svc.retrieve("pm_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });
  });

  describe("attach", () => {
    it("sets customer on payment method", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      const attached = svc.attach(pm.id, "cus_123");
      expect(attached.customer).toBe("cus_123");
    });

    it("persists customer across retrieves", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      svc.attach(pm.id, "cus_abc");
      const retrieved = svc.retrieve(pm.id);
      expect(retrieved.customer).toBe("cus_abc");
    });

    it("throws 404 for nonexistent payment method", () => {
      const svc = makeService();
      expect(() => svc.attach("pm_ghost", "cus_123")).toThrow(StripeError);
    });
  });

  describe("detach", () => {
    it("clears customer from payment method", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      svc.attach(pm.id, "cus_123");
      const detached = svc.detach(pm.id);
      expect(detached.customer).toBeNull();
    });

    it("persists null customer across retrieves", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      svc.attach(pm.id, "cus_abc");
      svc.detach(pm.id);
      const retrieved = svc.retrieve(pm.id);
      expect(retrieved.customer).toBeNull();
    });

    it("throws 404 for nonexistent payment method", () => {
      const svc = makeService();
      expect(() => svc.detach("pm_ghost")).toThrow(StripeError);
    });
  });

  describe("list", () => {
    it("returns empty list when no payment methods exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/payment_methods");
    });

    it("returns all payment methods up to limit", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by customerId", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_111");

      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_111" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(pm1.id);
    });

    it("filters by type", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      // We can only create card types in this impl, but the filter should work
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, type: "card" });
      expect(result.data.length).toBe(1);
    });

    it("paginates with startingAfter", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      const pm3 = svc.create({ type: "card" });

      const page1 = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });
  });
});
