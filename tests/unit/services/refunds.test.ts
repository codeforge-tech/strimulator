import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { ChargeService } from "../../../src/services/charges";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { RefundService } from "../../../src/services/refunds";
import { StripeError } from "../../../src/errors";

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const chargeService = new ChargeService(db);
  const piService = new PaymentIntentService(db, chargeService, pmService);
  const refundService = new RefundService(db, chargeService);
  return { db, pmService, chargeService, piService, refundService };
}

function makeSucceededCharge(services: ReturnType<typeof makeServices>) {
  const { pmService, piService } = services;
  const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
  const pi = piService.create({
    amount: 1000,
    currency: "usd",
    payment_method: pm.id,
    confirm: true,
  });
  expect(pi.status).toBe("succeeded");
  // latest_charge is set on the PI
  return { pi, chargeId: pi.latest_charge as string };
}

describe("RefundService", () => {
  describe("create", () => {
    it("creates a full refund by charge ID", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      const refund = services.refundService.create({ charge: chargeId });

      expect(refund.id).toMatch(/^re_/);
      expect(refund.object).toBe("refund");
      expect(refund.amount).toBe(1000);
      expect(refund.status).toBe("succeeded");
      expect(refund.charge).toBe(chargeId);
      expect(refund.currency).toBe("usd");
    });

    it("creates a partial refund", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      const refund = services.refundService.create({ charge: chargeId, amount: 400 });

      expect(refund.amount).toBe(400);
      expect(refund.status).toBe("succeeded");
    });

    it("updates the charge refunded_amount and refunded flag on full refund", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      services.refundService.create({ charge: chargeId });

      const updatedCharge = services.chargeService.retrieve(chargeId);
      expect(updatedCharge.amount_refunded).toBe(1000);
      expect(updatedCharge.refunded).toBe(true);
    });

    it("updates the charge refunded_amount (partial) without setting refunded=true", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      services.refundService.create({ charge: chargeId, amount: 300 });

      const updatedCharge = services.chargeService.retrieve(chargeId);
      expect(updatedCharge.amount_refunded).toBe(300);
      expect(updatedCharge.refunded).toBe(false);
    });

    it("allows multiple partial refunds up to the charge amount", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      services.refundService.create({ charge: chargeId, amount: 600 });
      services.refundService.create({ charge: chargeId, amount: 400 });

      const updatedCharge = services.chargeService.retrieve(chargeId);
      expect(updatedCharge.amount_refunded).toBe(1000);
      expect(updatedCharge.refunded).toBe(true);
    });

    it("throws when refund amount exceeds refundable amount", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      expect(() =>
        services.refundService.create({ charge: chargeId, amount: 1500 })
      ).toThrow(StripeError);

      try {
        services.refundService.create({ charge: chargeId, amount: 1500 });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws when partial refund + new refund exceeds total", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      services.refundService.create({ charge: chargeId, amount: 800 });

      expect(() =>
        services.refundService.create({ charge: chargeId, amount: 300 })
      ).toThrow(StripeError);
    });

    it("throws when neither charge nor payment_intent provided", () => {
      const services = makeServices();
      expect(() => services.refundService.create({})).toThrow(StripeError);
      try {
        services.refundService.create({});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("creates refund by payment_intent", () => {
      const services = makeServices();
      const { pi, chargeId } = makeSucceededCharge(services);

      const refund = services.refundService.create({ payment_intent: pi.id });

      expect(refund.amount).toBe(1000);
      expect(refund.charge).toBe(chargeId);
      expect(refund.payment_intent).toBe(pi.id);
    });

    it("stores metadata", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      const refund = services.refundService.create({
        charge: chargeId,
        metadata: { reason_code: "customer_request" },
      });

      expect(refund.metadata).toEqual({ reason_code: "customer_request" });
    });

    it("stores reason", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      const refund = services.refundService.create({ charge: chargeId, reason: "duplicate" });

      expect(refund.reason).toBe("duplicate");
    });

    it("throws 404 for nonexistent charge", () => {
      const services = makeServices();
      expect(() =>
        services.refundService.create({ charge: "ch_nonexistent" })
      ).toThrow(StripeError);
      try {
        services.refundService.create({ charge: "ch_nonexistent" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("retrieve", () => {
    it("returns a refund by ID", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      const created = services.refundService.create({ charge: chargeId });
      const retrieved = services.refundService.retrieve(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.amount).toBe(1000);
    });

    it("throws 404 for nonexistent refund", () => {
      const services = makeServices();
      expect(() => services.refundService.retrieve("re_nonexistent")).toThrow(StripeError);
      try {
        services.refundService.retrieve("re_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("list", () => {
    it("returns empty list when no refunds exist", () => {
      const services = makeServices();
      const result = services.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/refunds");
    });

    it("returns all refunds up to limit", () => {
      const services = makeServices();
      const { chargeId } = makeSucceededCharge(services);

      services.refundService.create({ charge: chargeId, amount: 100 });
      services.refundService.create({ charge: chargeId, amount: 200 });

      const result = services.refundService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });

    it("respects limit with has_more", () => {
      const services = makeServices();
      // Create 2 separate charges to get 2 separate refunds
      const { chargeId: cid1 } = makeSucceededCharge(services);
      const { chargeId: cid2 } = makeSucceededCharge(services);
      const { chargeId: cid3 } = makeSucceededCharge(services);

      services.refundService.create({ charge: cid1 });
      services.refundService.create({ charge: cid2 });
      services.refundService.create({ charge: cid3 });

      const result = services.refundService.list({
        limit: 2,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(true);
    });
  });
});
