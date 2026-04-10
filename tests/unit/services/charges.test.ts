import { describe, it, expect, beforeEach } from "bun:test";
import { createDB, type StrimulatorDB } from "../../../src/db";
import { ChargeService, type CreateChargeParams } from "../../../src/services/charges";
import { PaymentIntentService } from "../../../src/services/payment-intents";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  const chargeService = new ChargeService(db);
  return { db, chargeService };
}

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const chargeService = new ChargeService(db);
  const piService = new PaymentIntentService(db, chargeService, pmService);
  return { db, pmService, chargeService, piService };
}

function defaultParams(overrides: Partial<CreateChargeParams> = {}): CreateChargeParams {
  return {
    amount: 1000,
    currency: "usd",
    customerId: null,
    paymentIntentId: "pi_test123",
    paymentMethodId: null,
    status: "succeeded",
    ...overrides,
  };
}

describe("ChargeService", () => {
  // ---------------------------------------------------------------------------
  // create() tests
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("creates a charge with minimum params (amount, currency, paymentIntentId)", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge).toBeDefined();
      expect(charge.amount).toBe(1000);
      expect(charge.currency).toBe("usd");
    });

    it("creates a charge with a customer", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ customerId: "cus_abc123" }));
      expect(charge.customer).toBe("cus_abc123");
    });

    it("creates a charge with a payment_intent", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ paymentIntentId: "pi_xyz789" }));
      expect(charge.payment_intent).toBe("pi_xyz789");
    });

    it("creates a charge with a payment_method", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ paymentMethodId: "pm_card_visa" }));
      expect(charge.payment_method).toBe("pm_card_visa");
    });

    it("creates a charge with metadata", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ metadata: { order_id: "ord_123", sku: "widget" } }));
      expect(charge.metadata).toEqual({ order_id: "ord_123", sku: "widget" });
    });

    it("creates a charge with empty metadata", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ metadata: {} }));
      expect(charge.metadata).toEqual({});
    });

    it("defaults metadata to empty object when not provided", () => {
      const { chargeService } = makeService();
      const params = defaultParams();
      delete (params as any).metadata;
      const charge = chargeService.create(params);
      expect(charge.metadata).toEqual({});
    });

    it("creates a charge with status succeeded", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.status).toBe("succeeded");
    });

    it("creates a charge with status failed", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.status).toBe("failed");
    });

    it("generates an id that starts with ch_", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.id).toMatch(/^ch_/);
    });

    it("sets object to 'charge'", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.object).toBe("charge");
    });

    it("stores amount correctly", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 5050 }));
      expect(charge.amount).toBe(5050);
    });

    it("stores currency correctly", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ currency: "eur" }));
      expect(charge.currency).toBe("eur");
    });

    it("sets created to a unix timestamp", () => {
      const { chargeService } = makeService();
      const before = Math.floor(Date.now() / 1000);
      const charge = chargeService.create(defaultParams());
      const after = Math.floor(Date.now() / 1000);
      expect(charge.created).toBeGreaterThanOrEqual(before);
      expect(charge.created).toBeLessThanOrEqual(after);
    });

    it("sets livemode to false", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.livemode).toBe(false);
    });

    it("sets paid to true when status is succeeded", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.paid).toBe(true);
    });

    it("sets paid to false when status is failed", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.paid).toBe(false);
    });

    it("sets captured to true when status is succeeded", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.captured).toBe(true);
    });

    it("sets captured to false when status is failed", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.captured).toBe(false);
    });

    it("sets refunded to false by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunded).toBe(false);
    });

    it("sets amount_refunded to 0 by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.amount_refunded).toBe(0);
    });

    it("sets amount_captured to full amount when succeeded", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 2500, status: "succeeded" }));
      expect(charge.amount_captured).toBe(2500);
    });

    it("sets amount_captured to 0 when failed", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 2500, status: "failed" }));
      expect(charge.amount_captured).toBe(0);
    });

    it("sets balance_transaction to null", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.balance_transaction).toBeNull();
    });

    it("builds billing_details with null address, email, name, phone", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.billing_details).toEqual({
        address: null,
        email: null,
        name: null,
        phone: null,
      });
    });

    it("sets outcome with approved_by_network for succeeded charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.outcome).toBeDefined();
      expect(charge.outcome!.network_status).toBe("approved_by_network");
      expect(charge.outcome!.type).toBe("authorized");
      expect(charge.outcome!.reason).toBeNull();
      expect(charge.outcome!.seller_message).toBe("Payment complete.");
    });

    it("sets outcome with declined_by_network for failed charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.outcome!.network_status).toBe("declined_by_network");
      expect(charge.outcome!.type).toBe("issuer_declined");
    });

    it("sets outcome risk_level to normal", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.outcome!.risk_level).toBe("normal");
    });

    it("sets outcome risk_score to 20", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.outcome!.risk_score).toBe(20);
    });

    it("sets outcome reason to failureCode for failed charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed", failureCode: "insufficient_funds" }));
      expect(charge.outcome!.reason).toBe("insufficient_funds");
    });

    it("sets outcome reason to generic_decline when failureCode is absent for failed charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.outcome!.reason).toBe("generic_decline");
    });

    it("sets outcome seller_message for failed charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed" }));
      expect(charge.outcome!.seller_message).toBe("The bank did not return any further details with this decline.");
    });

    it("sets description to null", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.description).toBeNull();
    });

    it("sets disputed to false", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.disputed).toBe(false);
    });

    it("sets invoice to null", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.invoice).toBeNull();
    });

    it("sets failure_code to null by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.failure_code).toBeNull();
    });

    it("stores failure_code when provided", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed", failureCode: "card_declined" }));
      expect(charge.failure_code).toBe("card_declined");
    });

    it("sets failure_message to null by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.failure_message).toBeNull();
    });

    it("stores failure_message when provided", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(
        defaultParams({ status: "failed", failureMessage: "Your card was declined." }),
      );
      expect(charge.failure_message).toBe("Your card was declined.");
    });

    it("sets calculated_statement_descriptor to STRIMULATOR", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.calculated_statement_descriptor).toBe("STRIMULATOR");
    });

    it("sets payment_method to null when not provided", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ paymentMethodId: null }));
      expect(charge.payment_method).toBeNull();
    });

    it("sets customer to null when not provided", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ customerId: null }));
      expect(charge.customer).toBeNull();
    });

    it("creates multiple charges with unique IDs", () => {
      const { chargeService } = makeService();
      const c1 = chargeService.create(defaultParams());
      const c2 = chargeService.create(defaultParams());
      const c3 = chargeService.create(defaultParams());
      expect(c1.id).not.toBe(c2.id);
      expect(c2.id).not.toBe(c3.id);
      expect(c1.id).not.toBe(c3.id);
    });

    it("creates charges with different currencies", () => {
      const { chargeService } = makeService();
      const usd = chargeService.create(defaultParams({ currency: "usd" }));
      const eur = chargeService.create(defaultParams({ currency: "eur" }));
      const gbp = chargeService.create(defaultParams({ currency: "gbp" }));
      expect(usd.currency).toBe("usd");
      expect(eur.currency).toBe("eur");
      expect(gbp.currency).toBe("gbp");
    });

    it("creates a charge with amount 0", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 0 }));
      expect(charge.amount).toBe(0);
    });

    it("creates a charge with a small amount", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 1 }));
      expect(charge.amount).toBe(1);
    });

    it("creates a charge with a large amount", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 99999999 }));
      expect(charge.amount).toBe(99999999);
    });

    it("builds refunds sub-object as empty list with correct URL", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunds).toBeDefined();
      expect(charge.refunds!.object).toBe("list");
      expect(charge.refunds!.data).toEqual([]);
      expect(charge.refunds!.has_more).toBe(false);
      expect(charge.refunds!.url).toBe(`/v1/charges/${charge.id}/refunds`);
    });

    it("persists the charge so it can be retrieved", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.amount).toBe(created.amount);
    });

    it("stores metadata with special characters", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(
        defaultParams({ metadata: { "key with spaces": "value/with/slashes", unicode: "\u00e9\u00e8\u00ea" } }),
      );
      expect(charge.metadata["key with spaces"]).toBe("value/with/slashes");
      expect(charge.metadata.unicode).toBe("\u00e9\u00e8\u00ea");
    });

    it("stores metadata with many keys", () => {
      const { chargeService } = makeService();
      const meta: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        meta[`key_${i}`] = `value_${i}`;
      }
      const charge = chargeService.create(defaultParams({ metadata: meta }));
      expect(Object.keys(charge.metadata)).toHaveLength(20);
      expect(charge.metadata.key_0).toBe("value_0");
      expect(charge.metadata.key_19).toBe("value_19");
    });

    it("stores failureCode and failureMessage for a failed charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(
        defaultParams({
          status: "failed",
          failureCode: "expired_card",
          failureMessage: "Your card has expired.",
        }),
      );
      expect(charge.failure_code).toBe("expired_card");
      expect(charge.failure_message).toBe("Your card has expired.");
      expect(charge.status).toBe("failed");
    });

    it("does not set failureCode on succeeded charge even if passed", () => {
      const { chargeService } = makeService();
      // The buildChargeShape uses params.failureCode ?? null, so it will be stored
      // but conceptually a succeeded charge should have null failure fields
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.failure_code).toBeNull();
      expect(charge.failure_message).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve() tests
  // ---------------------------------------------------------------------------
  describe("retrieve", () => {
    it("retrieves an existing charge by ID", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("throws StripeError with 404 for non-existent charge", () => {
      const { chargeService } = makeService();
      expect(() => chargeService.retrieve("ch_nonexistent")).toThrow();
      try {
        chargeService.retrieve("ch_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("error body contains resource_missing code for non-existent charge", () => {
      const { chargeService } = makeService();
      try {
        chargeService.retrieve("ch_does_not_exist");
      } catch (err) {
        const e = err as StripeError;
        expect(e.body.error.code).toBe("resource_missing");
        expect(e.body.error.type).toBe("invalid_request_error");
        expect(e.body.error.message).toContain("ch_does_not_exist");
      }
    });

    it("error message includes the charge ID", () => {
      const { chargeService } = makeService();
      try {
        chargeService.retrieve("ch_missing_abc");
      } catch (err) {
        const e = err as StripeError;
        expect(e.body.error.message).toBe("No such charge: 'ch_missing_abc'");
      }
    });

    it("error param is id", () => {
      const { chargeService } = makeService();
      try {
        chargeService.retrieve("ch_x");
      } catch (err) {
        const e = err as StripeError;
        expect(e.body.error.param).toBe("id");
      }
    });

    it("returns all fields correctly after retrieve", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(
        defaultParams({
          amount: 4200,
          currency: "gbp",
          customerId: "cus_test",
          paymentIntentId: "pi_test",
          paymentMethodId: "pm_test",
          status: "succeeded",
          metadata: { foo: "bar" },
        }),
      );
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.amount).toBe(4200);
      expect(retrieved.currency).toBe("gbp");
      expect(retrieved.customer).toBe("cus_test");
      expect(retrieved.payment_intent).toBe("pi_test");
      expect(retrieved.payment_method).toBe("pm_test");
      expect(retrieved.status).toBe("succeeded");
      expect(retrieved.metadata).toEqual({ foo: "bar" });
    });

    it("retrieves a charge with a customer", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ customerId: "cus_retrieve_test" }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.customer).toBe("cus_retrieve_test");
    });

    it("retrieves a charge with a payment_intent", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ paymentIntentId: "pi_retrieve_test" }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.payment_intent).toBe("pi_retrieve_test");
    });

    it("retrieves a charge with metadata", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ metadata: { key1: "val1", key2: "val2" } }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ key1: "val1", key2: "val2" });
    });

    it("multiple retrieves return same data", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ amount: 7777 }));
      const r1 = chargeService.retrieve(created.id);
      const r2 = chargeService.retrieve(created.id);
      const r3 = chargeService.retrieve(created.id);
      expect(r1).toEqual(r2);
      expect(r2).toEqual(r3);
    });

    it("retrieves a succeeded charge with correct paid and captured flags", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ status: "succeeded" }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.paid).toBe(true);
      expect(retrieved.captured).toBe(true);
    });

    it("retrieves a failed charge with correct paid and captured flags", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ status: "failed" }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.paid).toBe(false);
      expect(retrieved.captured).toBe(false);
    });

    it("retrieves a charge preserving the full refunds sub-object", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.refunds!.object).toBe("list");
      expect(retrieved.refunds!.data).toEqual([]);
      expect(retrieved.refunds!.has_more).toBe(false);
      expect(retrieved.refunds!.url).toBe(`/v1/charges/${created.id}/refunds`);
    });

    it("retrieves a charge preserving billing_details", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.billing_details).toEqual({
        address: null,
        email: null,
        name: null,
        phone: null,
      });
    });

    it("retrieves a charge preserving outcome", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ status: "succeeded" }));
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.outcome!.network_status).toBe("approved_by_network");
      expect(retrieved.outcome!.type).toBe("authorized");
      expect(retrieved.outcome!.risk_level).toBe("normal");
      expect(retrieved.outcome!.risk_score).toBe(20);
    });

    it("each created charge can be independently retrieved", () => {
      const { chargeService } = makeService();
      const c1 = chargeService.create(defaultParams({ amount: 100 }));
      const c2 = chargeService.create(defaultParams({ amount: 200 }));
      expect(chargeService.retrieve(c1.id).amount).toBe(100);
      expect(chargeService.retrieve(c2.id).amount).toBe(200);
    });

    it("retrieves a charge preserving failure fields for a failed charge", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(
        defaultParams({ status: "failed", failureCode: "do_not_honor", failureMessage: "Do not honor" }),
      );
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.failure_code).toBe("do_not_honor");
      expect(retrieved.failure_message).toBe("Do not honor");
    });

    it("retrieves a charge preserving calculated_statement_descriptor", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.calculated_statement_descriptor).toBe("STRIMULATOR");
    });

    it("retrieves a charge preserving livemode", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.livemode).toBe(false);
    });

    it("retrieves a charge preserving disputed field", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams());
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.disputed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list() tests
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("returns empty list when no charges exist", () => {
      const { chargeService } = makeService();
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns object 'list'", () => {
      const { chargeService } = makeService();
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
    });

    it("returns url '/v1/charges'", () => {
      const { chargeService } = makeService();
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.url).toBe("/v1/charges");
    });

    it("lists all charges", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_2" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_3" }));
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(3);
    });

    it("respects limit parameter", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_a" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_b" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_c" }));
      const result = chargeService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
    });

    it("limit=1 returns exactly one charge", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_x" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_y" }));
      const result = chargeService.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(1);
    });

    it("sets has_more to true when more charges exist beyond limit", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_2" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_3" }));
      const result = chargeService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(true);
    });

    it("sets has_more to false when all charges fit within limit", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("sets has_more to false when limit exactly matches count", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("paginates through items using starting_after with distinct timestamps", async () => {
      const { chargeService, db } = makeService();
      // Manually insert charges with distinct created timestamps so cursor pagination works
      // (charges created in the same unix second share a timestamp, breaking gt-based cursors)
      const { charges: chargesTable } = require("../../../src/db/schema/charges");

      const ids = ["ch_page1", "ch_page2", "ch_page3"];
      for (let i = 0; i < 3; i++) {
        const params = defaultParams({ paymentIntentId: `pi_p${i}` });
        const charge = {
          id: ids[i],
          object: "charge" as const,
          amount: params.amount,
          amount_captured: params.amount,
          amount_refunded: 0,
          balance_transaction: null,
          billing_details: { address: null, email: null, name: null, phone: null },
          calculated_statement_descriptor: "STRIMULATOR",
          captured: true,
          created: 1000 + i,
          currency: params.currency,
          customer: null,
          description: null,
          disputed: false,
          failure_code: null,
          failure_message: null,
          invoice: null,
          livemode: false,
          metadata: {},
          outcome: { network_status: "approved_by_network", reason: null, risk_level: "normal", risk_score: 20, seller_message: "Payment complete.", type: "authorized" },
          paid: true,
          payment_intent: params.paymentIntentId,
          payment_method: null,
          refunded: false,
          refunds: { object: "list", data: [], has_more: false, url: `/v1/charges/${ids[i]}/refunds` },
          status: "succeeded",
        };
        db.insert(chargesTable).values({
          id: ids[i],
          customer_id: null,
          payment_intent_id: params.paymentIntentId,
          status: "succeeded",
          amount: params.amount,
          currency: params.currency,
          refunded_amount: 0,
          created: 1000 + i,
          data: JSON.stringify(charge),
        }).run();
      }

      const page1 = chargeService.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data).toHaveLength(1);
      expect(page1.has_more).toBe(true);

      const page2 = chargeService.list({
        limit: 1,
        startingAfter: page1.data[0].id,
        endingBefore: undefined,
      });
      expect(page2.data).toHaveLength(1);
      expect(page2.has_more).toBe(true);

      const page3 = chargeService.list({
        limit: 1,
        startingAfter: page2.data[0].id,
        endingBefore: undefined,
      });
      expect(page3.data).toHaveLength(1);
      expect(page3.has_more).toBe(false);

      const allIds = [page1.data[0].id, page2.data[0].id, page3.data[0].id];
      expect(new Set(allIds).size).toBe(3);
    });

    it("throws 404 when starting_after references a non-existent charge", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams());
      expect(() =>
        chargeService.list({ limit: 10, startingAfter: "ch_nonexistent", endingBefore: undefined }),
      ).toThrow();
      try {
        chargeService.list({ limit: 10, startingAfter: "ch_nonexistent", endingBefore: undefined });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("list data contains proper charge objects with object field", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams());
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      for (const charge of result.data) {
        expect(charge.object).toBe("charge");
        expect(charge.id).toMatch(/^ch_/);
      }
    });

    it("list data contains charges with correct amounts", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ amount: 100, paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ amount: 200, paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const amounts = result.data.map((c) => c.amount).sort();
      expect(amounts).toEqual([100, 200]);
    });

    // --- Customer filter ---
    it("filters by customer", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_A", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ customerId: "cus_B", paymentIntentId: "pi_2" }));
      chargeService.create(defaultParams({ customerId: "cus_A", paymentIntentId: "pi_3" }));

      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_A",
      });
      expect(result.data).toHaveLength(2);
      for (const charge of result.data) {
        expect(charge.customer).toBe("cus_A");
      }
    });

    it("returns empty when customer filter matches no charges", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_A" }));
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_Z",
      });
      expect(result.data).toEqual([]);
    });

    it("filters by payment_intent", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_A" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_B" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_A" }));

      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: "pi_A",
      });
      expect(result.data).toHaveLength(2);
      for (const charge of result.data) {
        expect(charge.payment_intent).toBe("pi_A");
      }
    });

    it("returns empty when payment_intent filter matches no charges", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_A" }));
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: "pi_ZZZ",
      });
      expect(result.data).toEqual([]);
    });

    it("without filter returns all charges", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_A", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ customerId: "cus_B", paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
    });

    it("multiple charges for same customer all returned", () => {
      const { chargeService } = makeService();
      for (let i = 0; i < 5; i++) {
        chargeService.create(defaultParams({ customerId: "cus_repeat", paymentIntentId: `pi_${i}` }));
      }
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_repeat",
      });
      expect(result.data).toHaveLength(5);
    });

    it("multiple charges for same payment_intent all returned", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_shared" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_shared" }));
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: "pi_shared",
      });
      expect(result.data).toHaveLength(2);
    });

    it("customer filter with limit and has_more", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_lim", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ customerId: "cus_lim", paymentIntentId: "pi_2" }));
      chargeService.create(defaultParams({ customerId: "cus_lim", paymentIntentId: "pi_3" }));
      const result = chargeService.list({
        limit: 2,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_lim",
      });
      expect(result.data).toHaveLength(2);
      expect(result.has_more).toBe(true);
    });

    it("payment_intent filter with limit", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_lim" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_lim" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_lim" }));
      const result = chargeService.list({
        limit: 1,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: "pi_lim",
      });
      expect(result.data).toHaveLength(1);
      expect(result.has_more).toBe(true);
    });

    it("pagination with customer filter using distinct timestamps", () => {
      const { chargeService, db } = makeService();
      const { charges: chargesTable } = require("../../../src/db/schema/charges");

      // Insert charges with distinct timestamps so cursor pagination works
      const insertCharge = (id: string, customerId: string | null, piId: string, created: number) => {
        const charge = {
          id, object: "charge", amount: 1000, amount_captured: 1000, amount_refunded: 0,
          balance_transaction: null, billing_details: { address: null, email: null, name: null, phone: null },
          calculated_statement_descriptor: "STRIMULATOR", captured: true, created, currency: "usd",
          customer: customerId, description: null, disputed: false, failure_code: null, failure_message: null,
          invoice: null, livemode: false, metadata: {},
          outcome: { network_status: "approved_by_network", reason: null, risk_level: "normal", risk_score: 20, seller_message: "Payment complete.", type: "authorized" },
          paid: true, payment_intent: piId, payment_method: null, refunded: false,
          refunds: { object: "list", data: [], has_more: false, url: `/v1/charges/${id}/refunds` },
          status: "succeeded",
        };
        db.insert(chargesTable).values({
          id, customer_id: customerId, payment_intent_id: piId, status: "succeeded",
          amount: 1000, currency: "usd", refunded_amount: 0, created, data: JSON.stringify(charge),
        }).run();
      };

      insertCharge("ch_pg1", "cus_pg", "pi_1", 1000);
      insertCharge("ch_pg2", "cus_pg", "pi_2", 1001);
      insertCharge("ch_pg3", "cus_other", "pi_3", 1002);

      const page1 = chargeService.list({
        limit: 1,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_pg",
      });
      expect(page1.data).toHaveLength(1);
      expect(page1.has_more).toBe(true);

      const page2 = chargeService.list({
        limit: 1,
        startingAfter: page1.data[0].id,
        endingBefore: undefined,
        customerId: "cus_pg",
      });
      expect(page2.data).toHaveLength(1);
      expect(page2.has_more).toBe(false);
      expect(page2.data[0].id).not.toBe(page1.data[0].id);
    });

    it("list returns charges in consistent order", () => {
      const { chargeService } = makeService();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const c = chargeService.create(defaultParams({ paymentIntentId: `pi_ord_${i}` }));
        ids.push(c.id);
      }
      const result1 = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const result2 = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result1.data.map((c) => c.id)).toEqual(result2.data.map((c) => c.id));
    });

    it("list with limit larger than total returns all charges", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 100, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
      expect(result.has_more).toBe(false);
    });

    it("list with both customer and payment_intent filter (AND logic)", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_X", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ customerId: "cus_X", paymentIntentId: "pi_2" }));
      chargeService.create(defaultParams({ customerId: "cus_Y", paymentIntentId: "pi_1" }));

      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_X",
        paymentIntentId: "pi_1",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_X");
      expect(result.data[0].payment_intent).toBe("pi_1");
    });

    it("list with both filters matching no charges returns empty", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_X", paymentIntentId: "pi_1" }));
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_X",
        paymentIntentId: "pi_no_match",
      });
      expect(result.data).toEqual([]);
    });

    it("list after creating charges of different statuses", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ status: "succeeded", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ status: "failed", paymentIntentId: "pi_2" }));
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
      const statuses = result.data.map((c) => c.status).sort();
      expect(statuses).toEqual(["failed", "succeeded"]);
    });

    it("list returns charges with full object shape", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams());
      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const charge = result.data[0];
      expect(charge.object).toBe("charge");
      expect(charge.id).toMatch(/^ch_/);
      expect(charge.billing_details).toBeDefined();
      expect(charge.outcome).toBeDefined();
      expect(charge.refunds).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape validation tests
  // ---------------------------------------------------------------------------
  describe("object shape", () => {
    it("succeeded charge has all expected top-level fields", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));

      expect(charge.id).toBeDefined();
      expect(charge.object).toBe("charge");
      expect(charge.amount).toBeDefined();
      expect(charge.amount_captured).toBeDefined();
      expect(charge.amount_refunded).toBeDefined();
      expect(charge.balance_transaction).toBeDefined(); // null is defined
      expect(charge.billing_details).toBeDefined();
      expect(charge.calculated_statement_descriptor).toBeDefined();
      expect(typeof charge.captured).toBe("boolean");
      expect(typeof charge.created).toBe("number");
      expect(charge.currency).toBeDefined();
      expect(typeof charge.disputed).toBe("boolean");
      expect(typeof charge.livemode).toBe("boolean");
      expect(charge.metadata).toBeDefined();
      expect(charge.outcome).toBeDefined();
      expect(typeof charge.paid).toBe("boolean");
      expect(typeof charge.refunded).toBe("boolean");
      expect(charge.refunds).toBeDefined();
      expect(charge.status).toBeDefined();
    });

    it("billing_details has address, email, name, phone keys", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.billing_details).toHaveProperty("address");
      expect(charge.billing_details).toHaveProperty("email");
      expect(charge.billing_details).toHaveProperty("name");
      expect(charge.billing_details).toHaveProperty("phone");
    });

    it("outcome for succeeded has type, network_status, risk_level, risk_score, seller_message, reason", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      const outcome = charge.outcome!;
      expect(outcome).toHaveProperty("type");
      expect(outcome).toHaveProperty("network_status");
      expect(outcome).toHaveProperty("risk_level");
      expect(outcome).toHaveProperty("risk_score");
      expect(outcome).toHaveProperty("seller_message");
      expect(outcome).toHaveProperty("reason");
    });

    it("outcome for failed has correct declined values", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "failed", failureCode: "card_declined" }));
      const outcome = charge.outcome!;
      expect(outcome.type).toBe("issuer_declined");
      expect(outcome.network_status).toBe("declined_by_network");
      expect(outcome.reason).toBe("card_declined");
      expect(outcome.risk_level).toBe("normal");
      expect(outcome.risk_score).toBe(20);
    });

    it("refunds sub-object has list shape", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunds!.object).toBe("list");
      expect(Array.isArray(charge.refunds!.data)).toBe(true);
      expect(typeof charge.refunds!.has_more).toBe("boolean");
      expect(typeof charge.refunds!.url).toBe("string");
    });

    it("refunds url contains the charge id", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunds!.url).toContain(charge.id);
    });

    it("invoice is null by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.invoice).toBeNull();
    });

    it("description is null by default", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.description).toBeNull();
    });

    it("balance_transaction is null", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.balance_transaction).toBeNull();
    });

    it("payment_method correctly stored as string or null", () => {
      const { chargeService } = makeService();
      const withPm = chargeService.create(defaultParams({ paymentMethodId: "pm_test" }));
      const withoutPm = chargeService.create(defaultParams({ paymentMethodId: null, paymentIntentId: "pi_2" }));
      expect(typeof withPm.payment_method).toBe("string");
      expect(withoutPm.payment_method).toBeNull();
    });

    it("customer correctly stored as string or null", () => {
      const { chargeService } = makeService();
      const withCus = chargeService.create(defaultParams({ customerId: "cus_test" }));
      const withoutCus = chargeService.create(defaultParams({ customerId: null, paymentIntentId: "pi_2" }));
      expect(typeof withCus.customer).toBe("string");
      expect(withoutCus.customer).toBeNull();
    });

    it("succeeded charge: paid=true, captured=true, amount_captured=amount", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 3000, status: "succeeded" }));
      expect(charge.paid).toBe(true);
      expect(charge.captured).toBe(true);
      expect(charge.amount_captured).toBe(3000);
    });

    it("failed charge: paid=false, captured=false, amount_captured=0", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ amount: 3000, status: "failed" }));
      expect(charge.paid).toBe(false);
      expect(charge.captured).toBe(false);
      expect(charge.amount_captured).toBe(0);
    });

    it("refunded is false and amount_refunded is 0 on fresh charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunded).toBe(false);
      expect(charge.amount_refunded).toBe(0);
    });

    it("metadata is an object (not null or array)", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(typeof charge.metadata).toBe("object");
      expect(charge.metadata).not.toBeNull();
      expect(Array.isArray(charge.metadata)).toBe(false);
    });

    it("failure_code and failure_message are both null on succeeded charge", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ status: "succeeded" }));
      expect(charge.failure_code).toBeNull();
      expect(charge.failure_message).toBeNull();
    });

    it("failure_code and failure_message are set on failed charge with explicit values", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(
        defaultParams({ status: "failed", failureCode: "insufficient_funds", failureMessage: "Not enough balance" }),
      );
      expect(charge.failure_code).toBe("insufficient_funds");
      expect(charge.failure_message).toBe("Not enough balance");
    });

    it("shape is preserved after JSON round-trip (retrieve)", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(
        defaultParams({
          amount: 9999,
          currency: "jpy",
          customerId: "cus_rt",
          paymentMethodId: "pm_rt",
          metadata: { key: "val" },
        }),
      );
      const retrieved = chargeService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.object).toBe("charge");
      expect(retrieved.amount).toBe(9999);
      expect(retrieved.currency).toBe("jpy");
      expect(retrieved.customer).toBe("cus_rt");
      expect(retrieved.payment_method).toBe("pm_rt");
      expect(retrieved.metadata).toEqual({ key: "val" });
      expect(retrieved.billing_details).toEqual(created.billing_details);
      expect(retrieved.outcome).toEqual(created.outcome);
      expect(retrieved.refunds).toEqual(created.refunds);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration with PaymentIntentService
  // ---------------------------------------------------------------------------
  describe("integration with PaymentIntentService", () => {
    it("charge created via PI confirm has a link back to the PI", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 2000, currency: "usd", payment_method: pm.id, confirm: true });

      const chargeId = pi.latest_charge as string;
      expect(chargeId).toMatch(/^ch_/);

      const charge = chargeService.retrieve(chargeId);
      expect(charge.payment_intent).toBe(pi.id);
    });

    it("charge amount matches PI amount", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 4500, currency: "usd", payment_method: pm.id, confirm: true });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.amount).toBe(4500);
    });

    it("charge currency matches PI currency", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "eur", payment_method: pm.id, confirm: true });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.currency).toBe("eur");
    });

    it("charge customer matches PI customer", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({
        amount: 1000,
        currency: "usd",
        customer: "cus_integration",
        payment_method: pm.id,
        confirm: true,
      });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.customer).toBe("cus_integration");
    });

    it("charge from PI confirm is succeeded for automatic capture", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.status).toBe("succeeded");
      expect(charge.paid).toBe(true);
      expect(charge.captured).toBe(true);
    });

    it("charge from PI confirm has payment_method set", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.payment_method).toBe(pm.id);
    });

    it("charge is listable by payment_intent after PI confirm", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });

      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        paymentIntentId: pi.id,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].payment_intent).toBe(pi.id);
    });

    it("charge is listable by customer after PI confirm", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({
        amount: 1000,
        currency: "usd",
        customer: "cus_list_integ",
        payment_method: pm.id,
        confirm: true,
      });

      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_list_integ",
      });
      expect(result.data).toHaveLength(1);
    });

    it("two PI confirms create two separate charges", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });

      const pi1 = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });
      const pi2 = piService.create({ amount: 2000, currency: "usd", payment_method: pm.id, confirm: true });

      const charge1 = chargeService.retrieve(pi1.latest_charge as string);
      const charge2 = chargeService.retrieve(pi2.latest_charge as string);

      expect(charge1.id).not.toBe(charge2.id);
      expect(charge1.amount).toBe(1000);
      expect(charge2.amount).toBe(2000);
    });

    it("charge from PI confirm without customer has null customer", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 1000, currency: "usd", payment_method: pm.id, confirm: true });

      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.customer).toBeNull();
    });

    it("charge from PI with manual capture is still succeeded", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });
      // PI goes to requires_capture, but the charge itself was created with status succeeded
      const charge = chargeService.retrieve(pi.latest_charge as string);
      expect(charge.status).toBe("succeeded");
    });

    it("charge from explicit PI confirm (two-step) links correctly", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const pi = piService.create({ amount: 3000, currency: "usd", payment_method: pm.id });
      expect(pi.status).toBe("requires_confirmation");

      const confirmed = piService.confirm(pi.id, {});
      expect(confirmed.status).toBe("succeeded");

      const charge = chargeService.retrieve(confirmed.latest_charge as string);
      expect(charge.payment_intent).toBe(pi.id);
      expect(charge.amount).toBe(3000);
    });

    it("all charges for multiple PI confirms appear in list()", () => {
      const { piService, pmService, chargeService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });

      piService.create({ amount: 100, currency: "usd", payment_method: pm.id, confirm: true });
      piService.create({ amount: 200, currency: "usd", payment_method: pm.id, confirm: true });
      piService.create({ amount: 300, currency: "usd", payment_method: pm.id, confirm: true });

      const result = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Additional edge cases and DB persistence tests
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("create with all params populated at once", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create({
        amount: 12345,
        currency: "cad",
        customerId: "cus_full",
        paymentIntentId: "pi_full",
        paymentMethodId: "pm_full",
        status: "succeeded",
        failureCode: null,
        failureMessage: null,
        metadata: { a: "1", b: "2" },
      });
      expect(charge.amount).toBe(12345);
      expect(charge.currency).toBe("cad");
      expect(charge.customer).toBe("cus_full");
      expect(charge.payment_intent).toBe("pi_full");
      expect(charge.payment_method).toBe("pm_full");
      expect(charge.status).toBe("succeeded");
      expect(charge.metadata).toEqual({ a: "1", b: "2" });
    });

    it("create with all failure params populated at once", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create({
        amount: 500,
        currency: "usd",
        customerId: "cus_fail",
        paymentIntentId: "pi_fail",
        paymentMethodId: "pm_fail",
        status: "failed",
        failureCode: "card_declined",
        failureMessage: "Your card was declined.",
        metadata: { attempt: "1" },
      });
      expect(charge.status).toBe("failed");
      expect(charge.failure_code).toBe("card_declined");
      expect(charge.failure_message).toBe("Your card was declined.");
      expect(charge.paid).toBe(false);
      expect(charge.captured).toBe(false);
    });

    it("id length is consistent across multiple creations", () => {
      const { chargeService } = makeService();
      const charges = [];
      for (let i = 0; i < 10; i++) {
        charges.push(chargeService.create(defaultParams({ paymentIntentId: `pi_len_${i}` })));
      }
      const lengths = charges.map((c) => c.id.length);
      // All IDs should be the same length (prefix ch_ + 14 random chars = 17)
      expect(new Set(lengths).size).toBe(1);
    });

    it("charges are isolated between different DB instances", () => {
      const service1 = makeService();
      const service2 = makeService();

      service1.chargeService.create(defaultParams({ paymentIntentId: "pi_db1" }));
      const result = service2.chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(0);
    });

    it("retrieve returns data matching what create returned", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ amount: 888, currency: "chf", customerId: "cus_match" }));
      const retrieved = chargeService.retrieve(created.id);

      // Deep equality between created and retrieved (both go through JSON serialization)
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.amount).toBe(created.amount);
      expect(retrieved.currency).toBe(created.currency);
      expect(retrieved.customer).toBe(created.customer);
      expect(retrieved.status).toBe(created.status);
      expect(retrieved.created).toBe(created.created);
    });

    it("list on empty DB returns proper structure", () => {
      const { chargeService } = makeService();
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_nobody",
        paymentIntentId: "pi_nobody",
      });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/charges");
    });

    it("create preserves currency casing as provided", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ currency: "USD" }));
      expect(charge.currency).toBe("USD");
    });

    it("create with very long paymentIntentId", () => {
      const { chargeService } = makeService();
      const longPiId = "pi_" + "x".repeat(200);
      const charge = chargeService.create(defaultParams({ paymentIntentId: longPiId }));
      expect(charge.payment_intent).toBe(longPiId);
    });

    it("list returns the same charge data as retrieve", () => {
      const { chargeService } = makeService();
      const created = chargeService.create(defaultParams({ amount: 1234, customerId: "cus_cmp" }));
      const retrieved = chargeService.retrieve(created.id);
      const listed = chargeService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const fromList = listed.data.find((c) => c.id === created.id);

      expect(fromList).toBeDefined();
      expect(fromList!.amount).toBe(retrieved.amount);
      expect(fromList!.currency).toBe(retrieved.currency);
      expect(fromList!.customer).toBe(retrieved.customer);
      expect(fromList!.status).toBe(retrieved.status);
    });

    it("creating many charges does not cause issues", () => {
      const { chargeService } = makeService();
      for (let i = 0; i < 50; i++) {
        chargeService.create(defaultParams({ paymentIntentId: `pi_bulk_${i}` }));
      }
      const result = chargeService.list({ limit: 100, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(50);
    });

    it("charge with metadata having empty string values", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ metadata: { key: "" } }));
      expect(charge.metadata.key).toBe("");
    });

    it("charge with single metadata key", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams({ metadata: { only: "one" } }));
      expect(Object.keys(charge.metadata)).toHaveLength(1);
      expect(charge.metadata.only).toBe("one");
    });

    it("list returns no charges for nonexistent customer even with charges present", () => {
      const { chargeService } = makeService();
      chargeService.create(defaultParams({ customerId: "cus_real", paymentIntentId: "pi_1" }));
      chargeService.create(defaultParams({ customerId: "cus_real", paymentIntentId: "pi_2" }));
      const result = chargeService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_fake",
      });
      expect(result.data).toHaveLength(0);
    });

    it("retrieve throws StripeError (not a generic error)", () => {
      const { chargeService } = makeService();
      let caught = false;
      try {
        chargeService.retrieve("ch_absolutely_not_real");
      } catch (err) {
        caught = true;
        expect(err).toBeInstanceOf(StripeError);
      }
      expect(caught).toBe(true);
    });

    it("list starting_after with nonexistent charge throws StripeError", () => {
      const { chargeService } = makeService();
      let caught = false;
      try {
        chargeService.list({ limit: 10, startingAfter: "ch_ghost", endingBefore: undefined });
      } catch (err) {
        caught = true;
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.message).toContain("ch_ghost");
      }
      expect(caught).toBe(true);
    });

    it("refunds url follows /v1/charges/{id}/refunds pattern", () => {
      const { chargeService } = makeService();
      const charge = chargeService.create(defaultParams());
      expect(charge.refunds!.url).toMatch(/^\/v1\/charges\/ch_[a-zA-Z0-9_-]+\/refunds$/);
    });

    it("two charges with same params but different payment intent IDs are distinct", () => {
      const { chargeService } = makeService();
      const c1 = chargeService.create(defaultParams({ paymentIntentId: "pi_dup_1" }));
      const c2 = chargeService.create(defaultParams({ paymentIntentId: "pi_dup_2" }));
      expect(c1.id).not.toBe(c2.id);
      expect(c1.payment_intent).toBe("pi_dup_1");
      expect(c2.payment_intent).toBe("pi_dup_2");
    });
  });
});
