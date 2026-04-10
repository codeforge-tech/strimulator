import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { InvoiceService } from "../../../src/services/invoices";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return { db, service: new InvoiceService(db) };
}

// Helper to create and finalize an invoice in one step
function createOpenInvoice(
  service: InvoiceService,
  params: { customer?: string; amount_due?: number; currency?: string; subscription?: string; metadata?: Record<string, string>; billing_reason?: string } = {},
) {
  const inv = service.create({
    customer: params.customer ?? "cus_test123",
    amount_due: params.amount_due ?? 1000,
    currency: params.currency ?? "usd",
    subscription: params.subscription,
    metadata: params.metadata,
    billing_reason: params.billing_reason,
  });
  return service.finalizeInvoice(inv.id);
}

// Helper to create, finalize, and pay an invoice in one step
function createPaidInvoice(
  service: InvoiceService,
  params: { customer?: string; amount_due?: number; currency?: string; subscription?: string; metadata?: Record<string, string> } = {},
) {
  const open = createOpenInvoice(service, params);
  return service.pay(open.id);
}

// Helper to create, finalize, and void an invoice in one step
function createVoidedInvoice(
  service: InvoiceService,
  params: { customer?: string; amount_due?: number; currency?: string } = {},
) {
  const open = createOpenInvoice(service, params);
  return service.voidInvoice(open.id);
}

