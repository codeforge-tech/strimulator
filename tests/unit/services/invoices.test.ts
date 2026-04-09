import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { InvoiceService } from "../../../src/services/invoices";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return { db, service: new InvoiceService(db) };
}

describe("InvoiceService", () => {
  describe("create", () => {
    it("creates an invoice with correct shape", () => {
      const { service } = makeService();

      const inv = service.create({
        customer: "cus_test123",
        currency: "usd",
        amount_due: 2000,
      });

      expect(inv.id).toMatch(/^in_/);
      expect(inv.object).toBe("invoice");
      expect(inv.customer).toBe("cus_test123");
      expect(inv.currency).toBe("usd");
      expect(inv.amount_due).toBe(2000);
      expect(inv.amount_paid).toBe(0);
      expect(inv.amount_remaining).toBe(2000);
      expect(inv.livemode).toBe(false);
      expect(inv.auto_advance).toBe(true);
      expect(inv.collection_method).toBe("charge_automatically");
      expect(inv.default_payment_method).toBeNull();
      expect(inv.hosted_invoice_url).toBeNull();
      expect(inv.payment_intent).toBeNull();
      expect(inv.number).toBeNull();
      expect(inv.paid).toBe(false);
    });

    it("creates an invoice with status draft", () => {
      const { service } = makeService();

      const inv = service.create({
        customer: "cus_test123",
        currency: "usd",
      });

      expect(inv.status).toBe("draft");
    });

    it("defaults amount_due to 0", () => {
      const { service } = makeService();

      const inv = service.create({
        customer: "cus_test123",
      });

      expect(inv.amount_due).toBe(0);
      expect(inv.amount_remaining).toBe(0);
    });

    it("defaults currency to usd", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test123" });
      expect(inv.currency).toBe("usd");
    });

    it("stores subscription reference", () => {
      const { service } = makeService();

      const inv = service.create({
        customer: "cus_test123",
        subscription: "sub_abc",
        currency: "usd",
        amount_due: 1000,
      });

      expect(inv.subscription).toBe("sub_abc");
    });

    it("stores metadata", () => {
      const { service } = makeService();

      const inv = service.create({
        customer: "cus_test123",
        metadata: { order: "xyz" },
      });

      expect(inv.metadata).toEqual({ order: "xyz" });
    });

    it("has correct lines shape", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test" });
      expect(inv.lines.object).toBe("list");
      expect(inv.lines.data).toEqual([]);
      expect(inv.lines.has_more).toBe(false);
    });

    it("throws 400 when customer is missing", () => {
      const { service } = makeService();

      expect(() => service.create({ customer: "" })).toThrow(StripeError);

      try {
        service.create({ customer: "" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });
  });

  describe("retrieve", () => {
    it("retrieves an invoice by ID", () => {
      const { service } = makeService();

      const created = service.create({ customer: "cus_test", currency: "usd", amount_due: 500 });
      const retrieved = service.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.amount_due).toBe(500);
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();

      expect(() => service.retrieve("in_nonexistent")).toThrow(StripeError);

      try {
        service.retrieve("in_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("finalizeInvoice", () => {
    it("transitions draft → open", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      expect(inv.status).toBe("draft");

      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.status).toBe("open");
      expect(finalized.number).not.toBeNull();
      expect((finalized as any).effective_at).not.toBeNull();
    });

    it("throws 400 when invoice is not in draft state", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      service.finalizeInvoice(inv.id);

      expect(() => service.finalizeInvoice(inv.id)).toThrow(StripeError);

      try {
        service.finalizeInvoice(inv.id);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.finalizeInvoice("in_ghost")).toThrow(StripeError);
    });
  });

  describe("pay", () => {
    it("transitions open → paid", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1500 });
      service.finalizeInvoice(inv.id);

      const paid = service.pay(inv.id);
      expect(paid.status).toBe("paid");
      expect(paid.paid).toBe(true);
      expect(paid.amount_paid).toBe(1500);
      expect(paid.amount_remaining).toBe(0);
      expect(paid.attempt_count).toBe(1);
      expect(paid.attempted).toBe(true);
    });

    it("throws 400 when invoice is not open", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      // draft → cannot pay directly

      expect(() => service.pay(inv.id)).toThrow(StripeError);

      try {
        service.pay(inv.id);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.pay("in_ghost")).toThrow(StripeError);
    });
  });

  describe("voidInvoice", () => {
    it("transitions open → void", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      service.finalizeInvoice(inv.id);

      const voided = service.voidInvoice(inv.id);
      expect(voided.status).toBe("void");
    });

    it("throws 400 when invoice is not open", () => {
      const { service } = makeService();

      const inv = service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });

      expect(() => service.voidInvoice(inv.id)).toThrow(StripeError);

      try {
        service.voidInvoice(inv.id);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.voidInvoice("in_ghost")).toThrow(StripeError);
    });
  });

  describe("list", () => {
    it("returns empty list when no invoices exist", () => {
      const { service } = makeService();

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/invoices");
    });

    it("returns all invoices up to limit", () => {
      const { service } = makeService();

      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      }

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit and sets has_more", () => {
      const { service } = makeService();

      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      }

      const result = service.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by customerId", () => {
      const { service } = makeService();

      service.create({ customer: "cus_aaa", currency: "usd", amount_due: 1000 });
      service.create({ customer: "cus_bbb", currency: "usd", amount_due: 2000 });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_aaa",
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_aaa");
    });

    it("filters by subscriptionId", () => {
      const { service } = makeService();

      service.create({ customer: "cus_test", subscription: "sub_aaa", currency: "usd", amount_due: 1000 });
      service.create({ customer: "cus_test", subscription: "sub_bbb", currency: "usd", amount_due: 2000 });
      service.create({ customer: "cus_test", currency: "usd", amount_due: 500 });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: "sub_aaa",
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].subscription).toBe("sub_aaa");
    });

    it("paginates with startingAfter", () => {
      const { service } = makeService();

      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_test", currency: "usd", amount_due: 1000 });
      }

      const page1 = service.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = service.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });
  });
});
