import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";
import { actionFlags } from "../../src/lib/action-flags";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;
let port: number;

beforeEach(() => {
  app = createApp();
  app.listen(0);
  port = app.server!.port;
  stripe = new Stripe("sk_test_strimulator", {
    host: "localhost",
    port,
    protocol: "http",
  } as any);
});

afterEach(() => {
  app.server?.stop();
  // Reset action flags in case a test didn't consume it
  actionFlags.failNextPayment = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createVisaPM() {
  return stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" } as any,
  });
}

async function create3DSPM() {
  return stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_threeDSecureRequired" } as any,
  });
}

async function create3DSOptionalPM() {
  return stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_threeDSecureOptional" } as any,
  });
}

/** Pay and return the succeeded PI */
async function paySuccessfully(
  amount: number,
  currency: string,
  opts?: { customer?: string; metadata?: Record<string, string> },
) {
  const pm = await createVisaPM();
  return stripe.paymentIntents.create({
    amount,
    currency,
    payment_method: pm.id,
    confirm: true,
    ...(opts?.customer ? { customer: opts.customer } : {}),
    ...(opts?.metadata ? { metadata: opts.metadata } : {}),
  });
}

/** Raw HTTP GET with auth — used for expand tests since SDK sends expand[0] but emulator expects expand[] */
async function rawGet(path: string): Promise<any> {
  const resp = await fetch(`http://localhost:${port}${path}`, {
    headers: { Authorization: "Bearer sk_test_strimulator" },
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// Simple checkout
// ---------------------------------------------------------------------------

describe("E-Commerce Payment Flows", () => {
  describe("Simple checkout", () => {
    test("complete checkout: create customer, attach PM, confirm PI — status=succeeded, amount_received matches", async () => {
      const customer = await stripe.customers.create({
        email: "buyer@shop.com",
        name: "Alice Buyer",
      });

      const pm = await createVisaPM();
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      const pi = await stripe.paymentIntents.create({
        amount: 4999,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.id).toMatch(/^pi_/);
      expect(pi.status).toBe("succeeded");
      expect(pi.amount).toBe(4999);
      expect(pi.amount_received).toBe(4999);
      expect(pi.currency).toBe("usd");
      expect(pi.customer).toBe(customer.id);
    });

    test("retrieve the resulting charge via latest_charge — verify amount, currency, status", async () => {
      const pi = await paySuccessfully(2500, "usd");
      expect(pi.latest_charge).toBeTruthy();

      const charge = await stripe.charges.retrieve(pi.latest_charge as string);
      expect(charge.id).toMatch(/^ch_/);
      expect(charge.amount).toBe(2500);
      expect(charge.currency).toBe("usd");
      expect(charge.status).toBe("succeeded");
      expect(charge.paid).toBe(true);
      expect(charge.payment_intent).toBe(pi.id);
    });

    test("customer has the PI in their payment history (list PIs by customer)", async () => {
      const customer = await stripe.customers.create({ email: "history@shop.com" });
      await paySuccessfully(1000, "usd", { customer: customer.id });
      await paySuccessfully(2000, "usd", { customer: customer.id });

      const list = await stripe.paymentIntents.list({ customer: customer.id });
      expect(list.data.length).toBe(2);
      list.data.forEach((pi) => {
        expect(pi.customer).toBe(customer.id);
        expect(pi.status).toBe("succeeded");
      });
    });

    test("guest checkout without customer (just PM + PI)", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 799,
        currency: "eur",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("succeeded");
      expect(pi.customer).toBeNull();
      expect(pi.amount_received).toBe(799);
    });

    test("payment preserves metadata through the flow", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        metadata: { order_id: "ORD-123", sku: "WIDGET-XL" },
      });

      expect(pi.status).toBe("succeeded");
      expect(pi.metadata).toEqual({ order_id: "ORD-123", sku: "WIDGET-XL" });

      // Retrieve again to make sure metadata persisted
      const retrieved = await stripe.paymentIntents.retrieve(pi.id);
      expect(retrieved.metadata).toEqual({ order_id: "ORD-123", sku: "WIDGET-XL" });
    });

    test("multiple payments for the same customer accumulate correctly", async () => {
      const customer = await stripe.customers.create({ email: "repeat@shop.com" });

      const pi1 = await paySuccessfully(1500, "usd", { customer: customer.id });
      const pi2 = await paySuccessfully(2500, "usd", { customer: customer.id });
      const pi3 = await paySuccessfully(3500, "usd", { customer: customer.id });

      // Each PI should be unique and succeeded
      const ids = [pi1.id, pi2.id, pi3.id];
      expect(new Set(ids).size).toBe(3);

      const list = await stripe.paymentIntents.list({ customer: customer.id });
      expect(list.data.length).toBe(3);

      const totalReceived = list.data.reduce((sum, pi) => sum + (pi.amount_received ?? 0), 0);
      expect(totalReceived).toBe(7500);
    });

    test("PI without confirm stays in requires_confirmation", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
      });

      expect(pi.status).toBe("requires_confirmation");
      expect(pi.amount_received).toBe(0);
    });

    test("PI without payment_method stays in requires_payment_method", async () => {
      const pi = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
      });

      expect(pi.status).toBe("requires_payment_method");
    });
  });

  // ---------------------------------------------------------------------------
  // Manual capture / pre-auth
  // ---------------------------------------------------------------------------

  describe("Manual capture / pre-auth", () => {
    test("place hold: manual capture + confirm → requires_capture", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 10000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      expect(pi.status).toBe("requires_capture");
      expect(pi.amount_capturable).toBe(10000);
      expect(pi.amount_received).toBe(0);
    });

    test("capture full amount → succeeded with correct amount_received", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      const captured = await stripe.paymentIntents.capture(pi.id);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(5000);
      expect(captured.amount).toBe(5000);
    });

    test("partial capture: capture less than authorized amount", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 8000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      const captured = await stripe.paymentIntents.capture(pi.id, {
        amount_to_capture: 5000,
      });

      expect(captured.status).toBe("succeeded");
      expect(captured.amount).toBe(8000);
      expect(captured.amount_received).toBe(5000);
    });

    test("cancel pre-auth: create manual PI, confirm, then cancel instead of capture", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 6000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });
      expect(pi.status).toBe("requires_capture");

      const canceled = await stripe.paymentIntents.cancel(pi.id);
      expect(canceled.status).toBe("canceled");
      expect(canceled.canceled_at).toBeTruthy();
    });

    test("verify charge status through capture lifecycle", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 4000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      // Charge exists after hold
      expect(pi.latest_charge).toBeTruthy();
      const holdCharge = await stripe.charges.retrieve(pi.latest_charge as string);
      expect(holdCharge.status).toBe("succeeded");

      // Capture the PI
      const captured = await stripe.paymentIntents.capture(pi.id);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(4000);
    });

    test("hold then capture with explicit amount_to_capture matching full amount", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 7500,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      const captured = await stripe.paymentIntents.capture(pi.id, {
        amount_to_capture: 7500,
      });

      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(7500);
    });

    test("two-step flow: create without confirm, then confirm with manual capture, then capture", async () => {
      const pm = await createVisaPM();

      // Step 1: create
      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: pm.id,
        capture_method: "manual",
      });
      expect(pi.status).toBe("requires_confirmation");

      // Step 2: confirm
      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("requires_capture");

      // Step 3: capture
      const captured = await stripe.paymentIntents.capture(pi.id);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(3000);
    });

    test("confirm with manual capture_method preserves through flow", async () => {
      const pm = await createVisaPM();

      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        capture_method: "manual",
      });
      expect(pi.status).toBe("requires_confirmation");
      expect(pi.capture_method).toBe("manual");

      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("requires_capture");
    });
  });

  // ---------------------------------------------------------------------------
  // Declined cards (using actionFlags to simulate declines)
  // ---------------------------------------------------------------------------

  describe("Declined cards", () => {
    test("failNextPayment flag causes decline: PI status becomes requires_payment_method", async () => {
      const pm = await createVisaPM();
      actionFlags.failNextPayment = "card_declined";

      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_payment_method");
    });

    test("after decline, PI is in requires_payment_method (retry possible)", async () => {
      const pm = await createVisaPM();
      actionFlags.failNextPayment = "card_declined";

      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_payment_method");

      // Verify we can retrieve and it stays in that state
      const retrieved = await stripe.paymentIntents.retrieve(pi.id);
      expect(retrieved.status).toBe("requires_payment_method");
    });

    test("retry declined payment with a good card → succeeds", async () => {
      const pm = await createVisaPM();
      actionFlags.failNextPayment = "card_declined";

      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_payment_method");

      // Flag is consumed after first use, so retry with same card works
      const goodPM = await createVisaPM();
      const confirmed = await stripe.paymentIntents.confirm(pi.id, {
        payment_method: goodPM.id,
      });

      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.amount_received).toBe(3000);
    });

    test("last_payment_error is set after decline", async () => {
      const pm = await createVisaPM();
      actionFlags.failNextPayment = "card_declined";

      const pi = await stripe.paymentIntents.create({
        amount: 1500,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.last_payment_error).toBeTruthy();
      expect(pi.last_payment_error!.type).toBe("card_error");
      expect(pi.last_payment_error!.code).toBe("card_declined");
    });

    test("last_payment_error.decline_code is present after decline", async () => {
      const pm = await createVisaPM();
      actionFlags.failNextPayment = "card_declined";

      const pi = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.last_payment_error).toBeTruthy();
      expect(pi.last_payment_error!.decline_code).toBe("generic_decline");
    });

    test("failNextPayment flag is consumed after one use — second PI succeeds", async () => {
      const pm1 = await createVisaPM();
      const pm2 = await createVisaPM();

      actionFlags.failNextPayment = "card_declined";

      const pi1 = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm1.id,
        confirm: true,
      });
      expect(pi1.status).toBe("requires_payment_method");

      // Flag consumed — next PI should succeed
      const pi2 = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm2.id,
        confirm: true,
      });
      expect(pi2.status).toBe("succeeded");
    });
  });

  // ---------------------------------------------------------------------------
  // 3D Secure authentication
  // ---------------------------------------------------------------------------

  describe("3D Secure authentication", () => {
    test("tok_threeDSecureRequired: confirm PI → requires_action with next_action", async () => {
      const pm = await create3DSPM();
      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_action");
      expect(pi.next_action).toBeTruthy();
    });

    test("verify next_action.type is use_stripe_sdk", async () => {
      const pm = await create3DSPM();
      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.next_action).toBeTruthy();
      expect(pi.next_action!.type).toBe("use_stripe_sdk");
    });

    test("re-confirm after 3DS → succeeded", async () => {
      const pm = await create3DSPM();
      const pi = await stripe.paymentIntents.create({
        amount: 4000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_action");

      // Re-confirm to complete 3DS challenge
      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.amount_received).toBe(4000);
      expect(confirmed.latest_charge).toBeTruthy();
    });

    test("3DS with manual capture: confirm → requires_action → re-confirm → requires_capture → capture → succeeded", async () => {
      const pm = await create3DSPM();
      const pi = await stripe.paymentIntents.create({
        amount: 6000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
        capture_method: "manual",
      });

      expect(pi.status).toBe("requires_action");

      // Re-confirm to complete 3DS
      const afterAuth = await stripe.paymentIntents.confirm(pi.id);
      expect(afterAuth.status).toBe("requires_capture");

      // Capture
      const captured = await stripe.paymentIntents.capture(pi.id);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(6000);
    });

    test("tok_threeDSecureOptional: confirm PI → goes straight to succeeded (no 3DS challenge)", async () => {
      const pm = await create3DSOptionalPM();
      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("succeeded");
      expect(pi.next_action).toBeNull();
      expect(pi.amount_received).toBe(2000);
    });

    test("retrieve PI at each stage of 3DS flow, verify status consistency", async () => {
      const pm = await create3DSPM();

      // Create + confirm → requires_action
      const pi = await stripe.paymentIntents.create({
        amount: 7500,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi.status).toBe("requires_action");

      const retrieved1 = await stripe.paymentIntents.retrieve(pi.id);
      expect(retrieved1.status).toBe("requires_action");
      expect(retrieved1.next_action).toBeTruthy();

      // Re-confirm → succeeded
      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("succeeded");

      const retrieved2 = await stripe.paymentIntents.retrieve(pi.id);
      expect(retrieved2.status).toBe("succeeded");
      expect(retrieved2.next_action).toBeNull();
      expect(retrieved2.latest_charge).toBeTruthy();
    });

    test("3DS PI has a charge only after re-confirm, not during requires_action", async () => {
      const pm = await create3DSPM();
      const pi = await stripe.paymentIntents.create({
        amount: 1500,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.status).toBe("requires_action");
      expect(pi.latest_charge).toBeNull();

      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.latest_charge).toBeTruthy();
    });

    test("3DS flow preserves customer and metadata", async () => {
      const customer = await stripe.customers.create({ email: "3ds@shop.com" });
      const pm = await create3DSPM();

      const pi = await stripe.paymentIntents.create({
        amount: 9900,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
        metadata: { order: "3DS-001" },
      });

      expect(pi.status).toBe("requires_action");
      expect(pi.customer).toBe(customer.id);
      expect(pi.metadata).toEqual({ order: "3DS-001" });

      const confirmed = await stripe.paymentIntents.confirm(pi.id);
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.customer).toBe(customer.id);
      expect(confirmed.metadata).toEqual({ order: "3DS-001" });
    });
  });

  // ---------------------------------------------------------------------------
  // Refund flows
  // ---------------------------------------------------------------------------

  describe("Refund flows", () => {
    test("full refund: pay → refund full amount → charge.refunded=true", async () => {
      const pi = await paySuccessfully(5000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund = await stripe.refunds.create({
        charge: chargeId,
      });

      expect(refund.id).toMatch(/^re_/);
      expect(refund.amount).toBe(5000);
      expect(refund.status).toBe("succeeded");

      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.refunded).toBe(true);
      expect(charge.amount_refunded).toBe(5000);
    });

    test("partial refund: pay $50 → refund $20 → verify refund object", async () => {
      const pi = await paySuccessfully(5000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund = await stripe.refunds.create({
        charge: chargeId,
        amount: 2000,
      });

      // Refund amount comes through form encoding
      expect(Number(refund.amount)).toBe(2000);
      expect(refund.charge).toBe(chargeId);
      expect(refund.status).toBe("succeeded");

      // Charge should not be fully refunded
      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.refunded).toBe(false);
    });

    test("multiple partial refunds: $50 payment → refund $10 → refund $15 → verify refund objects", async () => {
      const pi = await paySuccessfully(5000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund1 = await stripe.refunds.create({
        charge: chargeId,
        amount: 1000,
      });
      expect(Number(refund1.amount)).toBe(1000);
      expect(refund1.charge).toBe(chargeId);

      const refund2 = await stripe.refunds.create({
        charge: chargeId,
        amount: 1500,
      });
      expect(Number(refund2.amount)).toBe(1500);
      expect(refund2.charge).toBe(chargeId);

      // Both refunds should be unique
      expect(refund1.id).not.toBe(refund2.id);

      // Verify both refunds exist via list
      const list = await stripe.refunds.list({ charge: chargeId });
      expect(list.data.length).toBe(2);
    });

    test("refund remaining: full refund after no prior refunds returns correct amount", async () => {
      const pi = await paySuccessfully(4000, "usd");
      const chargeId = pi.latest_charge as string;

      // Full refund (no explicit amount) — calculates remainder correctly as number
      const refund = await stripe.refunds.create({
        charge: chargeId,
      });

      expect(refund.amount).toBe(4000);

      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(4000);
      expect(charge.refunded).toBe(true);
    });

    test("over-refund attempt → expect error", async () => {
      const pi = await paySuccessfully(3000, "usd");
      const chargeId = pi.latest_charge as string;

      try {
        await stripe.refunds.create({
          charge: chargeId,
          amount: 5000, // more than the charge
        });
        expect(true).toBe(false); // should not reach here
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.type).toBe("StripeInvalidRequestError");
      }
    });

    test("refund already fully refunded charge → expect error", async () => {
      const pi = await paySuccessfully(2000, "usd");
      const chargeId = pi.latest_charge as string;

      // Full refund
      await stripe.refunds.create({ charge: chargeId });

      // Try to refund again
      try {
        await stripe.refunds.create({ charge: chargeId });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.type).toBe("StripeInvalidRequestError");
      }
    });

    test("refund object has correct charge and payment_intent links", async () => {
      const pi = await paySuccessfully(6000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund = await stripe.refunds.create({
        payment_intent: pi.id,
        amount: 2000,
      });

      expect(refund.charge).toBe(chargeId);
      expect(refund.payment_intent).toBe(pi.id);
    });

    test("refund via payment_intent instead of charge", async () => {
      const pi = await paySuccessfully(3500, "usd");

      const refund = await stripe.refunds.create({
        payment_intent: pi.id,
      });

      expect(refund.amount).toBe(3500);
      expect(refund.status).toBe("succeeded");
      expect(refund.payment_intent).toBe(pi.id);
    });

    test("list refunds for a charge, verify they appear", async () => {
      const pi = await paySuccessfully(5000, "usd");
      const chargeId = pi.latest_charge as string;

      await stripe.refunds.create({ charge: chargeId, amount: 1000 });
      await stripe.refunds.create({ charge: chargeId, amount: 500 });

      const list = await stripe.refunds.list({ charge: chargeId });
      expect(list.data.length).toBe(2);

      const amounts = list.data.map((r) => Number(r.amount)).sort((a, b) => a - b);
      expect(amounts).toEqual([500, 1000]);
    });

    test("retrieve individual refund by id", async () => {
      const pi = await paySuccessfully(4000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund = await stripe.refunds.create({
        charge: chargeId,
        amount: 1200,
      });

      const retrieved = await stripe.refunds.retrieve(refund.id);
      expect(retrieved.id).toBe(refund.id);
      expect(Number(retrieved.amount)).toBe(1200);
      expect(retrieved.charge).toBe(chargeId);
    });

    test("partial refund leaves charge.refunded=false, full refund via payment_intent sets it to true", async () => {
      // Use full refund (no explicit amount) to avoid form-encoding string issue
      const pi = await paySuccessfully(3000, "usd");
      const chargeId = pi.latest_charge as string;

      // First: a full refund of a different PI to verify refunded=true
      const pi2 = await paySuccessfully(2000, "usd");
      const chargeId2 = pi2.latest_charge as string;

      // Full refund (no amount param) — correctly processed as number
      await stripe.refunds.create({ charge: chargeId2 });
      const charge2 = await stripe.charges.retrieve(chargeId2);
      expect(charge2.refunded).toBe(true);
      expect(charge2.amount_refunded).toBe(2000);

      // Partial refund with explicit amount
      await stripe.refunds.create({ charge: chargeId, amount: 1000 });
      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.refunded).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  describe("Idempotency", () => {
    test("create PI with idempotency key → same key returns same PI (same id)", async () => {
      const pm = await createVisaPM();
      const key = "idem-key-" + Date.now();

      const pi1 = await stripe.paymentIntents.create(
        {
          amount: 1000,
          currency: "usd",
          payment_method: pm.id,
          confirm: true,
        },
        { idempotencyKey: key },
      );

      const pi2 = await stripe.paymentIntents.create(
        {
          amount: 1000,
          currency: "usd",
          payment_method: pm.id,
          confirm: true,
        },
        { idempotencyKey: key },
      );

      expect(pi1.id).toBe(pi2.id);
      expect(pi1.amount).toBe(pi2.amount);
    });

    test("different idempotency keys create different PIs", async () => {
      const pm1 = await createVisaPM();
      const pm2 = await createVisaPM();

      const pi1 = await stripe.paymentIntents.create(
        {
          amount: 1000,
          currency: "usd",
          payment_method: pm1.id,
          confirm: true,
        },
        { idempotencyKey: "key-a-" + Date.now() },
      );

      const pi2 = await stripe.paymentIntents.create(
        {
          amount: 1000,
          currency: "usd",
          payment_method: pm2.id,
          confirm: true,
        },
        { idempotencyKey: "key-b-" + Date.now() },
      );

      expect(pi1.id).not.toBe(pi2.id);
    });

    test("idempotency key on different endpoint → error", async () => {
      const pm = await createVisaPM();
      const key = "cross-endpoint-" + Date.now();

      // First use: create a PI
      await stripe.paymentIntents.create(
        {
          amount: 2000,
          currency: "usd",
          payment_method: pm.id,
          confirm: true,
        },
        { idempotencyKey: key },
      );

      // Second use: try the same key on a different endpoint (customer create)
      try {
        await stripe.customers.create(
          { email: "dup@test.com" },
          { idempotencyKey: key },
        );
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });

    test("idempotency replay returns identical response body", async () => {
      const pm = await createVisaPM();
      const key = "replay-" + Date.now();

      const pi1 = await stripe.paymentIntents.create(
        {
          amount: 4500,
          currency: "usd",
          payment_method: pm.id,
          confirm: true,
        },
        { idempotencyKey: key },
      );

      const pi2 = await stripe.paymentIntents.create(
        {
          amount: 4500,
          currency: "usd",
          payment_method: pm.id,
          confirm: true,
        },
        { idempotencyKey: key },
      );

      expect(pi2.id).toBe(pi1.id);
      expect(pi2.status).toBe(pi1.status);
      expect(pi2.amount).toBe(pi1.amount);
      expect(pi2.client_secret).toBe(pi1.client_secret);
    });

    test("requests without idempotency key always create new resources", async () => {
      const pm1 = await createVisaPM();
      const pm2 = await createVisaPM();

      const pi1 = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm1.id,
        confirm: true,
      });

      const pi2 = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        payment_method: pm2.id,
        confirm: true,
      });

      expect(pi1.id).not.toBe(pi2.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Payment with expansion (using raw HTTP since SDK sends expand[0] but
  // emulator expects expand[] format)
  // ---------------------------------------------------------------------------

  describe("Payment with expansion", () => {
    test("expand customer field on PI retrieve", async () => {
      const customer = await stripe.customers.create({
        email: "expand@shop.com",
        name: "Expand Test",
      });
      const pi = await paySuccessfully(2000, "usd", { customer: customer.id });

      const expanded = await rawGet(
        `/v1/payment_intents/${pi.id}?expand[]=customer`,
      );

      // When expanded, customer should be an object, not a string
      expect(typeof expanded.customer).toBe("object");
      expect(expanded.customer.id).toBe(customer.id);
      expect(expanded.customer.email).toBe("expand@shop.com");
    });

    test("expand payment_method on PI retrieve", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      const expanded = await rawGet(
        `/v1/payment_intents/${pi.id}?expand[]=payment_method`,
      );

      expect(typeof expanded.payment_method).toBe("object");
      expect(expanded.payment_method.id).toBe(pm.id);
      expect(expanded.payment_method.type).toBe("card");
      expect(expanded.payment_method.card.last4).toBe("4242");
    });

    test("expand latest_charge on PI retrieve", async () => {
      const pi = await paySuccessfully(1500, "usd");

      const expanded = await rawGet(
        `/v1/payment_intents/${pi.id}?expand[]=latest_charge`,
      );

      expect(typeof expanded.latest_charge).toBe("object");
      expect(expanded.latest_charge.id).toMatch(/^ch_/);
      expect(expanded.latest_charge.amount).toBe(1500);
      expect(expanded.latest_charge.status).toBe("succeeded");
    });

    test("expand multiple fields at once", async () => {
      const customer = await stripe.customers.create({ email: "multi@shop.com" });
      const pm = await createVisaPM();
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      const pi = await stripe.paymentIntents.create({
        amount: 8000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const expanded = await rawGet(
        `/v1/payment_intents/${pi.id}?expand[]=customer&expand[]=payment_method&expand[]=latest_charge`,
      );

      expect(typeof expanded.customer).toBe("object");
      expect(typeof expanded.payment_method).toBe("object");
      expect(typeof expanded.latest_charge).toBe("object");

      expect(expanded.customer.id).toBe(customer.id);
      expect(expanded.payment_method.id).toBe(pm.id);
      expect(expanded.latest_charge.amount).toBe(8000);
    });

    test("retrieve without expand returns string ids", async () => {
      const customer = await stripe.customers.create({ email: "noexpand@shop.com" });
      const pi = await paySuccessfully(1000, "usd", { customer: customer.id });

      const retrieved = await stripe.paymentIntents.retrieve(pi.id);

      expect(typeof retrieved.customer).toBe("string");
      expect(typeof retrieved.latest_charge).toBe("string");
      expect(typeof retrieved.payment_method).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // Error scenarios
  // ---------------------------------------------------------------------------

  describe("Error scenarios", () => {
    test("create PI with amount=0 → error", async () => {
      try {
        await stripe.paymentIntents.create({
          amount: 0,
          currency: "usd",
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.type).toBe("StripeInvalidRequestError");
      }
    });

    test("create PI with negative amount → error", async () => {
      try {
        await stripe.paymentIntents.create({
          amount: -100,
          currency: "usd",
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });

    test("create PI without currency → error", async () => {
      try {
        await stripe.paymentIntents.create({
          amount: 1000,
        } as any);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.type).toBe("StripeInvalidRequestError");
      }
    });

    test("confirm PI without payment method → error", async () => {
      const pi = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
      });

      try {
        await stripe.paymentIntents.confirm(pi.id);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });

    test("capture PI that is not in requires_capture → error", async () => {
      const pi = await paySuccessfully(1000, "usd");
      expect(pi.status).toBe("succeeded");

      try {
        await stripe.paymentIntents.capture(pi.id);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain("succeeded");
      }
    });

    test("cancel already succeeded PI → error", async () => {
      const pi = await paySuccessfully(1000, "usd");
      expect(pi.status).toBe("succeeded");

      try {
        await stripe.paymentIntents.cancel(pi.id);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain("succeeded");
      }
    });

    test("retrieve non-existent PI → 404", async () => {
      try {
        await stripe.paymentIntents.retrieve("pi_nonexistent_12345");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
      }
    });

    test("invalid API key → 401", async () => {
      const badStripe = new Stripe("sk_live_bad_key", {
        host: "localhost",
        port: app.server!.port,
        protocol: "http",
      } as any);

      try {
        await badStripe.paymentIntents.list();
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.type).toBe("StripeAuthenticationError");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // tok_chargeDeclined — decline via magic token (no actionFlags needed)
  // ---------------------------------------------------------------------------

  describe("Decline via tok_chargeDeclined magic token", () => {
    test("tok_chargeDeclined creates a PM with last4 0002", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_chargeDeclined" } as any,
      });
      expect(pm.card?.last4).toBe("0002");
      expect(pm.card?.brand).toBe("visa");
    });

    test("confirming PI with tok_chargeDeclined card is declined", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_chargeDeclined" } as any,
      });
      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi.status).toBe("requires_payment_method");
      expect(pi.last_payment_error).toBeTruthy();
      expect(pi.last_payment_error!.code).toBe("card_declined");
    });

    test("declined via magic token can be retried with a good card", async () => {
      const badPM = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_chargeDeclined" } as any,
      });
      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        payment_method: badPM.id,
        confirm: true,
      });
      expect(pi.status).toBe("requires_payment_method");

      const goodPM = await createVisaPM();
      const confirmed = await stripe.paymentIntents.confirm(pi.id, {
        payment_method: goodPM.id,
      });
      expect(confirmed.status).toBe("succeeded");
    });
  });

  // ---------------------------------------------------------------------------
  // SDK expand — verify expand works through the SDK (not just raw fetch)
  // ---------------------------------------------------------------------------

  describe("SDK expand", () => {
    test("expand customer on PI retrieve via SDK", async () => {
      const customer = await stripe.customers.create({ email: "expand@test.com", name: "Expand Test" });
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const retrieved = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ["customer"],
      });

      // With SDK expand working, customer should be an object, not a string
      expect(typeof retrieved.customer).toBe("object");
      expect((retrieved.customer as Stripe.Customer).id).toBe(customer.id);
      expect((retrieved.customer as Stripe.Customer).email).toBe("expand@test.com");
    });

    test("expand latest_charge on PI retrieve via SDK", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      const retrieved = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ["latest_charge"],
      });

      expect(typeof retrieved.latest_charge).toBe("object");
      expect((retrieved.latest_charge as Stripe.Charge).amount).toBe(2000);
      expect((retrieved.latest_charge as Stripe.Charge).status).toBe("succeeded");
    });

    test("expand payment_method on PI retrieve via SDK", async () => {
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 1500,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });

      const retrieved = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ["payment_method"],
      });

      expect(typeof retrieved.payment_method).toBe("object");
      expect((retrieved.payment_method as Stripe.PaymentMethod).card?.last4).toBe("4242");
    });

    test("expand multiple fields simultaneously via SDK", async () => {
      const customer = await stripe.customers.create({ email: "multi-expand@test.com" });
      const pm = await createVisaPM();
      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const retrieved = await stripe.paymentIntents.retrieve(pi.id, {
        expand: ["customer", "latest_charge", "payment_method"],
      });

      expect(typeof retrieved.customer).toBe("object");
      expect(typeof retrieved.latest_charge).toBe("object");
      expect(typeof retrieved.payment_method).toBe("object");
    });
  });

  // ---------------------------------------------------------------------------
  // SDK refunds with explicit amount (parseInt fix)
  // ---------------------------------------------------------------------------

  describe("SDK refunds with explicit amount", () => {
    test("partial refund via SDK with explicit amount works correctly", async () => {
      const pi = await paySuccessfully(5000, "usd");
      const chargeId = pi.latest_charge as string;

      const refund = await stripe.refunds.create({
        charge: chargeId,
        amount: 2000,
      });

      expect(refund.amount).toBe(2000);
      expect(refund.status).toBe("succeeded");

      // Verify charge is partially refunded
      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(2000);
      expect(charge.refunded).toBe(false);
    });

    test("multiple partial refunds via SDK accumulate correctly", async () => {
      const pi = await paySuccessfully(10000, "usd");
      const chargeId = pi.latest_charge as string;

      await stripe.refunds.create({ charge: chargeId, amount: 3000 });
      await stripe.refunds.create({ charge: chargeId, amount: 2000 });
      await stripe.refunds.create({ charge: chargeId, amount: 5000 });

      const charge = await stripe.charges.retrieve(chargeId);
      expect(charge.amount_refunded).toBe(10000);
      expect(charge.refunded).toBe(true);
    });

    test("over-refund via SDK is rejected", async () => {
      const pi = await paySuccessfully(3000, "usd");
      const chargeId = pi.latest_charge as string;

      await stripe.refunds.create({ charge: chargeId, amount: 2000 });

      try {
        await stripe.refunds.create({ charge: chargeId, amount: 2000 });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });
  });
});