describe("InvoiceService", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // create() tests (~50)
  // ─────────────────────────────────────────────────────────────────────────
  describe("create", () => {
    it("creates an invoice with customer only (minimum params)", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });

      expect(inv).toBeDefined();
      expect(inv.id).toBeTruthy();
      expect(inv.customer).toBe("cus_test123");
    });

    it("creates an invoice with all supported params", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_full",
        currency: "eur",
        amount_due: 5000,
        subscription: "sub_abc",
        metadata: { order_id: "ord_123", plan: "premium" },
        billing_reason: "subscription_create",
      });

      expect(inv.customer).toBe("cus_full");
      expect(inv.currency).toBe("eur");
      expect(inv.amount_due).toBe(5000);
      expect(inv.subscription).toBe("sub_abc");
      expect(inv.metadata).toEqual({ order_id: "ord_123", plan: "premium" });
      expect(inv.billing_reason).toBe("subscription_create");
    });

    it("creates an invoice with metadata", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        metadata: { order: "xyz", team: "billing" },
      });

      expect(inv.metadata).toEqual({ order: "xyz", team: "billing" });
    });

    it("creates an invoice with empty metadata", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        metadata: {},
      });

      expect(inv.metadata).toEqual({});
    });

    it("defaults metadata to empty object when not provided", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.metadata).toEqual({});
    });

    it("creates an invoice with billing_reason", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        billing_reason: "subscription_cycle",
      });

      expect(inv.billing_reason).toBe("subscription_cycle");
    });

    it("defaults billing_reason to null", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.billing_reason).toBeNull();
    });

    it("creates an invoice with subscription link", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        subscription: "sub_abc",
        currency: "usd",
        amount_due: 1000,
      });

      expect(inv.subscription).toBe("sub_abc");
    });

    it("defaults subscription to null when not provided", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.subscription).toBeNull();
    });

    it("defaults status to draft", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        currency: "usd",
      });

      expect(inv.status).toBe("draft");
    });

    it("generates id starting with in_", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.id).toMatch(/^in_/);
    });

    it("generates unique ids for each invoice", () => {
      const { service } = makeService();
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const inv = service.create({ customer: "cus_test123" });
        ids.add(inv.id);
      }
      expect(ids.size).toBe(20);
    });

    it("does not assign an invoice number in draft status", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.number).toBeNull();
    });

    it("defaults amount_due to 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });

      expect(inv.amount_due).toBe(0);
    });

    it("defaults amount_paid to 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });

      expect(inv.amount_paid).toBe(0);
    });

    it("sets amount_remaining to amount_due - amount_paid", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test123",
        amount_due: 2000,
      });

      expect(inv.amount_remaining).toBe(2000);
    });

    it("sets amount_remaining to 0 when amount_due is 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.amount_remaining).toBe(0);
    });

    it("defaults currency to usd", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.currency).toBe("usd");
    });

    it("accepts custom currency", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", currency: "eur" });
      expect(inv.currency).toBe("eur");
    });

    it("accepts gbp currency", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", currency: "gbp" });
      expect(inv.currency).toBe("gbp");
    });

    it("sets customer field correctly", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_abc_xyz" });
      expect(inv.customer).toBe("cus_abc_xyz");
    });

    it("sets created timestamp", () => {
      const { service } = makeService();
      const before = Math.floor(Date.now() / 1000);
      const inv = service.create({ customer: "cus_test123" });
      const after = Math.floor(Date.now() / 1000);

      expect(inv.created).toBeGreaterThanOrEqual(before);
      expect(inv.created).toBeLessThanOrEqual(after);
    });

    it("sets object to invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.object).toBe("invoice");
    });

    it("sets livemode to false", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.livemode).toBe(false);
    });

    it("sets auto_advance to true", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.auto_advance).toBe(true);
    });

    it("sets collection_method to charge_automatically", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.collection_method).toBe("charge_automatically");
    });

    it("sets default_payment_method to null", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.default_payment_method).toBeNull();
    });

    it("sets description to null", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.description).toBeNull();
    });

    it("throws 400 when customer is empty string", () => {
      const { service } = makeService();
      expect(() => service.create({ customer: "" })).toThrow(StripeError);

      try {
        service.create({ customer: "" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws error with correct message when customer is missing", () => {
      const { service } = makeService();

      try {
        service.create({ customer: "" });
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toBe("Missing required param: customer.");
        expect(se.body.error.type).toBe("invalid_request_error");
        expect(se.body.error.param).toBe("customer");
      }
    });

    it("sets hosted_invoice_url to null in draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.hosted_invoice_url).toBeNull();
    });

    it("sets payment_intent to null in draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.payment_intent).toBeNull();
    });

    it("sets subtotal equal to amount_due", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 3000 });
      expect(inv.subtotal).toBe(3000);
    });

    it("sets subtotal to 0 when amount_due is 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.subtotal).toBe(0);
    });

    it("sets total equal to amount_due", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 4500 });
      expect(inv.total).toBe(4500);
    });

    it("sets total to 0 when amount_due is 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.total).toBe(0);
    });

    it("sets paid to false in draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.paid).toBe(false);
    });

    it("sets attempt_count to 0", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.attempt_count).toBe(0);
    });

    it("sets attempted to false", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.attempted).toBe(false);
    });

    it("has correct lines shape with empty data", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });

      expect(inv.lines.object).toBe("list");
      expect(inv.lines.data).toEqual([]);
      expect(inv.lines.has_more).toBe(false);
    });

    it("has lines url containing the invoice id", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });

      expect(inv.lines.url).toBe(`/v1/invoices/${inv.id}/lines`);
    });

    it("sets period_start to created timestamp", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.period_start).toBe(inv.created);
    });

    it("sets period_end to created timestamp", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect(inv.period_end).toBe(inv.created);
    });

    it("sets effective_at to null in draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123" });
      expect((inv as any).effective_at).toBeNull();
    });

    it("creates multiple invoices with unique IDs", () => {
      const { service } = makeService();
      const inv1 = service.create({ customer: "cus_test123" });
      const inv2 = service.create({ customer: "cus_test123" });
      const inv3 = service.create({ customer: "cus_test123" });

      expect(inv1.id).not.toBe(inv2.id);
      expect(inv2.id).not.toBe(inv3.id);
      expect(inv1.id).not.toBe(inv3.id);
    });

    it("creates invoice with large amount_due", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 99999999 });
      expect(inv.amount_due).toBe(99999999);
      expect(inv.amount_remaining).toBe(99999999);
    });

    it("creates invoice with zero amount_due explicitly", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 0 });
      expect(inv.amount_due).toBe(0);
      expect(inv.amount_remaining).toBe(0);
    });

    it("creates invoice with amount_due and correct subtotal and total", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 7777 });
      expect(inv.subtotal).toBe(7777);
      expect(inv.total).toBe(7777);
      expect(inv.amount_due).toBe(7777);
    });

    it("persists invoice to database", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test123", amount_due: 500 });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.id).toBe(inv.id);
      expect(retrieved.customer).toBe("cus_test123");
      expect(retrieved.amount_due).toBe(500);
    });

    it("creates invoices for different customers", () => {
      const { service } = makeService();
      const inv1 = service.create({ customer: "cus_alice" });
      const inv2 = service.create({ customer: "cus_bob" });

      expect(inv1.customer).toBe("cus_alice");
      expect(inv2.customer).toBe("cus_bob");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // retrieve() tests (~20)
  // ─────────────────────────────────────────────────────────────────────────
  describe("retrieve", () => {
    it("retrieves an existing invoice by ID", () => {
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

    it("throws error with correct message for nonexistent invoice", () => {
      const { service } = makeService();

      try {
        service.retrieve("in_doesnotexist");
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toBe("No such invoice: 'in_doesnotexist'");
        expect(se.body.error.code).toBe("resource_missing");
        expect(se.body.error.type).toBe("invalid_request_error");
      }
    });

    it("returns all fields correctly", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_full",
        currency: "eur",
        amount_due: 2500,
        subscription: "sub_xyz",
        metadata: { key: "val" },
      });
      const retrieved = service.retrieve(inv.id);

      expect(retrieved.object).toBe("invoice");
      expect(retrieved.customer).toBe("cus_full");
      expect(retrieved.currency).toBe("eur");
      expect(retrieved.amount_due).toBe(2500);
      expect(retrieved.subscription).toBe("sub_xyz");
      expect(retrieved.metadata).toEqual({ key: "val" });
      expect(retrieved.status).toBe("draft");
      expect(retrieved.livemode).toBe(false);
    });

    it("retrieves invoice after finalize shows open status", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      service.finalizeInvoice(inv.id);
      const retrieved = service.retrieve(inv.id);

      expect(retrieved.status).toBe("open");
    });

    it("retrieves invoice after pay shows paid status", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      service.finalizeInvoice(inv.id);
      service.pay(inv.id);
      const retrieved = service.retrieve(inv.id);

      expect(retrieved.status).toBe("paid");
    });

    it("retrieves invoice after void shows void status", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      service.finalizeInvoice(inv.id);
      service.voidInvoice(inv.id);
      const retrieved = service.retrieve(inv.id);

      expect(retrieved.status).toBe("void");
    });

    it("retrieves the correct invoice among many", () => {
      const { service } = makeService();
      const inv1 = service.create({ customer: "cus_a", amount_due: 100 });
      const inv2 = service.create({ customer: "cus_b", amount_due: 200 });
      const inv3 = service.create({ customer: "cus_c", amount_due: 300 });

      const retrieved = service.retrieve(inv2.id);
      expect(retrieved.id).toBe(inv2.id);
      expect(retrieved.customer).toBe("cus_b");
      expect(retrieved.amount_due).toBe(200);
    });

    it("retrieves invoice preserving metadata", () => {
      const { service } = makeService();
      const inv = service.create({
        customer: "cus_test",
        metadata: { a: "1", b: "2", c: "3" },
      });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.metadata).toEqual({ a: "1", b: "2", c: "3" });
    });

    it("retrieves invoice preserving lines shape", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const retrieved = service.retrieve(inv.id);

      expect(retrieved.lines.object).toBe("list");
      expect(retrieved.lines.data).toEqual([]);
      expect(retrieved.lines.has_more).toBe(false);
      expect(retrieved.lines.url).toBe(`/v1/invoices/${inv.id}/lines`);
    });

    it("retrieves invoice preserving subscription", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", subscription: "sub_link" });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.subscription).toBe("sub_link");
    });

    it("retrieves invoice preserving created timestamp", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.created).toBe(inv.created);
    });

    it("retrieves invoice preserving currency", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", currency: "jpy" });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.currency).toBe("jpy");
    });

    it("throws StripeError instance on not found", () => {
      const { service } = makeService();

      try {
        service.retrieve("in_missing");
        expect(true).toBe(false); // should never reach
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("retrieves finalized invoice preserving invoice number", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 100 });
      const finalized = service.finalizeInvoice(inv.id);
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.number).toBe(finalized.number);
    });

    it("retrieves paid invoice preserving amount_paid", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 3000 });
      service.finalizeInvoice(inv.id);
      service.pay(inv.id);
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.amount_paid).toBe(3000);
      expect(retrieved.amount_remaining).toBe(0);
    });

    it("returns different objects for different retrieves (not shared references)", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const r1 = service.retrieve(inv.id);
      const r2 = service.retrieve(inv.id);
      expect(r1).toEqual(r2);
      expect(r1).not.toBe(r2); // different object references (parsed from JSON each time)
    });

    it("retrieves invoice with billing_reason preserved", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", billing_reason: "manual" });
      const retrieved = service.retrieve(inv.id);
      expect(retrieved.billing_reason).toBe("manual");
    });

    it("retrieves invoice preserving effective_at as null in draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const retrieved = service.retrieve(inv.id);
      expect((retrieved as any).effective_at).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // finalizeInvoice() tests (~40)
  // ─────────────────────────────────────────────────────────────────────────
  describe("finalizeInvoice", () => {
    it("transitions draft to open", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.status).toBe("open");
    });

    it("sets status to open", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.status).toBe("open");
    });

    it("assigns an invoice number", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.number).not.toBeNull();
      expect(finalized.number).toBeTruthy();
    });

    it("assigns invoice number starting with INV-", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.number).toMatch(/^INV-/);
    });

    it("assigns invoice number with zero-padded format", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.number).toMatch(/^INV-\d{6}$/);
    });

    it("assigns sequential invoice numbers", () => {
      const { service } = makeService();
      const inv1 = service.create({ customer: "cus_test" });
      const inv2 = service.create({ customer: "cus_test" });
      const f1 = service.finalizeInvoice(inv1.id);
      const f2 = service.finalizeInvoice(inv2.id);

      // Both should have INV- prefix and the second should have a higher number
      const num1 = parseInt(f1.number!.replace("INV-", ""), 10);
      const num2 = parseInt(f2.number!.replace("INV-", ""), 10);
      expect(num2).toBeGreaterThan(num1);
    });

    it("assigns unique invoice numbers across multiple invoices", () => {
      const { service } = makeService();
      const numbers = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const inv = service.create({ customer: "cus_test" });
        const f = service.finalizeInvoice(inv.id);
        numbers.add(f.number!);
      }
      expect(numbers.size).toBe(10);
    });

    it("sets effective_at on finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const before = Math.floor(Date.now() / 1000);
      const finalized = service.finalizeInvoice(inv.id);
      const after = Math.floor(Date.now() / 1000);

      expect((finalized as any).effective_at).not.toBeNull();
      expect((finalized as any).effective_at).toBeGreaterThanOrEqual(before);
      expect((finalized as any).effective_at).toBeLessThanOrEqual(after);
    });

    it("throws error when invoice is already open", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      service.finalizeInvoice(inv.id);

      expect(() => service.finalizeInvoice(inv.id)).toThrow(StripeError);
    });

    it("throws 400 when invoice is already open", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      service.finalizeInvoice(inv.id);

      try {
        service.finalizeInvoice(inv.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws state transition error with correct message when already open", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      service.finalizeInvoice(inv.id);

      try {
        service.finalizeInvoice(inv.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toContain("cannot finalize");
        expect(se.body.error.message).toContain("open");
        expect(se.body.error.code).toBe("invoice_unexpected_state");
      }
    });

    it("throws error when invoice is paid", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.finalizeInvoice(paid.id)).toThrow(StripeError);

      try {
        service.finalizeInvoice(paid.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("paid");
      }
    });

    it("throws error when invoice is voided", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.finalizeInvoice(voided.id)).toThrow(StripeError);

      try {
        service.finalizeInvoice(voided.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("void");
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.finalizeInvoice("in_ghost")).toThrow(StripeError);

      try {
        service.finalizeInvoice("in_ghost");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws correct 404 error message", () => {
      const { service } = makeService();

      try {
        service.finalizeInvoice("in_nope");
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toBe("No such invoice: 'in_nope'");
      }
    });

    it("preserves amount_due after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 5000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.amount_due).toBe(5000);
    });

    it("preserves amount_paid as 0 after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 5000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.amount_paid).toBe(0);
    });

    it("preserves amount_remaining after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 3000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.amount_remaining).toBe(3000);
    });

    it("preserves customer after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_keep_me" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.customer).toBe("cus_keep_me");
    });

    it("preserves metadata after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", metadata: { key: "val" } });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.metadata).toEqual({ key: "val" });
    });

    it("preserves currency after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", currency: "eur" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.currency).toBe("eur");
    });

    it("preserves subscription after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", subscription: "sub_keep" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.subscription).toBe("sub_keep");
    });

    it("preserves created timestamp after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.created).toBe(inv.created);
    });

    it("preserves object field after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.object).toBe("invoice");
    });

    it("preserves id after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.id).toBe(inv.id);
    });

    it("preserves livemode as false after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.livemode).toBe(false);
    });

    it("preserves paid as false after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.paid).toBe(false);
    });

    it("preserves subtotal after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 4000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.subtotal).toBe(4000);
    });

    it("preserves total after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 4000 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.total).toBe(4000);
    });

    it("preserves period_start after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.period_start).toBe(inv.period_start);
    });

    it("preserves period_end after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.period_end).toBe(inv.period_end);
    });

    it("preserves billing_reason after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", billing_reason: "subscription_cycle" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.billing_reason).toBe("subscription_cycle");
    });

    it("preserves lines shape after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.lines.object).toBe("list");
      expect(finalized.lines.data).toEqual([]);
    });

    it("returns the updated invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const result = service.finalizeInvoice(inv.id);

      expect(result.id).toBe(inv.id);
      expect(result.status).toBe("open");
    });

    it("persists finalized state to database", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      service.finalizeInvoice(inv.id);

      const retrieved = service.retrieve(inv.id);
      expect(retrieved.status).toBe("open");
      expect(retrieved.number).not.toBeNull();
    });

    it("can finalize multiple different invoices", () => {
      const { service } = makeService();
      const inv1 = service.create({ customer: "cus_a" });
      const inv2 = service.create({ customer: "cus_b" });
      const inv3 = service.create({ customer: "cus_c" });

      const f1 = service.finalizeInvoice(inv1.id);
      const f2 = service.finalizeInvoice(inv2.id);
      const f3 = service.finalizeInvoice(inv3.id);

      expect(f1.status).toBe("open");
      expect(f2.status).toBe("open");
      expect(f3.status).toBe("open");
      expect(f1.number).not.toBe(f2.number);
      expect(f2.number).not.toBe(f3.number);
    });

    it("preserves attempt_count after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.attempt_count).toBe(0);
    });

    it("preserves attempted as false after finalize", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.attempted).toBe(false);
    });

    it("finalize with zero amount invoice works", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 0 });
      const finalized = service.finalizeInvoice(inv.id);
      expect(finalized.status).toBe("open");
      expect(finalized.amount_due).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // pay() tests (~40)
  // ─────────────────────────────────────────────────────────────────────────
  describe("pay", () => {
    it("transitions open to paid", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 1500 });
      const paid = service.pay(open.id);
      expect(paid.status).toBe("paid");
    });

    it("sets status to paid", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.status).toBe("paid");
    });

    it("sets paid to true", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.paid).toBe(true);
    });

    it("sets amount_paid to amount_due", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 2500 });
      const paid = service.pay(open.id);
      expect(paid.amount_paid).toBe(2500);
    });

    it("sets amount_remaining to 0", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 3000 });
      const paid = service.pay(open.id);
      expect(paid.amount_remaining).toBe(0);
    });

    it("increments attempt_count by 1", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      expect(open.attempt_count).toBe(0);
      const paid = service.pay(open.id);
      expect(paid.attempt_count).toBe(1);
    });

    it("sets attempted to true", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.attempted).toBe(true);
    });

    it("throws error when paying a draft invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });

      expect(() => service.pay(inv.id)).toThrow(StripeError);
    });

    it("throws 400 when paying a draft invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });

      try {
        service.pay(inv.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws correct state transition message for draft invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });

      try {
        service.pay(inv.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toContain("cannot pay");
        expect(se.body.error.message).toContain("draft");
        expect(se.body.error.code).toBe("invoice_unexpected_state");
      }
    });

    it("throws error when paying an already paid invoice", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.pay(paid.id)).toThrow(StripeError);
    });

    it("throws 400 when paying an already paid invoice", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      try {
        service.pay(paid.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("paid");
      }
    });

    it("throws error when paying a voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.pay(voided.id)).toThrow(StripeError);
    });

    it("throws 400 when paying a voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      try {
        service.pay(voided.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("void");
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.pay("in_ghost")).toThrow(StripeError);

      try {
        service.pay("in_ghost");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws correct error message for nonexistent invoice", () => {
      const { service } = makeService();

      try {
        service.pay("in_missing_pay");
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toBe("No such invoice: 'in_missing_pay'");
      }
    });

    it("preserves metadata after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { metadata: { team: "billing" } });
      const paid = service.pay(open.id);
      expect(paid.metadata).toEqual({ team: "billing" });
    });

    it("preserves customer after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { customer: "cus_payer" });
      const paid = service.pay(open.id);
      expect(paid.customer).toBe("cus_payer");
    });

    it("preserves currency after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { currency: "gbp" });
      const paid = service.pay(open.id);
      expect(paid.currency).toBe("gbp");
    });

    it("preserves subscription after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { subscription: "sub_pay" });
      const paid = service.pay(open.id);
      expect(paid.subscription).toBe("sub_pay");
    });

    it("preserves invoice number after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.number).toBe(open.number);
      expect(paid.number).not.toBeNull();
    });

    it("preserves id after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.id).toBe(open.id);
    });

    it("preserves created timestamp after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.created).toBe(open.created);
    });

    it("preserves object field after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.object).toBe("invoice");
    });

    it("preserves livemode as false after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.livemode).toBe(false);
    });

    it("preserves effective_at after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect((paid as any).effective_at).toBe((open as any).effective_at);
    });

    it("preserves period_start after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.period_start).toBe(open.period_start);
    });

    it("preserves period_end after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.period_end).toBe(open.period_end);
    });

    it("preserves billing_reason after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { billing_reason: "subscription_create" });
      const paid = service.pay(open.id);
      expect(paid.billing_reason).toBe("subscription_create");
    });

    it("preserves subtotal after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 6000 });
      const paid = service.pay(open.id);
      expect(paid.subtotal).toBe(6000);
    });

    it("preserves total after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 6000 });
      const paid = service.pay(open.id);
      expect(paid.total).toBe(6000);
    });

    it("returns the updated invoice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const result = service.pay(open.id);
      expect(result.id).toBe(open.id);
      expect(result.status).toBe("paid");
    });

    it("persists paid state to database", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 2000 });
      service.pay(open.id);

      const retrieved = service.retrieve(open.id);
      expect(retrieved.status).toBe("paid");
      expect(retrieved.amount_paid).toBe(2000);
      expect(retrieved.amount_remaining).toBe(0);
    });

    it("pays a zero-amount invoice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 0 });
      const paid = service.pay(open.id);

      expect(paid.status).toBe("paid");
      expect(paid.amount_paid).toBe(0);
      expect(paid.amount_remaining).toBe(0);
    });

    it("pays a large-amount invoice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 10000000 });
      const paid = service.pay(open.id);

      expect(paid.amount_paid).toBe(10000000);
      expect(paid.amount_remaining).toBe(0);
    });

    it("can pay multiple different invoices", () => {
      const { service } = makeService();
      const open1 = createOpenInvoice(service, { customer: "cus_a", amount_due: 100 });
      const open2 = createOpenInvoice(service, { customer: "cus_b", amount_due: 200 });

      const paid1 = service.pay(open1.id);
      const paid2 = service.pay(open2.id);

      expect(paid1.status).toBe("paid");
      expect(paid2.status).toBe("paid");
      expect(paid1.amount_paid).toBe(100);
      expect(paid2.amount_paid).toBe(200);
    });

    it("cannot pay the same invoice twice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      service.pay(open.id);

      expect(() => service.pay(open.id)).toThrow(StripeError);
    });

    it("preserves lines shape after pay", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const paid = service.pay(open.id);
      expect(paid.lines.object).toBe("list");
      expect(paid.lines.data).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // voidInvoice() tests (~30)
  // ─────────────────────────────────────────────────────────────────────────
  describe("voidInvoice", () => {
    it("transitions open to void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 1000 });
      const voided = service.voidInvoice(open.id);
      expect(voided.status).toBe("void");
    });

    it("sets status to void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.status).toBe("void");
    });

    it("throws error when voiding a draft invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });

      expect(() => service.voidInvoice(inv.id)).toThrow(StripeError);
    });

    it("throws 400 when voiding a draft invoice", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });

      try {
        service.voidInvoice(inv.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws state transition error with correct message for draft", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test" });

      try {
        service.voidInvoice(inv.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toContain("cannot void");
        expect(se.body.error.message).toContain("draft");
        expect(se.body.error.code).toBe("invoice_unexpected_state");
      }
    });

    it("throws error when voiding a paid invoice", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.voidInvoice(paid.id)).toThrow(StripeError);
    });

    it("throws 400 when voiding a paid invoice", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      try {
        service.voidInvoice(paid.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("paid");
      }
    });

    it("throws error when voiding an already voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.voidInvoice(voided.id)).toThrow(StripeError);
    });

    it("throws 400 when voiding an already voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      try {
        service.voidInvoice(voided.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("void");
      }
    });

    it("throws 404 for nonexistent invoice", () => {
      const { service } = makeService();
      expect(() => service.voidInvoice("in_ghost")).toThrow(StripeError);

      try {
        service.voidInvoice("in_ghost");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws correct error message for nonexistent invoice", () => {
      const { service } = makeService();

      try {
        service.voidInvoice("in_void_missing");
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.message).toBe("No such invoice: 'in_void_missing'");
      }
    });

    it("preserves customer after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { customer: "cus_void_test" });
      const voided = service.voidInvoice(open.id);
      expect(voided.customer).toBe("cus_void_test");
    });

    it("preserves amount_due after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 4500 });
      const voided = service.voidInvoice(open.id);
      expect(voided.amount_due).toBe(4500);
    });

    it("preserves amount_paid as 0 after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 2000 });
      const voided = service.voidInvoice(open.id);
      expect(voided.amount_paid).toBe(0);
    });

    it("preserves amount_remaining after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { amount_due: 2000 });
      const voided = service.voidInvoice(open.id);
      expect(voided.amount_remaining).toBe(2000);
    });

    it("preserves metadata after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { metadata: { reason: "cancelled" } });
      const voided = service.voidInvoice(open.id);
      expect(voided.metadata).toEqual({ reason: "cancelled" });
    });

    it("preserves invoice number after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.number).toBe(open.number);
    });

    it("preserves currency after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { currency: "cad" });
      const voided = service.voidInvoice(open.id);
      expect(voided.currency).toBe("cad");
    });

    it("preserves subscription after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { subscription: "sub_void" });
      const voided = service.voidInvoice(open.id);
      expect(voided.subscription).toBe("sub_void");
    });

    it("preserves created timestamp after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.created).toBe(open.created);
    });

    it("preserves id after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.id).toBe(open.id);
    });

    it("preserves object field after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.object).toBe("invoice");
    });

    it("sets paid to false after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect(voided.paid).toBe(false);
    });

    it("preserves effective_at after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const voided = service.voidInvoice(open.id);
      expect((voided as any).effective_at).toBe((open as any).effective_at);
    });

    it("preserves billing_reason after void", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service, { billing_reason: "subscription_update" });
      const voided = service.voidInvoice(open.id);
      expect(voided.billing_reason).toBe("subscription_update");
    });

    it("returns the updated invoice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      const result = service.voidInvoice(open.id);
      expect(result.id).toBe(open.id);
      expect(result.status).toBe("void");
    });

    it("persists voided state to database", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      service.voidInvoice(open.id);

      const retrieved = service.retrieve(open.id);
      expect(retrieved.status).toBe("void");
    });

    it("can void multiple different invoices", () => {
      const { service } = makeService();
      const open1 = createOpenInvoice(service, { customer: "cus_a" });
      const open2 = createOpenInvoice(service, { customer: "cus_b" });

      const v1 = service.voidInvoice(open1.id);
      const v2 = service.voidInvoice(open2.id);

      expect(v1.status).toBe("void");
      expect(v2.status).toBe("void");
    });

    it("cannot void the same invoice twice", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);
      service.voidInvoice(open.id);

      expect(() => service.voidInvoice(open.id)).toThrow(StripeError);
    });

    it("cannot pay a voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.pay(voided.id)).toThrow(StripeError);
    });

    it("cannot finalize a voided invoice", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.finalizeInvoice(voided.id)).toThrow(StripeError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // list() tests (~30)
  // ─────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("returns empty list when no invoices exist", () => {
      const { service } = makeService();
      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns list url as /v1/invoices", () => {
      const { service } = makeService();
      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.url).toBe("/v1/invoices");
    });

    it("returns all invoices up to limit", () => {
      const { service } = makeService();
      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_test", amount_due: 1000 });
      }

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("returns exactly limit items when more exist", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_test", amount_due: 1000 });
      }

      const result = service.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
    });

    it("sets has_more to true when more items exist", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_test", amount_due: 1000 });
      }

      const result = service.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(true);
    });

    it("sets has_more to false when all items fit", () => {
      const { service } = makeService();
      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_test", amount_due: 1000 });
      }

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("sets has_more to false when exact limit items exist", () => {
      const { service } = makeService();
      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_test", amount_due: 1000 });
      }

      const result = service.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
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

    it("pagination collects items across pages", () => {
      const { service } = makeService();
      // Create a single invoice and verify pagination works for single-page case
      service.create({ customer: "cus_test", amount_due: 1000 });

      const page1 = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(1);
      expect(page1.has_more).toBe(false);
    });

    it("throws 404 when startingAfter references nonexistent invoice", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test" });

      expect(() =>
        service.list({ limit: 10, startingAfter: "in_nonexistent", endingBefore: undefined }),
      ).toThrow(StripeError);
    });

    it("filters by customerId", () => {
      const { service } = makeService();
      service.create({ customer: "cus_aaa", amount_due: 1000 });
      service.create({ customer: "cus_bbb", amount_due: 2000 });
      service.create({ customer: "cus_aaa", amount_due: 3000 });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_aaa",
      });
      expect(result.data.length).toBe(2);
      result.data.forEach(inv => expect(inv.customer).toBe("cus_aaa"));
    });

    it("filters by customerId returns empty when no match", () => {
      const { service } = makeService();
      service.create({ customer: "cus_aaa", amount_due: 1000 });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_zzz",
      });
      expect(result.data.length).toBe(0);
    });

    it("filters by subscriptionId", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test", subscription: "sub_aaa", amount_due: 1000 });
      service.create({ customer: "cus_test", subscription: "sub_bbb", amount_due: 2000 });
      service.create({ customer: "cus_test", amount_due: 500 });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: "sub_aaa",
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].subscription).toBe("sub_aaa");
    });

    it("filters by subscriptionId returns empty when no match", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test", subscription: "sub_aaa" });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        subscriptionId: "sub_zzz",
      });
      expect(result.data.length).toBe(0);
    });

    it("combines customerId and subscriptionId filters", () => {
      const { service } = makeService();
      service.create({ customer: "cus_aaa", subscription: "sub_1" });
      service.create({ customer: "cus_aaa", subscription: "sub_2" });
      service.create({ customer: "cus_bbb", subscription: "sub_1" });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_aaa",
        subscriptionId: "sub_1",
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_aaa");
      expect(result.data[0].subscription).toBe("sub_1");
    });

    it("returns invoices with correct object type in list", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test" });
      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data[0].object).toBe("invoice");
    });

    it("limit of 1 returns single item", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" });
      service.create({ customer: "cus_b" });

      const result = service.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("list after finalize shows open status", () => {
      const { service } = makeService();
      const inv = service.create({ customer: "cus_test", amount_due: 1000 });
      service.finalizeInvoice(inv.id);

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.find(d => d.id === inv.id)?.status).toBe("open");
    });

    it("list after pay shows paid status", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.find(d => d.id === paid.id)?.status).toBe("paid");
    });

    it("list after void shows void status", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.find(d => d.id === voided.id)?.status).toBe("void");
    });

    it("list returns invoices from all statuses", () => {
      const { service } = makeService();
      service.create({ customer: "cus_draft" }); // draft
      createOpenInvoice(service, { customer: "cus_open" }); // open
      createPaidInvoice(service, { customer: "cus_paid" }); // paid
      createVoidedInvoice(service, { customer: "cus_void" }); // void

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const statuses = result.data.map(d => d.status);
      expect(statuses).toContain("draft");
      expect(statuses).toContain("open");
      expect(statuses).toContain("paid");
      expect(statuses).toContain("void");
    });

    it("list with customerId and limit and has_more", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_target", amount_due: 100 * i });
      }
      service.create({ customer: "cus_other", amount_due: 999 });

      const result = service.list({
        limit: 3,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_target",
      });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
      result.data.forEach(inv => expect(inv.customer).toBe("cus_target"));
    });

    it("list returns proper structure", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test" });

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result).toHaveProperty("object", "list");
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("has_more");
      expect(result).toHaveProperty("url");
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("list pagination with customerId filter", () => {
      const { service } = makeService();
      for (let i = 0; i < 4; i++) {
        service.create({ customer: "cus_target" });
      }
      service.create({ customer: "cus_other" });

      const page1 = service.list({
        limit: 2,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_target",
      });
      expect(page1.data.length).toBe(2);
      expect(page1.has_more).toBe(true);
    });

    it("list with no matching customerId and subscriptionId", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a", subscription: "sub_1" });

      const result = service.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_b",
        subscriptionId: "sub_2",
      });
      expect(result.data.length).toBe(0);
    });

    it("returns data as array of Stripe.Invoice objects", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test", amount_due: 1234 });

      const result = service.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const inv = result.data[0];
      expect(inv.id).toMatch(/^in_/);
      expect(inv.object).toBe("invoice");
      expect(inv.amount_due).toBe(1234);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // search() tests (~25)
  // ─────────────────────────────────────────────────────────────────────────
  describe("search", () => {
    it("returns search_result object", () => {
      const { service } = makeService();
      const result = service.search('status:"draft"');

      expect(result.object).toBe("search_result");
    });

    it("returns url as /v1/invoices/search", () => {
      const { service } = makeService();
      const result = service.search('status:"draft"');
      expect(result.url).toBe("/v1/invoices/search");
    });

    it("returns next_page as null", () => {
      const { service } = makeService();
      const result = service.search('status:"draft"');
      expect(result.next_page).toBeNull();
    });

    it("searches by status draft", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" }); // draft
      createOpenInvoice(service, { customer: "cus_b" }); // open

      const result = service.search('status:"draft"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("draft");
    });

    it("searches by status open", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" }); // draft
      createOpenInvoice(service, { customer: "cus_b" }); // open

      const result = service.search('status:"open"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("open");
    });

    it("searches by status paid", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" }); // draft
      createPaidInvoice(service, { customer: "cus_b" }); // paid

      const result = service.search('status:"paid"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("paid");
    });

    it("searches by status void", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" }); // draft
      createVoidedInvoice(service, { customer: "cus_b" }); // void

      const result = service.search('status:"void"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("void");
    });

    it("searches by customer", () => {
      const { service } = makeService();
      service.create({ customer: "cus_alice" });
      service.create({ customer: "cus_bob" });

      const result = service.search('customer:"cus_alice"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_alice");
    });

    it("searches by subscription", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a", subscription: "sub_target" });
      service.create({ customer: "cus_b", subscription: "sub_other" });
      service.create({ customer: "cus_c" });

      const result = service.search('subscription:"sub_target"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].subscription).toBe("sub_target");
    });

    it("searches by metadata key-value", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a", metadata: { env: "production" } });
      service.create({ customer: "cus_b", metadata: { env: "staging" } });
      service.create({ customer: "cus_c" });

      const result = service.search('metadata["env"]:"production"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].metadata).toEqual({ env: "production" });
    });

    it("searches with multiple metadata keys", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a", metadata: { env: "prod", team: "billing" } });
      service.create({ customer: "cus_b", metadata: { env: "prod", team: "support" } });

      const result = service.search('metadata["env"]:"prod" metadata["team"]:"billing"');
      expect(result.data.length).toBe(1);
    });

    it("search returns empty results when no match", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" });

      const result = service.search('status:"nonexistent"');
      expect(result.data.length).toBe(0);
      expect(result.total_count).toBe(0);
    });

    it("search returns empty for empty db", () => {
      const { service } = makeService();
      const result = service.search('status:"draft"');
      expect(result.data.length).toBe(0);
    });

    it("search respects limit", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_test" });
      }

      const result = service.search('customer:"cus_test"', 3);
      expect(result.data.length).toBe(3);
    });

    it("search returns total_count for all matches", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_counted" });
      }

      const result = service.search('customer:"cus_counted"', 3);
      expect(result.total_count).toBe(5);
    });

    it("search sets has_more when total exceeds limit", () => {
      const { service } = makeService();
      for (let i = 0; i < 5; i++) {
        service.create({ customer: "cus_more" });
      }

      const result = service.search('customer:"cus_more"', 3);
      expect(result.has_more).toBe(true);
    });

    it("search sets has_more to false when all fit", () => {
      const { service } = makeService();
      for (let i = 0; i < 3; i++) {
        service.create({ customer: "cus_fits" });
      }

      const result = service.search('customer:"cus_fits"', 10);
      expect(result.has_more).toBe(false);
    });

    it("search result data contains valid invoice objects", () => {
      const { service } = makeService();
      service.create({ customer: "cus_test", amount_due: 999 });

      const result = service.search('customer:"cus_test"');
      expect(result.data[0].object).toBe("invoice");
      expect(result.data[0].id).toMatch(/^in_/);
      expect(result.data[0].amount_due).toBe(999);
    });

    it("search by currency", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a", currency: "usd" });
      service.create({ customer: "cus_b", currency: "eur" });

      const result = service.search('currency:"eur"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].currency).toBe("eur");
    });

    it("search with AND keyword", () => {
      const { service } = makeService();
      service.create({ customer: "cus_target", currency: "usd" });
      service.create({ customer: "cus_target", currency: "eur" });
      service.create({ customer: "cus_other", currency: "usd" });

      const result = service.search('customer:"cus_target" AND currency:"usd"');
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_target");
      expect(result.data[0].currency).toBe("usd");
    });

    it("search with implicit AND (space separated)", () => {
      const { service } = makeService();
      service.create({ customer: "cus_target", currency: "usd" });
      service.create({ customer: "cus_target", currency: "eur" });

      const result = service.search('customer:"cus_target" currency:"usd"');
      expect(result.data.length).toBe(1);
    });

    it("search defaults limit to 10", () => {
      const { service } = makeService();
      for (let i = 0; i < 15; i++) {
        service.create({ customer: "cus_bulk" });
      }

      const result = service.search('customer:"cus_bulk"');
      expect(result.data.length).toBe(10);
      expect(result.has_more).toBe(true);
      expect(result.total_count).toBe(15);
    });

    it("search by created timestamp with gt", () => {
      const { service } = makeService();
      service.create({ customer: "cus_a" });

      const result = service.search("created>0");
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("search returns correct structure shape", () => {
      const { service } = makeService();
      const result = service.search('status:"draft"');

      expect(result).toHaveProperty("object", "search_result");
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("has_more");
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("total_count");
      expect(result).toHaveProperty("next_page");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // State machine comprehensive tests (~15)
  // ─────────────────────────────────────────────────────────────────────────
  describe("state machine", () => {
    it("full flow: create -> finalize -> pay", () => {
      const { service } = makeService();

      const draft = service.create({ customer: "cus_flow", amount_due: 5000 });
      expect(draft.status).toBe("draft");
      expect(draft.paid).toBe(false);

      const open = service.finalizeInvoice(draft.id);
      expect(open.status).toBe("open");
      expect(open.paid).toBe(false);
      expect(open.number).not.toBeNull();

      const paid = service.pay(open.id);
      expect(paid.status).toBe("paid");
      expect(paid.paid).toBe(true);
      expect(paid.amount_paid).toBe(5000);
      expect(paid.amount_remaining).toBe(0);
      expect(paid.attempt_count).toBe(1);
    });

    it("full flow: create -> finalize -> void", () => {
      const { service } = makeService();

      const draft = service.create({ customer: "cus_flow", amount_due: 3000 });
      expect(draft.status).toBe("draft");

      const open = service.finalizeInvoice(draft.id);
      expect(open.status).toBe("open");

      const voided = service.voidInvoice(open.id);
      expect(voided.status).toBe("void");
      expect(voided.paid).toBe(false);
    });

    it("draft -> pay is invalid", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test" });

      expect(() => service.pay(draft.id)).toThrow(StripeError);

      try {
        service.pay(draft.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("draft");
      }
    });

    it("draft -> void is invalid", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test" });

      expect(() => service.voidInvoice(draft.id)).toThrow(StripeError);

      try {
        service.voidInvoice(draft.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.statusCode).toBe(400);
        expect(se.body.error.message).toContain("draft");
      }
    });

    it("open -> finalize is invalid", () => {
      const { service } = makeService();
      const open = createOpenInvoice(service);

      expect(() => service.finalizeInvoice(open.id)).toThrow(StripeError);
    });

    it("paid -> pay is invalid", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.pay(paid.id)).toThrow(StripeError);
    });

    it("paid -> void is invalid", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.voidInvoice(paid.id)).toThrow(StripeError);
    });

    it("paid -> finalize is invalid", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.finalizeInvoice(paid.id)).toThrow(StripeError);
    });

    it("void -> pay is invalid", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.pay(voided.id)).toThrow(StripeError);
    });

    it("void -> finalize is invalid", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.finalizeInvoice(voided.id)).toThrow(StripeError);
    });

    it("void -> void is invalid", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.voidInvoice(voided.id)).toThrow(StripeError);
    });

    it("state transition errors include invoice_unexpected_state code", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test" });

      try {
        service.pay(draft.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.code).toBe("invoice_unexpected_state");
      }
    });

    it("state transition errors include invalid_request_error type", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test" });

      try {
        service.voidInvoice(draft.id);
      } catch (err) {
        const se = err as StripeError;
        expect(se.body.error.type).toBe("invalid_request_error");
      }
    });

    it("state transitions preserve all data through full lifecycle", () => {
      const { service } = makeService();

      const draft = service.create({
        customer: "cus_lifecycle",
        amount_due: 9999,
        currency: "gbp",
        subscription: "sub_life",
        metadata: { flow: "complete" },
        billing_reason: "subscription_create",
      });

      const open = service.finalizeInvoice(draft.id);
      expect(open.customer).toBe("cus_lifecycle");
      expect(open.amount_due).toBe(9999);
      expect(open.currency).toBe("gbp");
      expect(open.subscription).toBe("sub_life");
      expect(open.metadata).toEqual({ flow: "complete" });
      expect(open.billing_reason).toBe("subscription_create");

      const paid = service.pay(open.id);
      expect(paid.customer).toBe("cus_lifecycle");
      expect(paid.amount_due).toBe(9999);
      expect(paid.currency).toBe("gbp");
      expect(paid.subscription).toBe("sub_life");
      expect(paid.metadata).toEqual({ flow: "complete" });
      expect(paid.billing_reason).toBe("subscription_create");
      expect(paid.number).toBe(open.number);
      expect(paid.created).toBe(draft.created);
    });

    it("different invoices can be in different states simultaneously", () => {
      const { service } = makeService();

      const draft = service.create({ customer: "cus_a" });
      const open = createOpenInvoice(service, { customer: "cus_b" });
      const paid = createPaidInvoice(service, { customer: "cus_c" });
      const voided = createVoidedInvoice(service, { customer: "cus_d" });

      expect(service.retrieve(draft.id).status).toBe("draft");
      expect(service.retrieve(open.id).status).toBe("open");
      expect(service.retrieve(paid.id).status).toBe("paid");
      expect(service.retrieve(voided.id).status).toBe("void");
    });

    it("draft -> finalize is the only valid transition from draft", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test" });

      // pay should fail
      expect(() => service.pay(draft.id)).toThrow(StripeError);
      // void should fail
      expect(() => service.voidInvoice(draft.id)).toThrow(StripeError);
      // finalize should succeed
      const finalized = service.finalizeInvoice(draft.id);
      expect(finalized.status).toBe("open");
    });

    it("open allows pay or void but not finalize", () => {
      const { service } = makeService();

      // Test void path
      const open1 = createOpenInvoice(service, { customer: "cus_a" });
      expect(() => service.finalizeInvoice(open1.id)).toThrow(StripeError);
      const voided = service.voidInvoice(open1.id);
      expect(voided.status).toBe("void");

      // Test pay path
      const open2 = createOpenInvoice(service, { customer: "cus_b" });
      const paid = service.pay(open2.id);
      expect(paid.status).toBe("paid");
    });

    it("paid is a terminal state - no transitions allowed", () => {
      const { service } = makeService();
      const paid = createPaidInvoice(service);

      expect(() => service.finalizeInvoice(paid.id)).toThrow(StripeError);
      expect(() => service.pay(paid.id)).toThrow(StripeError);
      expect(() => service.voidInvoice(paid.id)).toThrow(StripeError);
    });

    it("void is a terminal state - no transitions allowed", () => {
      const { service } = makeService();
      const voided = createVoidedInvoice(service);

      expect(() => service.finalizeInvoice(voided.id)).toThrow(StripeError);
      expect(() => service.pay(voided.id)).toThrow(StripeError);
      expect(() => service.voidInvoice(voided.id)).toThrow(StripeError);
    });

    it("full flow preserves id through all transitions", () => {
      const { service } = makeService();
      const draft = service.create({ customer: "cus_test", amount_due: 1000 });
      const open = service.finalizeInvoice(draft.id);
      const paid = service.pay(open.id);

      expect(draft.id).toBe(open.id);
      expect(open.id).toBe(paid.id);
    });

    it("finalize -> pay flow with retrieve verification at each step", () => {
      const { service } = makeService();

      const draft = service.create({ customer: "cus_verify", amount_due: 7500 });
      const r1 = service.retrieve(draft.id);
      expect(r1.status).toBe("draft");
      expect(r1.number).toBeNull();

      service.finalizeInvoice(draft.id);
      const r2 = service.retrieve(draft.id);
      expect(r2.status).toBe("open");
      expect(r2.number).not.toBeNull();
      expect(r2.amount_due).toBe(7500);

      service.pay(draft.id);
      const r3 = service.retrieve(draft.id);
      expect(r3.status).toBe("paid");
      expect(r3.paid).toBe(true);
      expect(r3.amount_paid).toBe(7500);
      expect(r3.amount_remaining).toBe(0);
      expect(r3.number).toBe(r2.number);
    });

    it("concurrent invoices go through independent lifecycle paths", () => {
      const { service } = makeService();

      const inv1 = service.create({ customer: "cus_1", amount_due: 100 });
      const inv2 = service.create({ customer: "cus_2", amount_due: 200 });

      // inv1 goes to paid, inv2 goes to void
      service.finalizeInvoice(inv1.id);
      service.finalizeInvoice(inv2.id);
      service.pay(inv1.id);
      service.voidInvoice(inv2.id);

      const r1 = service.retrieve(inv1.id);
      const r2 = service.retrieve(inv2.id);
      expect(r1.status).toBe("paid");
      expect(r2.status).toBe("void");
      expect(r1.amount_paid).toBe(100);
      expect(r2.amount_paid).toBe(0);
    });

    it("finalize -> void flow with retrieve verification at each step", () => {
      const { service } = makeService();

      const draft = service.create({ customer: "cus_verify", amount_due: 2000 });
      service.finalizeInvoice(draft.id);
      const r2 = service.retrieve(draft.id);
      expect(r2.status).toBe("open");

      service.voidInvoice(draft.id);
      const r3 = service.retrieve(draft.id);
      expect(r3.status).toBe("void");
      expect(r3.paid).toBe(false);
      expect(r3.number).toBe(r2.number);
    });
  });
});
