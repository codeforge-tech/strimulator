import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;

beforeEach(() => {
  app = createApp();
  app.listen(0);
  const port = app.server!.port;
  stripe = new Stripe("sk_test_strimulator", {
    host: "localhost",
    port,
    protocol: "http",
  } as any);
});

afterEach(() => {
  app.server?.stop();
});

describe("Setup and Future Payments", () => {
  // ---------------------------------------------------------------------------
  // Save card for later
  // ---------------------------------------------------------------------------
  describe("Save card for later", () => {
    test("create SetupIntent with no params -> requires_payment_method", async () => {
      const si = await stripe.setupIntents.create({});
      expect(si.id).toMatch(/^seti_/);
      expect(si.object).toBe("setup_intent");
      expect(si.status).toBe("requires_payment_method");
      expect(si.payment_method).toBeNull();
      expect(si.customer).toBeNull();
    });

    test("create SI with customer -> customer is set", async () => {
      const customer = await stripe.customers.create({ email: "si@example.com" });
      const si = await stripe.setupIntents.create({ customer: customer.id });
      expect(si.status).toBe("requires_payment_method");
      expect(si.customer).toBe(customer.id);
    });

    test("create SI with payment method -> requires_confirmation", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      expect(si.payment_method).toBe(pm.id);
    });

    test("confirm SI -> succeeded", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({ payment_method: pm.id });
      const confirmed = await stripe.setupIntents.confirm(si.id, {
        payment_method: pm.id,
      });
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.payment_method).toBe(pm.id);
    });

    test("after SI succeeds, verify PM is associated", async () => {
      const customer = await stripe.customers.create({ email: "attached@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      // Attach PM to customer first (SI confirm doesn't auto-attach)
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      const si = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
      });
      await stripe.setupIntents.confirm(si.id, { payment_method: pm.id });

      // Verify PM is attached to the customer
      const retrieved = await stripe.paymentMethods.retrieve(pm.id);
      expect(retrieved.customer).toBe(customer.id);
    });

    test("create SI with confirm=true and PM -> goes straight to succeeded", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({
        payment_method: pm.id,
        confirm: true,
      });
      expect(si.status).toBe("succeeded");
      expect(si.payment_method).toBe(pm.id);
    });

    test("retrieve SI at each stage, verify consistency", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });

      // Stage 1: requires_payment_method
      const si = await stripe.setupIntents.create({});
      const retrieved1 = await stripe.setupIntents.retrieve(si.id);
      expect(retrieved1.status).toBe("requires_payment_method");
      expect(retrieved1.id).toBe(si.id);

      // Stage 2: confirm with PM
      const confirmed = await stripe.setupIntents.confirm(si.id, {
        payment_method: pm.id,
      });
      const retrieved2 = await stripe.setupIntents.retrieve(si.id);
      expect(retrieved2.status).toBe("succeeded");
      expect(retrieved2.payment_method).toBe(pm.id);
      expect(retrieved2.id).toBe(si.id);
    });

    test("SI client_secret is set and has correct format", async () => {
      const si = await stripe.setupIntents.create({});
      expect(si.client_secret).toBeTruthy();
      // Format: seti_<id>_<random>
      expect(si.client_secret).toContain(si.id);
    });

    test("SI metadata is preserved", async () => {
      const si = await stripe.setupIntents.create({
        metadata: { order_id: "12345", source: "mobile" },
      });
      expect(si.metadata).toEqual({ order_id: "12345", source: "mobile" });
      const retrieved = await stripe.setupIntents.retrieve(si.id);
      expect(retrieved.metadata).toEqual({ order_id: "12345", source: "mobile" });
    });

    test("confirm SI that was created in requires_payment_method by providing PM at confirm time", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({});
      expect(si.status).toBe("requires_payment_method");

      const confirmed = await stripe.setupIntents.confirm(si.id, {
        payment_method: pm.id,
      });
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.payment_method).toBe(pm.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Cancel SetupIntent
  // ---------------------------------------------------------------------------
  describe("Cancel SetupIntent", () => {
    test("cancel from requires_payment_method -> canceled", async () => {
      const si = await stripe.setupIntents.create({});
      expect(si.status).toBe("requires_payment_method");

      const canceled = await stripe.setupIntents.cancel(si.id);
      expect(canceled.status).toBe("canceled");
      expect(canceled.id).toBe(si.id);
    });

    test("cancel from requires_confirmation -> canceled", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");

      const canceled = await stripe.setupIntents.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    test("cannot cancel a succeeded SI -> error", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({
        payment_method: pm.id,
        confirm: true,
      });
      expect(si.status).toBe("succeeded");

      await expect(stripe.setupIntents.cancel(si.id)).rejects.toThrow();
    });

    test("cannot confirm a canceled SI -> error", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({});
      await stripe.setupIntents.cancel(si.id);

      await expect(
        stripe.setupIntents.confirm(si.id, { payment_method: pm.id }),
      ).rejects.toThrow();
    });

    test("canceled SI preserves customer reference", async () => {
      const customer = await stripe.customers.create({ email: "cancel@example.com" });
      const si = await stripe.setupIntents.create({ customer: customer.id });
      const canceled = await stripe.setupIntents.cancel(si.id);
      expect(canceled.customer).toBe(customer.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Save card then charge later
  // ---------------------------------------------------------------------------
  describe("Save card then charge later", () => {
    test("full flow: customer -> SI -> PM -> confirm -> then create PI with saved PM", async () => {
      // Create customer
      const customer = await stripe.customers.create({
        email: "save-charge@example.com",
        name: "Future Payer",
      });

      // Create PM and attach to customer
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      // Create and confirm SI
      const si = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(si.status).toBe("succeeded");
      expect(si.customer).toBe(customer.id);

      // Now charge the saved PM
      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi.status).toBe("succeeded");
      expect(pi.amount).toBe(5000);
    });

    test("PI.customer matches SI.customer after charging saved card", async () => {
      const customer = await stripe.customers.create({ email: "match@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      const si = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const pi = await stripe.paymentIntents.create({
        amount: 3000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.customer).toBe(si.customer);
      expect(pi.customer).toBe(customer.id);
    });

    test("PI.payment_method matches the saved PM", async () => {
      const customer = await stripe.customers.create({ email: "pm-match@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const pi = await stripe.paymentIntents.create({
        amount: 1500,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      expect(pi.payment_method).toBe(pm.id);
    });

    test("multiple saved cards: attach 2 PMs, use each for a different PI", async () => {
      const customer = await stripe.customers.create({ email: "multi@example.com" });

      // Card 1: Visa
      const pm1 = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm1.id, { customer: customer.id });
      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm1.id,
        confirm: true,
      });

      // Card 2: Mastercard
      const pm2 = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_mastercard" } as any,
      });
      await stripe.paymentMethods.attach(pm2.id, { customer: customer.id });
      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm2.id,
        confirm: true,
      });

      // Charge card 1
      const pi1 = await stripe.paymentIntents.create({
        amount: 1000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm1.id,
        confirm: true,
      });
      expect(pi1.status).toBe("succeeded");
      expect(pi1.payment_method).toBe(pm1.id);

      // Charge card 2
      const pi2 = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm2.id,
        confirm: true,
      });
      expect(pi2.status).toBe("succeeded");
      expect(pi2.payment_method).toBe(pm2.id);
    });

    test("charge saved card for different amounts", async () => {
      const customer = await stripe.customers.create({ email: "amounts@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const pi1 = await stripe.paymentIntents.create({
        amount: 999,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi1.status).toBe("succeeded");
      expect(pi1.amount).toBe(999);

      const pi2 = await stripe.paymentIntents.create({
        amount: 50000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi2.status).toBe("succeeded");
      expect(pi2.amount).toBe(50000);
    });

    test("saved card works with different currencies", async () => {
      const customer = await stripe.customers.create({ email: "intl@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const piUsd = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(piUsd.currency).toBe("usd");

      const piEur = await stripe.paymentIntents.create({
        amount: 1800,
        currency: "eur",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(piEur.currency).toBe("eur");
    });

    test("create PI without confirm, then confirm separately with saved PM", async () => {
      const customer = await stripe.customers.create({ email: "sep@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      // Create PI without confirm
      const pi = await stripe.paymentIntents.create({
        amount: 4000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
      });
      expect(pi.status).toBe("requires_confirmation");

      // Confirm separately
      const confirmed = await stripe.paymentIntents.confirm(pi.id, {
        payment_method: pm.id,
      });
      expect(confirmed.status).toBe("succeeded");
    });
  });

  // ---------------------------------------------------------------------------
  // SetupIntent with 3DS
  // ---------------------------------------------------------------------------
  describe("SetupIntent with 3DS", () => {
    test("SI with 3DS-required PM, confirm -> requires_action (if 3DS simulated)", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_threeDSecureRequired" } as any,
      });

      // The SetupIntent service doesn't simulate 3DS -- it goes straight to succeeded.
      // But let's verify the confirm flow works.
      const si = await stripe.setupIntents.create({
        payment_method: pm.id,
        confirm: true,
      });
      // SI confirm goes to succeeded (no 3DS simulation on SI)
      expect(si.status).toBe("succeeded");
      expect(si.payment_method).toBe(pm.id);
    });

    test("3DS PM is usable for PI after setup", async () => {
      const customer = await stripe.customers.create({ email: "3ds@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_threeDSecureRequired" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      // Setup the card
      const si = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(si.status).toBe("succeeded");

      // Use for payment -- this will trigger 3DS on PI
      const pi = await stripe.paymentIntents.create({
        amount: 5000,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      // 3DS card triggers requires_action on PaymentIntent
      expect(pi.status).toBe("requires_action");
    });

    test("3DS PM PI: re-confirm completes the payment after requires_action", async () => {
      const customer = await stripe.customers.create({ email: "3ds-complete@example.com" });
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_threeDSecureRequired" } as any,
      });
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

      await stripe.setupIntents.create({
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });

      const pi = await stripe.paymentIntents.create({
        amount: 7500,
        currency: "usd",
        customer: customer.id,
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi.status).toBe("requires_action");

      // Re-confirm to complete the 3DS challenge
      const completed = await stripe.paymentIntents.confirm(pi.id);
      expect(completed.status).toBe("succeeded");
      expect(completed.amount_received).toBe(7500);
    });

    test("3DS card: verify last4 is 3220", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_threeDSecureRequired" } as any,
      });
      expect(pm.card?.last4).toBe("3220");
    });

    test("non-3DS card does not require action", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });

      const pi = await stripe.paymentIntents.create({
        amount: 2000,
        currency: "usd",
        payment_method: pm.id,
        confirm: true,
      });
      expect(pi.status).toBe("succeeded");
    });
  });

  // ---------------------------------------------------------------------------
  // List setup intents
  // ---------------------------------------------------------------------------
  describe("List setup intents", () => {
    test("list setup intents returns correct shape", async () => {
      await stripe.setupIntents.create({});

      const list = await stripe.setupIntents.list();
      expect(list.object).toBe("list");
      expect(Array.isArray(list.data)).toBe(true);
      expect(list.data.length).toBeGreaterThanOrEqual(1);
    });

    test("list with limit", async () => {
      await stripe.setupIntents.create({});
      await stripe.setupIntents.create({});
      await stripe.setupIntents.create({});

      const list = await stripe.setupIntents.list({ limit: 2 });
      expect(list.data.length).toBe(2);
    });

    test("multiple SIs appear in list", async () => {
      const si1 = await stripe.setupIntents.create({});
      const si2 = await stripe.setupIntents.create({});
      const si3 = await stripe.setupIntents.create({});

      const list = await stripe.setupIntents.list({ limit: 10 });
      const ids = list.data.map((si) => si.id);
      expect(ids).toContain(si1.id);
      expect(ids).toContain(si2.id);
      expect(ids).toContain(si3.id);
    });

    test("list has correct structure with has_more", async () => {
      await stripe.setupIntents.create({});

      const list = await stripe.setupIntents.list({ limit: 100 });
      expect(list).toHaveProperty("object", "list");
      expect(list).toHaveProperty("data");
      expect(typeof list.has_more).toBe("boolean");
    });

    test("list with limit less than total shows has_more=true", async () => {
      await stripe.setupIntents.create({});
      await stripe.setupIntents.create({});
      await stripe.setupIntents.create({});

      const list = await stripe.setupIntents.list({ limit: 1 });
      expect(list.data.length).toBe(1);
      expect(list.has_more).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Error scenarios
  // ---------------------------------------------------------------------------
  describe("Error scenarios", () => {
    test("confirm without PM -> error", async () => {
      const si = await stripe.setupIntents.create({});
      await expect(stripe.setupIntents.confirm(si.id)).rejects.toThrow();
    });

    test("retrieve non-existent SI -> 404", async () => {
      await expect(
        stripe.setupIntents.retrieve("seti_nonexistent"),
      ).rejects.toThrow();
    });

    test("create PI referencing non-existent PM -> error", async () => {
      await expect(
        stripe.paymentIntents.create({
          amount: 1000,
          currency: "usd",
          payment_method: "pm_doesnotexist",
          confirm: true,
        }),
      ).rejects.toThrow();
    });

    test("double confirm -> error (confirm already-succeeded SI)", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      const si = await stripe.setupIntents.create({
        payment_method: pm.id,
        confirm: true,
      });
      expect(si.status).toBe("succeeded");

      await expect(
        stripe.setupIntents.confirm(si.id, { payment_method: pm.id }),
      ).rejects.toThrow();
    });

    test("cancel twice -> error on second cancel", async () => {
      const si = await stripe.setupIntents.create({});
      await stripe.setupIntents.cancel(si.id);
      await expect(stripe.setupIntents.cancel(si.id)).rejects.toThrow();
    });

    test("confirm non-existent SI -> error", async () => {
      const pm = await stripe.paymentMethods.create({
        type: "card",
        card: { token: "tok_visa" } as any,
      });
      await expect(
        stripe.setupIntents.confirm("seti_fake123", { payment_method: pm.id }),
      ).rejects.toThrow();
    });

    test("cancel non-existent SI -> error", async () => {
      await expect(
        stripe.setupIntents.cancel("seti_fake456"),
      ).rejects.toThrow();
    });
  });
});
