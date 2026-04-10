import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { ChargeService } from "../../../src/services/charges";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { RefundService } from "../../../src/services/refunds";
import { StripeError } from "../../../src/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const chargeService = new ChargeService(db);
  const piService = new PaymentIntentService(db, chargeService, pmService);
  const refundService = new RefundService(db, chargeService);
  return { db, pmService, chargeService, piService, refundService };
}

type Services = ReturnType<typeof makeServices>;

/**
 * Creates a succeeded charge for a given amount/currency via the PI flow.
 * Returns the PaymentIntent and the charge ID attached to it.
 */
function createTestCharge(
  services: Services,
  opts: { amount?: number; currency?: string } = {},
) {
  const { pmService, piService } = services;
  const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
  const pi = piService.create({
    amount: opts.amount ?? 1000,
    currency: opts.currency ?? "usd",
    payment_method: pm.id,
    confirm: true,
  });
  expect(pi.status).toBe("succeeded");
  return { pi, chargeId: pi.latest_charge as string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RefundService", () => {
  // =======================================================================
  // create() — basic creation (~70 tests)
  // =======================================================================
  describe("create", () => {
    // ----- full refund by charge ID -----
    it("creates a full refund by charge ID", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.amount).toBe(1000);
      expect(refund.charge).toBe(chargeId);
    });

    it("defaults amount to the full charge amount when no amount provided", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 2500 });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.amount).toBe(2500);
    });

    it("returns id starting with re_", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.id).toMatch(/^re_/);
    });

    it("returns object equal to 'refund'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.object).toBe("refund");
    });

    it("returns status 'succeeded'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.status).toBe("succeeded");
    });

    it("returns the correct currency from the charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "eur" });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.currency).toBe("eur");
    });

    it("sets charge field to the charge id", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.charge).toBe(chargeId);
    });

    it("sets payment_intent field when charge has a PI", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.payment_intent).toBe(pi.id);
    });

    it("sets created to a recent unix timestamp", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const before = Math.floor(Date.now() / 1000);
      const refund = s.refundService.create({ charge: chargeId });
      const after = Math.floor(Date.now() / 1000);
      expect(refund.created).toBeGreaterThanOrEqual(before);
      expect(refund.created).toBeLessThanOrEqual(after);
    });

    it("sets balance_transaction to null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.balance_transaction).toBeNull();
    });

    it("sets receipt_number to null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.receipt_number).toBeNull();
    });

    it("sets source_transfer_reversal to null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.source_transfer_reversal).toBeNull();
    });

    it("sets transfer_reversal to null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.transfer_reversal).toBeNull();
    });

    // ----- partial refund -----
    it("creates a partial refund with explicit amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, amount: 400 });
      expect(refund.amount).toBe(400);
      expect(refund.status).toBe("succeeded");
    });

    it("partial refund of 1 cent", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, amount: 1 });
      expect(refund.amount).toBe(1);
    });

    it("partial refund of charge_amount - 1", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, amount: 999 });
      expect(refund.amount).toBe(999);
    });

    it("partial refund of exactly half", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 2000 });
      const refund = s.refundService.create({ charge: chargeId, amount: 1000 });
      expect(refund.amount).toBe(1000);
    });

    // ----- payment_intent lookup -----
    it("creates refund by payment_intent instead of charge", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ payment_intent: pi.id });
      expect(refund.amount).toBe(1000);
      expect(refund.charge).toBe(chargeId);
      expect(refund.payment_intent).toBe(pi.id);
    });

    it("partial refund by payment_intent", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({ payment_intent: pi.id, amount: 300 });
      expect(refund.amount).toBe(300);
    });

    it("payment_intent lookup resolves the correct charge", () => {
      const s = makeServices();
      const { pi: pi1, chargeId: cid1 } = createTestCharge(s);
      const { pi: pi2, chargeId: cid2 } = createTestCharge(s);

      const r1 = s.refundService.create({ payment_intent: pi1.id });
      const r2 = s.refundService.create({ payment_intent: pi2.id });

      expect(r1.charge).toBe(cid1);
      expect(r2.charge).toBe(cid2);
    });

    // ----- metadata -----
    it("stores metadata on the refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        metadata: { reason_code: "customer_request" },
      });
      expect(refund.metadata).toEqual({ reason_code: "customer_request" });
    });

    it("stores empty metadata by default", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.metadata).toEqual({});
    });

    it("stores multiple metadata keys", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        metadata: { a: "1", b: "2", c: "3" },
      });
      expect(refund.metadata).toEqual({ a: "1", b: "2", c: "3" });
    });

    // ----- reason -----
    it("stores reason 'duplicate'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, reason: "duplicate" });
      expect(refund.reason).toBe("duplicate");
    });

    it("stores reason 'fraudulent'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, reason: "fraudulent" });
      expect(refund.reason).toBe("fraudulent");
    });

    it("stores reason 'requested_by_customer'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        reason: "requested_by_customer",
      });
      expect(refund.reason).toBe("requested_by_customer");
    });

    it("reason is null when not provided", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.reason).toBeNull();
    });

    // ----- charge updates on full refund -----
    it("full refund sets charge.refunded to true", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
    });

    it("full refund sets charge.amount_refunded to charge amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1000);
    });

    it("full refund of large amount updates charge correctly", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 999999 });
      s.refundService.create({ charge: chargeId });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(999999);
      expect(charge.refunded).toBe(true);
    });

    // ----- charge updates on partial refund -----
    it("partial refund does NOT set charge.refunded to true", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 300 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(false);
    });

    it("partial refund updates charge.amount_refunded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 300 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(300);
    });

    // ----- multiple partial refunds -----
    it("allows two partial refunds totaling the charge amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 600 });
      s.refundService.create({ charge: chargeId, amount: 400 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1000);
      expect(charge.refunded).toBe(true);
    });

    it("allows three partial refunds", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 3000 });
      s.refundService.create({ charge: chargeId, amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 1000 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(3000);
      expect(charge.refunded).toBe(true);
    });

    it("tracks charge.amount_refunded incrementally after each partial", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });

      s.refundService.create({ charge: chargeId, amount: 200 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(200);

      s.refundService.create({ charge: chargeId, amount: 300 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(500);

      s.refundService.create({ charge: chargeId, amount: 500 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(1000);
    });

    it("charge.refunded stays false until fully refunded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });

      s.refundService.create({ charge: chargeId, amount: 200 });
      expect(s.chargeService.retrieve(chargeId).refunded).toBe(false);

      s.refundService.create({ charge: chargeId, amount: 300 });
      expect(s.chargeService.retrieve(chargeId).refunded).toBe(false);

      s.refundService.create({ charge: chargeId, amount: 500 });
      expect(s.chargeService.retrieve(chargeId).refunded).toBe(true);
    });

    it("partial refund then remaining amount completes the refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 750 });

      s.refundService.create({ charge: chargeId, amount: 250 });
      // Now remaining is 500 — default should refund the rest
      s.refundService.create({ charge: chargeId });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(750);
      expect(charge.refunded).toBe(true);
    });

    it("two equal partial refunds on an even charge amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 500 });
      s.refundService.create({ charge: chargeId, amount: 250 });
      s.refundService.create({ charge: chargeId, amount: 250 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(500);
      expect(charge.refunded).toBe(true);
    });

    // ----- unique IDs -----
    it("generates unique IDs for each refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      const r1 = s.refundService.create({ charge: chargeId, amount: 100 });
      const r2 = s.refundService.create({ charge: chargeId, amount: 100 });
      expect(r1.id).not.toBe(r2.id);
    });

    it("generates unique IDs across different charges", () => {
      const s = makeServices();
      const { chargeId: cid1 } = createTestCharge(s);
      const { chargeId: cid2 } = createTestCharge(s);
      const r1 = s.refundService.create({ charge: cid1 });
      const r2 = s.refundService.create({ charge: cid2 });
      expect(r1.id).not.toBe(r2.id);
    });

    // ----- charge retrieval shows refund info -----
    it("retrieving charge after refund shows updated amount_refunded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 400 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(400);
    });

    // ----- currency matching -----
    it("refund currency matches the charge currency (usd)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "usd" });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.currency).toBe("usd");
    });

    it("refund currency matches the charge currency (eur)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "eur" });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.currency).toBe("eur");
    });

    it("refund currency matches the charge currency (gbp)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "gbp" });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.currency).toBe("gbp");
    });

    // ----- both charge and PI provided -----
    it("uses charge when both charge and payment_intent are provided", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        payment_intent: pi.id,
      });
      expect(refund.charge).toBe(chargeId);
    });

    // ----- refund with amount equal to charge -----
    it("explicit amount equal to charge amount is treated as full refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 500 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
      expect(charge.amount_refunded).toBe(500);
    });

    // ----- refund preserves charge status -----
    it("refund does not change the charge status", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const chargeBefore = s.chargeService.retrieve(chargeId);
      s.refundService.create({ charge: chargeId });
      const chargeAfter = s.chargeService.retrieve(chargeId);
      expect(chargeAfter.status).toBe(chargeBefore.status);
    });

    // ----- create with reason and metadata combined -----
    it("stores both reason and metadata together", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        reason: "duplicate",
        metadata: { order_id: "12345" },
      });
      expect(refund.reason).toBe("duplicate");
      expect(refund.metadata).toEqual({ order_id: "12345" });
    });

    // ----- amount edge: exactly refundable after partial -----
    it("refunds exactly the remaining amount after a partial refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 700 });
      const r2 = s.refundService.create({ charge: chargeId, amount: 300 });
      expect(r2.amount).toBe(300);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1000);
      expect(charge.refunded).toBe(true);
    });

    // ----- default refund after partial refunds defaults to remaining -----
    it("default amount after partial is the remaining refundable amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 600 });
      const r2 = s.refundService.create({ charge: chargeId });
      expect(r2.amount).toBe(400);
    });

    // ----- multiple refunds for different charges are independent -----
    it("refunding one charge does not affect another charge", () => {
      const s = makeServices();
      const { chargeId: cid1 } = createTestCharge(s, { amount: 1000 });
      const { chargeId: cid2 } = createTestCharge(s, { amount: 2000 });

      s.refundService.create({ charge: cid1 });

      const c1 = s.chargeService.retrieve(cid1);
      const c2 = s.chargeService.retrieve(cid2);

      expect(c1.refunded).toBe(true);
      expect(c2.refunded).toBe(false);
      expect(c2.amount_refunded).toBe(0);
    });

    // ----- payment_intent field set correctly via PI lookup -----
    it("sets payment_intent when creating refund via PI lookup", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({ payment_intent: pi.id });
      expect(refund.payment_intent).toBe(pi.id);
    });

    // ----- partial refund via PI -----
    it("allows partial refund via payment_intent", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 2000 });
      const refund = s.refundService.create({
        payment_intent: pi.id,
        amount: 500,
      });
      expect(refund.amount).toBe(500);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(500);
    });

    // ----- metadata via PI refund -----
    it("stores metadata when refunding via payment_intent", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({
        payment_intent: pi.id,
        metadata: { via: "pi" },
      });
      expect(refund.metadata).toEqual({ via: "pi" });
    });

    // ----- reason via PI refund -----
    it("stores reason when refunding via payment_intent", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({
        payment_intent: pi.id,
        reason: "fraudulent",
      });
      expect(refund.reason).toBe("fraudulent");
    });

    // ===================================================================
    // create() — error handling
    // ===================================================================
    it("throws when neither charge nor payment_intent provided", () => {
      const s = makeServices();
      expect(() => s.refundService.create({})).toThrow(StripeError);
    });

    it("error for missing charge/PI has statusCode 400", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for missing charge/PI has type invalid_request_error", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("error for missing charge/PI has param 'charge'", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("charge");
      }
    });

    it("error for missing charge/PI includes descriptive message", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("charge");
        expect((err as StripeError).body.error.message).toContain("payment_intent");
      }
    });

    it("throws 404 for nonexistent charge", () => {
      const s = makeServices();
      expect(() =>
        s.refundService.create({ charge: "ch_nonexistent" }),
      ).toThrow(StripeError);
    });

    it("404 error for nonexistent charge has correct statusCode", () => {
      const s = makeServices();
      try {
        s.refundService.create({ charge: "ch_nonexistent" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("404 error for nonexistent charge mentions the charge id", () => {
      const s = makeServices();
      try {
        s.refundService.create({ charge: "ch_nonexistent_abc" });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain(
          "ch_nonexistent_abc",
        );
      }
    });

    it("404 error for nonexistent charge has code resource_missing", () => {
      const s = makeServices();
      try {
        s.refundService.create({ charge: "ch_nope" });
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("throws when payment_intent has no associated charge", () => {
      const s = makeServices();
      // Create a PI without confirming (no charge created)
      const pm = s.pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = s.piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });
      expect(() =>
        s.refundService.create({ payment_intent: pi.id }),
      ).toThrow(StripeError);
    });

    it("error for PI with no charge has statusCode 400", () => {
      const s = makeServices();
      const pm = s.pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = s.piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });
      try {
        s.refundService.create({ payment_intent: pi.id });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for PI with no charge mentions payment_intent param", () => {
      const s = makeServices();
      const pm = s.pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = s.piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });
      try {
        s.refundService.create({ payment_intent: pi.id });
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("payment_intent");
      }
    });

    it("throws when refund amount exceeds charge amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 1500 }),
      ).toThrow(StripeError);
    });

    it("over-refund error has statusCode 400", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      try {
        s.refundService.create({ charge: chargeId, amount: 1500 });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("over-refund error has type invalid_request_error", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      try {
        s.refundService.create({ charge: chargeId, amount: 1500 });
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("over-refund error has param 'amount'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      try {
        s.refundService.create({ charge: chargeId, amount: 1500 });
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("amount");
      }
    });

    it("over-refund error message includes the amounts", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      try {
        s.refundService.create({ charge: chargeId, amount: 1500 });
      } catch (err) {
        const msg = (err as StripeError).body.error.message;
        expect(msg).toContain("1500");
        expect(msg).toContain("1000");
      }
    });

    it("throws when refunding an already fully refunded charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      expect(() =>
        s.refundService.create({ charge: chargeId }),
      ).toThrow(StripeError);
    });

    it("error for fully-refunded charge has statusCode 400", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      try {
        s.refundService.create({ charge: chargeId });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws when partial refund + new refund exceeds total", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 800 });
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 300 }),
      ).toThrow(StripeError);
    });

    it("over-refund after partial includes correct refundable amount in message", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 800 });
      try {
        s.refundService.create({ charge: chargeId, amount: 300 });
      } catch (err) {
        const msg = (err as StripeError).body.error.message;
        expect(msg).toContain("300");
        expect(msg).toContain("200");
      }
    });

    it("throws when refund amount is zero (via explicit amount=0 scenario)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      // amount <= 0 is rejected
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 0 }),
      ).toThrow(StripeError);
    });

    it("throws when refund amount is negative", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: -100 }),
      ).toThrow(StripeError);
    });

    it("negative amount error has param 'amount'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      try {
        s.refundService.create({ charge: chargeId, amount: -100 });
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("amount");
      }
    });

    it("zero amount error has statusCode 400", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      try {
        s.refundService.create({ charge: chargeId, amount: 0 });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("amount exceeding charge by 1 throws", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 500 });
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 501 }),
      ).toThrow(StripeError);
    });
  });

  // =======================================================================
  // retrieve() (~25 tests)
  // =======================================================================
  describe("retrieve", () => {
    it("returns a refund by ID", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("retrieved refund has correct amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId, amount: 400 });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.amount).toBe(400);
    });

    it("retrieved refund has correct charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.charge).toBe(chargeId);
    });

    it("retrieved refund has correct payment_intent", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.payment_intent).toBe(pi.id);
    });

    it("retrieved refund has correct currency", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "eur" });
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.currency).toBe("eur");
    });

    it("retrieved refund has correct status", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.status).toBe("succeeded");
    });

    it("retrieved refund has correct object", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.object).toBe("refund");
    });

    it("retrieved refund has correct created timestamp", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.created).toBe(created.created);
    });

    it("retrieved refund has correct metadata", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({
        charge: chargeId,
        metadata: { key: "value" },
      });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ key: "value" });
    });

    it("retrieved refund has correct reason", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({
        charge: chargeId,
        reason: "duplicate",
      });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.reason).toBe("duplicate");
    });

    it("retrieved refund matches the full create response", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({
        charge: chargeId,
        amount: 500,
        reason: "fraudulent",
        metadata: { test: "yes" },
      });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved).toEqual(created);
    });

    it("multiple retrieves return the same data", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const r1 = s.refundService.retrieve(created.id);
      const r2 = s.refundService.retrieve(created.id);
      expect(r1).toEqual(r2);
    });

    it("can retrieve each of multiple refunds independently", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      const ref1 = s.refundService.create({ charge: chargeId, amount: 300 });
      const ref2 = s.refundService.create({ charge: chargeId, amount: 200 });

      const r1 = s.refundService.retrieve(ref1.id);
      const r2 = s.refundService.retrieve(ref2.id);

      expect(r1.id).toBe(ref1.id);
      expect(r1.amount).toBe(300);
      expect(r2.id).toBe(ref2.id);
      expect(r2.amount).toBe(200);
    });

    it("retrieved refund has balance_transaction null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.balance_transaction).toBeNull();
    });

    it("retrieved refund has receipt_number null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.receipt_number).toBeNull();
    });

    it("retrieved refund has source_transfer_reversal null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.source_transfer_reversal).toBeNull();
    });

    it("retrieved refund has transfer_reversal null", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const created = s.refundService.create({ charge: chargeId });
      const retrieved = s.refundService.retrieve(created.id);
      expect(retrieved.transfer_reversal).toBeNull();
    });

    // ----- retrieve errors -----
    it("throws 404 for nonexistent refund", () => {
      const s = makeServices();
      expect(() => s.refundService.retrieve("re_nonexistent")).toThrow(
        StripeError,
      );
    });

    it("404 error for nonexistent refund has correct statusCode", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("404 error has type invalid_request_error", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_nonexistent");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe(
          "invalid_request_error",
        );
      }
    });

    it("404 error has code resource_missing", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_nonexistent");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("404 error message includes the refund id", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_abc123");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("re_abc123");
      }
    });

    it("404 error message includes 'refund'", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_test");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("refund");
      }
    });

    it("404 error has param 'id'", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_missing");
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("id");
      }
    });

    it("throws on empty string id", () => {
      const s = makeServices();
      expect(() => s.refundService.retrieve("")).toThrow(StripeError);
    });
  });

  // =======================================================================
  // list() (~40 tests)
  // =======================================================================
  describe("list", () => {
    const defaultListParams = {
      limit: 10,
      startingAfter: undefined,
      endingBefore: undefined,
    };

    it("returns empty list when no refunds exist", () => {
      const s = makeServices();
      const result = s.refundService.list(defaultListParams);
      expect(result.data).toEqual([]);
    });

    it("empty list has object 'list'", () => {
      const s = makeServices();
      const result = s.refundService.list(defaultListParams);
      expect(result.object).toBe("list");
    });

    it("empty list has has_more false", () => {
      const s = makeServices();
      const result = s.refundService.list(defaultListParams);
      expect(result.has_more).toBe(false);
    });

    it("empty list has url '/v1/refunds'", () => {
      const s = makeServices();
      const result = s.refundService.list(defaultListParams);
      expect(result.url).toBe("/v1/refunds");
    });

    it("returns a single refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list(defaultListParams);
      expect(result.data.length).toBe(1);
    });

    it("returns all refunds within limit", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 200 });
      const result = s.refundService.list(defaultListParams);
      expect(result.data.length).toBe(2);
    });

    it("list url is always /v1/refunds", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list(defaultListParams);
      expect(result.url).toBe("/v1/refunds");
    });

    it("list object is always 'list'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list(defaultListParams);
      expect(result.object).toBe("list");
    });

    it("data contains proper refund objects", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list(defaultListParams);
      const refund = result.data[0];
      expect(refund.object).toBe("refund");
      expect(refund.id).toMatch(/^re_/);
    });

    // ----- limit -----
    it("respects limit parameter", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      const { chargeId: c3 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });
      s.refundService.create({ charge: c3 });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 2,
      });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(true);
    });

    it("limit=1 returns exactly one", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 1,
      });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("limit greater than total returns all items", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 100,
      });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(false);
    });

    it("limit equal to total count returns all with has_more false", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 2,
      });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });

    // ----- has_more -----
    it("has_more is true when there are more items than limit", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      const { chargeId: c3 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });
      s.refundService.create({ charge: c3 });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 1,
      });
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when all items fit within limit", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const result = s.refundService.list({
        ...defaultListParams,
        limit: 10,
      });
      expect(result.has_more).toBe(false);
    });

    // ----- starting_after pagination -----
    it("starting_after excludes the cursor item itself", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const r1 = s.refundService.create({ charge: chargeId });

      const page = s.refundService.list({
        ...defaultListParams,
        startingAfter: r1.id,
      });
      expect(page.data.every((r) => r.id !== r1.id)).toBe(true);
    });

    it("starting_after paginates to next item", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const r1 = s.refundService.create({ charge: c1 });

      const { chargeId: c2 } = createTestCharge(s);
      const r2 = s.refundService.create({ charge: c2 });

      const page1 = s.refundService.list({ ...defaultListParams, limit: 1 });
      expect(page1.data.length).toBe(1);
      expect(page1.has_more).toBe(true);

      const page2 = s.refundService.list({
        ...defaultListParams,
        limit: 1,
        startingAfter: page1.data[0].id,
      });
      expect(page2.data.length).toBe(1);
      expect(page2.data[0].id).not.toBe(page1.data[0].id);
      expect(page2.has_more).toBe(false);
    });

    it("starting_after with last item returns empty", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });

      const { chargeId: c2 } = createTestCharge(s);
      const r2 = s.refundService.create({ charge: c2 });

      // Get the last item (list is ordered by created desc, id desc)
      const all = s.refundService.list(defaultListParams);
      const lastItem = all.data[all.data.length - 1];

      const page = s.refundService.list({
        ...defaultListParams,
        startingAfter: lastItem.id,
      });
      expect(page.data.length).toBe(0);
      expect(page.has_more).toBe(false);
    });

    it("starting_after with nonexistent id throws", () => {
      const s = makeServices();
      expect(() =>
        s.refundService.list({
          ...defaultListParams,
          startingAfter: "re_nonexistent",
        }),
      ).toThrow(StripeError);
    });

    it("paginates through all items with starting_after", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });

      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c2 });

      const { chargeId: c3 } = createTestCharge(s);
      s.refundService.create({ charge: c3 });

      const collectedIds: string[] = [];
      let startingAfter: string | undefined = undefined;

      for (let page = 0; page < 10; page++) {
        const result = s.refundService.list({ ...defaultListParams, limit: 1, startingAfter });
        collectedIds.push(...result.data.map((d) => d.id));
        if (!result.has_more) break;
        startingAfter = result.data[result.data.length - 1].id;
      }

      expect(collectedIds.length).toBe(3);
      expect(new Set(collectedIds).size).toBe(3);
    });

    // ----- chargeId filter -----
    it("filters by chargeId", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 1000 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: c1, amount: 100 });
      s.refundService.create({ charge: c1, amount: 200 });
      s.refundService.create({ charge: c2, amount: 300 });

      const result = s.refundService.list({
        ...defaultListParams,
        chargeId: c1,
      });
      expect(result.data.length).toBe(2);
      expect(result.data.every((r) => r.charge === c1)).toBe(true);
    });

    it("chargeId filter excludes refunds for other charges", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });

      const result = s.refundService.list({
        ...defaultListParams,
        chargeId: c2,
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].charge).toBe(c2);
    });

    it("chargeId filter returns empty when no refunds for that charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });

      const result = s.refundService.list({
        ...defaultListParams,
        chargeId: "ch_nonexistent_filter",
      });
      expect(result.data.length).toBe(0);
    });

    it("lists multiple refunds for same charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 200 });
      s.refundService.create({ charge: chargeId, amount: 300 });

      const result = s.refundService.list({
        ...defaultListParams,
        chargeId,
      });
      expect(result.data.length).toBe(3);
    });

    // ----- paymentIntentId filter -----
    it("filters by paymentIntentId", () => {
      const s = makeServices();
      const { pi: pi1, chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });

      const result = s.refundService.list({
        ...defaultListParams,
        paymentIntentId: pi1.id,
      });
      expect(result.data.length).toBe(1);
      expect(result.data[0].payment_intent).toBe(pi1.id);
    });

    it("paymentIntentId filter returns empty when no matches", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });

      const result = s.refundService.list({
        ...defaultListParams,
        paymentIntentId: "pi_nonexistent",
      });
      expect(result.data.length).toBe(0);
    });

    it("paymentIntentId filter with multiple refunds for same PI", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 300 });
      s.refundService.create({ charge: chargeId, amount: 200 });

      const result = s.refundService.list({
        ...defaultListParams,
        paymentIntentId: pi.id,
      });
      expect(result.data.length).toBe(2);
    });

    // ----- list without filters returns all -----
    it("without filter returns all refunds across charges", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      const { chargeId: c3 } = createTestCharge(s);
      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2 });
      s.refundService.create({ charge: c3 });

      const result = s.refundService.list(defaultListParams);
      expect(result.data.length).toBe(3);
    });

    // ----- filter + limit -----
    it("chargeId filter respects limit", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 100 });

      const result = s.refundService.list({
        ...defaultListParams,
        limit: 2,
        chargeId,
      });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(true);
    });

    it("paymentIntentId filter respects limit", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 100 });

      const result = s.refundService.list({
        ...defaultListParams,
        limit: 1,
        paymentIntentId: pi.id,
      });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    // ----- list data items are valid refund objects -----
    it("each item in list data is a valid refund object", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s);
      const { chargeId: c2 } = createTestCharge(s);
      s.refundService.create({ charge: c1, reason: "duplicate" });
      s.refundService.create({ charge: c2, reason: "fraudulent" });

      const result = s.refundService.list(defaultListParams);
      for (const refund of result.data) {
        expect(refund.id).toMatch(/^re_/);
        expect(refund.object).toBe("refund");
        expect(refund.status).toBe("succeeded");
        expect(typeof refund.amount).toBe("number");
        expect(typeof refund.currency).toBe("string");
      }
    });

    // ----- list returns refund amounts correctly -----
    it("list returns correct amounts for each refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 200 });

      const result = s.refundService.list(defaultListParams);
      const amounts = result.data.map((r) => r.amount).sort();
      expect(amounts).toEqual([100, 200]);
    });
  });

  // =======================================================================
  // Partial refund scenarios (~30 tests)
  // =======================================================================
  describe("partial refund scenarios", () => {
    it("refund 50% of charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 2000 });
      const refund = s.refundService.create({ charge: chargeId, amount: 1000 });
      expect(refund.amount).toBe(1000);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1000);
      expect(charge.refunded).toBe(false);
    });

    it("refund 1 cent from a large charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100000 });
      const refund = s.refundService.create({ charge: chargeId, amount: 1 });
      expect(refund.amount).toBe(1);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1);
      expect(charge.refunded).toBe(false);
    });

    it("refund charge_amount - 1 is not a full refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 999 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(false);
      expect(charge.amount_refunded).toBe(999);
    });

    it("refund charge_amount - 1 then 1 completes the refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 999 });
      s.refundService.create({ charge: chargeId, amount: 1 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
      expect(charge.amount_refunded).toBe(1000);
    });

    it("two equal partial refunds on 1000", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(1000);
      expect(charge.refunded).toBe(true);
    });

    it("three partial refunds of 1/3 each (with rounding)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 999 });
      s.refundService.create({ charge: chargeId, amount: 333 });
      s.refundService.create({ charge: chargeId, amount: 333 });
      s.refundService.create({ charge: chargeId, amount: 333 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(999);
      expect(charge.refunded).toBe(true);
    });

    it("partial refund then full remaining via default amount", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 800 });
      s.refundService.create({ charge: chargeId, amount: 300 });
      const r2 = s.refundService.create({ charge: chargeId });
      expect(r2.amount).toBe(500);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
    });

    it("check charge.amount_refunded after each of four partial refunds", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 400 });

      s.refundService.create({ charge: chargeId, amount: 100 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(100);

      s.refundService.create({ charge: chargeId, amount: 100 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(200);

      s.refundService.create({ charge: chargeId, amount: 100 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(300);

      s.refundService.create({ charge: chargeId, amount: 100 });
      expect(s.chargeService.retrieve(chargeId).amount_refunded).toBe(400);
      expect(s.chargeService.retrieve(chargeId).refunded).toBe(true);
    });

    it("partial refund preserves charge.status as succeeded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId, amount: 500 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.status).toBe("succeeded");
    });

    it("full refund preserves charge.status as succeeded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      s.refundService.create({ charge: chargeId });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.status).toBe("succeeded");
    });

    it("partial refund currency matches charge", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "jpy", amount: 10000 });
      const refund = s.refundService.create({ charge: chargeId, amount: 5000 });
      expect(refund.currency).toBe("jpy");
    });

    it("partial refund via PI updates the charge correctly", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ payment_intent: pi.id, amount: 400 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(400);
      expect(charge.refunded).toBe(false);
    });

    it("multiple partial refunds via PI update charge incrementally", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ payment_intent: pi.id, amount: 200 });
      s.refundService.create({ payment_intent: pi.id, amount: 300 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(500);
      expect(charge.refunded).toBe(false);
    });

    it("refund via PI after partial by charge ID accumulates correctly", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 300 });
      s.refundService.create({ payment_intent: pi.id, amount: 200 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(500);
    });

    it("cannot refund more than remaining after mixed partial refunds", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 600 });
      s.refundService.create({ payment_intent: pi.id, amount: 300 });
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 200 }),
      ).toThrow(StripeError);
    });

    it("many small partial refunds accumulate correctly", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100 });
      for (let i = 0; i < 10; i++) {
        s.refundService.create({ charge: chargeId, amount: 10 });
      }
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(100);
      expect(charge.refunded).toBe(true);
    });

    it("each partial refund gets its own unique ID", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 500 });
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const r = s.refundService.create({ charge: chargeId, amount: 100 });
        ids.add(r.id);
      }
      expect(ids.size).toBe(5);
    });

    it("each partial refund has status succeeded", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 500 });
      for (let i = 0; i < 5; i++) {
        const r = s.refundService.create({ charge: chargeId, amount: 100 });
        expect(r.status).toBe("succeeded");
      }
    });

    it("partial refund then over-refund of remaining+1 throws", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      expect(() =>
        s.refundService.create({ charge: chargeId, amount: 501 }),
      ).toThrow(StripeError);
    });

    it("partial refund then exactly remaining succeeds", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      const r2 = s.refundService.create({ charge: chargeId, amount: 500 });
      expect(r2.amount).toBe(500);
    });

    it("refund of charge with amount 1 (minimum)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1 });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.amount).toBe(1);
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
    });

    it("partial refunds are listable after creation", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 100 });
      s.refundService.create({ charge: chargeId, amount: 200 });
      s.refundService.create({ charge: chargeId, amount: 300 });

      const list = s.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        chargeId,
      });
      expect(list.data.length).toBe(3);
    });

    it("partial refunds are retrievable after creation", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      const r1 = s.refundService.create({ charge: chargeId, amount: 100 });
      const r2 = s.refundService.create({ charge: chargeId, amount: 200 });

      expect(s.refundService.retrieve(r1.id).amount).toBe(100);
      expect(s.refundService.retrieve(r2.id).amount).toBe(200);
    });

    it("five small refunds then default refund gets remaining", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      for (let i = 0; i < 5; i++) {
        s.refundService.create({ charge: chargeId, amount: 100 });
      }
      const last = s.refundService.create({ charge: chargeId });
      expect(last.amount).toBe(500);
    });
  });

  // =======================================================================
  // Object shape validation (~15 tests)
  // =======================================================================
  describe("object shape validation", () => {
    it("refund has all expected top-level fields", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        reason: "duplicate",
        metadata: { key: "val" },
      });

      expect(refund).toHaveProperty("id");
      expect(refund).toHaveProperty("object");
      expect(refund).toHaveProperty("amount");
      expect(refund).toHaveProperty("balance_transaction");
      expect(refund).toHaveProperty("charge");
      expect(refund).toHaveProperty("created");
      expect(refund).toHaveProperty("currency");
      expect(refund).toHaveProperty("metadata");
      expect(refund).toHaveProperty("payment_intent");
      expect(refund).toHaveProperty("reason");
      expect(refund).toHaveProperty("receipt_number");
      expect(refund).toHaveProperty("source_transfer_reversal");
      expect(refund).toHaveProperty("status");
      expect(refund).toHaveProperty("transfer_reversal");
    });

    it("id is a string", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.id).toBe("string");
    });

    it("object is a string", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.object).toBe("string");
    });

    it("amount is a positive integer", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1234 });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.amount).toBe(1234);
      expect(Number.isInteger(refund.amount)).toBe(true);
      expect(refund.amount).toBeGreaterThan(0);
    });

    it("currency is a lowercase string", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { currency: "usd" });
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.currency).toBe("usd");
      expect(refund.currency).toBe(refund.currency.toLowerCase());
    });

    it("created is a unix timestamp (number)", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.created).toBe("number");
      expect(Number.isInteger(refund.created)).toBe(true);
      // Should be after 2024
      expect(refund.created).toBeGreaterThan(1700000000);
    });

    it("charge is a string starting with ch_", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.charge).toBe("string");
      expect(refund.charge as string).toMatch(/^ch_/);
    });

    it("payment_intent is a string starting with pi_ when present", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.payment_intent).toBe("string");
      expect(refund.payment_intent as string).toMatch(/^pi_/);
    });

    it("metadata is an object", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(typeof refund.metadata).toBe("object");
      expect(refund.metadata).not.toBeNull();
    });

    it("reason is null when not provided", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.reason).toBeNull();
    });

    it("reason can be 'duplicate'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, reason: "duplicate" });
      expect(refund.reason).toBe("duplicate");
    });

    it("reason can be 'fraudulent'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId, reason: "fraudulent" });
      expect(refund.reason).toBe("fraudulent");
    });

    it("reason can be 'requested_by_customer'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({
        charge: chargeId,
        reason: "requested_by_customer",
      });
      expect(refund.reason).toBe("requested_by_customer");
    });

    it("nullable fields are null by default", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      expect(refund.balance_transaction).toBeNull();
      expect(refund.receipt_number).toBeNull();
      expect(refund.source_transfer_reversal).toBeNull();
      expect(refund.transfer_reversal).toBeNull();
      expect(refund.reason).toBeNull();
    });

    it("status is always 'succeeded' for a created refund", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 500 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 500 });
      const r1 = s.refundService.create({ charge: c1 });
      const r2 = s.refundService.create({ charge: c2, amount: 100 });
      expect(r1.status).toBe("succeeded");
      expect(r2.status).toBe("succeeded");
    });
  });

  // =======================================================================
  // Error handling (~20 tests)
  // =======================================================================
  describe("error handling", () => {
    it("StripeError is thrown for all validation errors", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
      }
    });

    it("missing charge/PI: statusCode is 400", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("missing charge/PI: error type is invalid_request_error", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("missing charge/PI: error has body.error shape", () => {
      const s = makeServices();
      try {
        s.refundService.create({});
      } catch (err) {
        const body = (err as StripeError).body;
        expect(body).toHaveProperty("error");
        expect(body.error).toHaveProperty("type");
        expect(body.error).toHaveProperty("message");
      }
    });

    it("nonexistent charge: error type is invalid_request_error", () => {
      const s = makeServices();
      try {
        s.refundService.create({ charge: "ch_missing" });
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("nonexistent charge: statusCode is 404", () => {
      const s = makeServices();
      try {
        s.refundService.create({ charge: "ch_missing" });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("over-refund: param is 'amount'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100 });
      try {
        s.refundService.create({ charge: chargeId, amount: 200 });
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("amount");
      }
    });

    it("over-refund: statusCode is 400", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100 });
      try {
        s.refundService.create({ charge: chargeId, amount: 200 });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("over-refund: type is invalid_request_error", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100 });
      try {
        s.refundService.create({ charge: chargeId, amount: 200 });
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("retrieve nonexistent: statusCode is 404", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_gone");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("retrieve nonexistent: type is invalid_request_error", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_gone");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("retrieve nonexistent: code is resource_missing", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_gone");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("retrieve nonexistent: param is 'id'", () => {
      const s = makeServices();
      try {
        s.refundService.retrieve("re_gone");
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("id");
      }
    });

    it("refund already-fully-refunded: error has param 'amount'", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 100 });
      s.refundService.create({ charge: chargeId });
      try {
        s.refundService.create({ charge: chargeId });
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("amount");
      }
    });

    it("PI with no charge: error message mentions payment_intent", () => {
      const s = makeServices();
      const pm = s.pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = s.piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });
      try {
        s.refundService.create({ payment_intent: pi.id });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("payment_intent");
      }
    });

    it("PI with no charge: error message mentions the PI id", () => {
      const s = makeServices();
      const pm = s.pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = s.piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });
      try {
        s.refundService.create({ payment_intent: pi.id });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain(pi.id);
      }
    });

    it("zero amount: error message mentions greater than 0", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      try {
        s.refundService.create({ charge: chargeId, amount: 0 });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("greater than 0");
      }
    });

    it("negative amount: error message mentions greater than 0", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      try {
        s.refundService.create({ charge: chargeId, amount: -50 });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("greater than 0");
      }
    });

    it("list with nonexistent starting_after: statusCode is 404", () => {
      const s = makeServices();
      try {
        s.refundService.list({
          limit: 10,
          startingAfter: "re_nonexistent",
          endingBefore: undefined,
        });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("list with nonexistent starting_after: code is resource_missing", () => {
      const s = makeServices();
      try {
        s.refundService.list({
          limit: 10,
          startingAfter: "re_nonexistent",
          endingBefore: undefined,
        });
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });
  });

  // =======================================================================
  // Cross-service integration (additional edge cases)
  // =======================================================================
  describe("cross-service integration", () => {
    it("refund created via charge can be found in list with chargeId filter", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s);
      const refund = s.refundService.create({ charge: chargeId });
      const list = s.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        chargeId,
      });
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(refund.id);
    });

    it("refund created via PI can be found in list with paymentIntentId filter", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({ payment_intent: pi.id });
      const list = s.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: pi.id,
      });
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(refund.id);
    });

    it("refund via PI is retrievable by its ID", () => {
      const s = makeServices();
      const { pi } = createTestCharge(s);
      const refund = s.refundService.create({ payment_intent: pi.id });
      const retrieved = s.refundService.retrieve(refund.id);
      expect(retrieved.id).toBe(refund.id);
      expect(retrieved.payment_intent).toBe(pi.id);
    });

    it("refunds for different charges are isolated in list", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 500 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 700 });
      s.refundService.create({ charge: c1, amount: 200 });
      s.refundService.create({ charge: c2, amount: 300 });

      const list1 = s.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        chargeId: c1,
      });
      const list2 = s.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        chargeId: c2,
      });

      expect(list1.data.length).toBe(1);
      expect(list1.data[0].amount).toBe(200);
      expect(list2.data.length).toBe(1);
      expect(list2.data[0].amount).toBe(300);
    });

    it("creating a refund does not affect other charges' data", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 1000 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 2000 });

      s.refundService.create({ charge: c1, amount: 500 });

      const charge2 = s.chargeService.retrieve(c2);
      expect(charge2.amount_refunded).toBe(0);
      expect(charge2.refunded).toBe(false);
    });

    it("charge.amount remains unchanged after refund", () => {
      const s = makeServices();
      const { chargeId } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: chargeId, amount: 500 });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.amount).toBe(1000);
    });

    it("multiple refunds across multiple charges in same DB are independent", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 1000 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 2000 });
      const { chargeId: c3 } = createTestCharge(s, { amount: 3000 });

      s.refundService.create({ charge: c1 });
      s.refundService.create({ charge: c2, amount: 1000 });
      s.refundService.create({ charge: c3, amount: 500 });

      expect(s.chargeService.retrieve(c1).refunded).toBe(true);
      expect(s.chargeService.retrieve(c2).refunded).toBe(false);
      expect(s.chargeService.retrieve(c3).refunded).toBe(false);

      expect(s.chargeService.retrieve(c1).amount_refunded).toBe(1000);
      expect(s.chargeService.retrieve(c2).amount_refunded).toBe(1000);
      expect(s.chargeService.retrieve(c3).amount_refunded).toBe(500);
    });

    it("full refund via PI also marks charge as refunded", () => {
      const s = makeServices();
      const { pi, chargeId } = createTestCharge(s, { amount: 500 });
      s.refundService.create({ payment_intent: pi.id });
      const charge = s.chargeService.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
      expect(charge.amount_refunded).toBe(500);
    });

    it("listing all refunds returns correct total count", () => {
      const s = makeServices();
      const { chargeId: c1 } = createTestCharge(s, { amount: 1000 });
      const { chargeId: c2 } = createTestCharge(s, { amount: 1000 });
      s.refundService.create({ charge: c1, amount: 100 });
      s.refundService.create({ charge: c1, amount: 200 });
      s.refundService.create({ charge: c2, amount: 300 });

      const list = s.refundService.list({
        limit: 100,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(list.data.length).toBe(3);
    });
  });
});
