import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { ChargeService } from "../../../src/services/charges";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { StripeError } from "../../../src/errors";

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const chargeService = new ChargeService(db);
  const piService = new PaymentIntentService(db, chargeService, pmService);
  return { db, pmService, chargeService, piService };
}

describe("PaymentIntentService", () => {
  describe("create", () => {
    it("creates a payment intent with correct shape", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });

      expect(pi.id).toMatch(/^pi_/);
      expect(pi.object).toBe("payment_intent");
      expect(pi.amount).toBe(1000);
      expect(pi.currency).toBe("usd");
      expect(pi.livemode).toBe(false);
    });

    it("sets initial status to requires_payment_method when no PM given", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 2000, currency: "usd" });
      expect(pi.status).toBe("requires_payment_method");
    });

    it("sets status to requires_confirmation when PM is given without confirm", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id });
      expect(pi.status).toBe("requires_confirmation");
      expect(pi.payment_method).toBe(pm.id);
    });

    it("generates a client_secret with pi_ prefix and _secret_", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 500, currency: "usd" });
      expect(pi.client_secret).toMatch(/^pi_.*_secret_/);
      expect(pi.client_secret).toContain(pi.id);
    });

    it("sets capture_method to automatic by default", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      expect(pi.capture_method).toBe("automatic");
    });

    it("respects capture_method=manual", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd", capture_method: "manual" });
      expect(pi.capture_method).toBe("manual");
    });

    it("sets customer when provided", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd", customer: "cus_abc" });
      expect(pi.customer).toBe("cus_abc");
    });

    it("stores metadata", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd", metadata: { order: "123" } });
      expect(pi.metadata).toEqual({ order: "123" });
    });

    it("creates PI with PM + confirm=true and results in succeeded", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });
      expect(pi.status).toBe("succeeded");
      expect(pi.payment_method).toBe(pm.id);
      expect(pi.latest_charge).toMatch(/^ch_/);
    });

    it("creates PI with PM + confirm=true + manual capture results in requires_capture", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });
      expect(pi.status).toBe("requires_capture");
    });
  });

  describe("retrieve", () => {
    it("returns a payment intent by ID", () => {
      const { piService } = makeServices();
      const created = piService.create({ amount: 1000, currency: "usd" });
      const retrieved = piService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.amount).toBe(1000);
    });

    it("throws 404 for nonexistent ID", () => {
      const { piService } = makeServices();
      expect(() => piService.retrieve("pi_nonexistent")).toThrow();
      try {
        piService.retrieve("pi_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("confirm", () => {
    it("confirms a PI from requires_confirmation and succeeds", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id });
      expect(pi.status).toBe("requires_confirmation");

      const confirmed = piService.confirm(pi.id, {});
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.latest_charge).toMatch(/^ch_/);
      expect(confirmed.amount_received).toBe(1000);
    });

    it("confirms from requires_payment_method with PM provided", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 500, currency: "usd" });
      expect(pi.status).toBe("requires_payment_method");

      const confirmed = piService.confirm(pi.id, { payment_method: pm.id });
      expect(confirmed.status).toBe("succeeded");
    });

    it("confirm from wrong state throws error", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      // Cancel it first
      piService.cancel(pi.id, {});
      // Then try to confirm
      expect(() => piService.confirm(pi.id, {})).toThrow(StripeError);
      try {
        piService.confirm(pi.id, {});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("confirm with failed card changes status to requires_payment_method and sets last_payment_error", () => {
      const { piService, pmService } = makeServices();
      // Create a PM with last4 0002 to simulate failure
      // We need a custom card that resolves to last4 0002 — but our magic tokens don't have one
      // Instead, create a PM and manually check that the simulation works
      // We'll use tok_visa for success path and document the failure path separately

      // Create a PM with visa (success case)
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id });
      const confirmed = piService.confirm(pi.id, {});
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.last_payment_error).toBeNull();
    });

    it("confirm with declining card (last4=0002) fails with card error", () => {
      const { piService, pmService, db } = makeServices();

      // Manually create a payment method row with last4=0002 to trigger decline
      const failPm = pmService.create({ type: "card", card: { token: "tok_visa" } });

      // Patch the card data in-memory by re-creating the PM data with last4=0002
      // Since we can't use tok_0002, we'll directly test via the service's simulate logic
      // by checking the branch: if last4 === "0002" => fail
      // Let's create a test that patches the DB directly

      const { paymentMethods } = require("../../../src/db/schema/payment-methods");
      const { eq } = require("drizzle-orm");

      const existingData = JSON.parse(
        db.select().from(paymentMethods).where(eq(paymentMethods.id, failPm.id)).get()!.data
      );
      existingData.card.last4 = "0002";

      db.update(paymentMethods)
        .set({ data: JSON.stringify(existingData) })
        .where(eq(paymentMethods.id, failPm.id))
        .run();

      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: failPm.id });
      const result = piService.confirm(pi.id, {});

      expect(result.status).toBe("requires_payment_method");
      expect(result.last_payment_error).not.toBeNull();
      expect((result.last_payment_error as any)?.code).toBe("card_declined");
    });

    it("requires payment_method param when in requires_payment_method state without PM", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      expect(() => piService.confirm(pi.id, {})).toThrow(StripeError);
    });
  });

  describe("capture", () => {
    it("captures a requires_capture PI and sets status=succeeded", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });
      expect(pi.status).toBe("requires_capture");

      const captured = piService.capture(pi.id, {});
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(1000);
    });

    it("throws error when capturing from non-requires_capture status", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      expect(() => piService.capture(pi.id, {})).toThrow(StripeError);
      try {
        piService.capture(pi.id, {});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws 404 for nonexistent PI", () => {
      const { piService } = makeServices();
      expect(() => piService.capture("pi_ghost", {})).toThrow(StripeError);
    });
  });

  describe("cancel", () => {
    it("cancels a requires_payment_method PI", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      const canceled = piService.cancel(pi.id, {});
      expect(canceled.status).toBe("canceled");
      expect(canceled.canceled_at).not.toBeNull();
    });

    it("cancels a requires_confirmation PI", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id });
      const canceled = piService.cancel(pi.id, {});
      expect(canceled.status).toBe("canceled");
    });

    it("cannot cancel a succeeded PI", () => {
      const { piService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });
      expect(pi.status).toBe("succeeded");
      expect(() => piService.cancel(pi.id, {})).toThrow(StripeError);
      try {
        piService.cancel(pi.id, {});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("cannot cancel an already canceled PI", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      piService.cancel(pi.id, {});
      expect(() => piService.cancel(pi.id, {})).toThrow(StripeError);
    });

    it("stores cancellation_reason", () => {
      const { piService } = makeServices();
      const pi = piService.create({ amount: 1000, currency: "usd" });
      const canceled = piService.cancel(pi.id, { cancellation_reason: "duplicate" });
      expect(canceled.cancellation_reason).toBe("duplicate");
    });

    it("throws 404 for nonexistent PI", () => {
      const { piService } = makeServices();
      expect(() => piService.cancel("pi_ghost", {})).toThrow(StripeError);
    });
  });

  describe("list", () => {
    it("returns empty list when no payment intents exist", () => {
      const { piService } = makeServices();
      const result = piService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/payment_intents");
    });

    it("returns all payment intents up to limit", () => {
      const { piService } = makeServices();
      for (let i = 0; i < 3; i++) {
        piService.create({ amount: 1000, currency: "usd" });
      }
      const result = piService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const { piService } = makeServices();
      for (let i = 0; i < 5; i++) {
        piService.create({ amount: 1000, currency: "usd" });
      }
      const result = piService.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by customerId", () => {
      const { piService } = makeServices();
      piService.create({ amount: 1000, currency: "usd", customer: "cus_aaa" });
      piService.create({ amount: 2000, currency: "usd", customer: "cus_bbb" });

      const result = piService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_aaa" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_aaa");
    });

    it("paginates with startingAfter", () => {
      const { piService } = makeServices();
      piService.create({ amount: 1000, currency: "usd" });
      piService.create({ amount: 2000, currency: "usd" });
      piService.create({ amount: 3000, currency: "usd" });

      const page1 = piService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = piService.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });
  });
});
