import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";
import { actionFlags } from "../../src/lib/action-flags";

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

describe("Test Clock Billing", () => {
  test("subscription created with test_clock stores the clock ID", async () => {
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
    });

    const customer = await stripe.customers.create({ email: "clock@test.com" });
    const product = await stripe.products.create({ name: "Clock Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1500,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      test_clock: clock.id,
    } as any);

    expect(sub.test_clock).toBe(clock.id);
  });

  test("advance clock past period_end creates invoice and rolls period", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const customer = await stripe.customers.create({ email: "billing@test.com" });
    const product = await stripe.products.create({ name: "Billing Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      test_clock: clock.id,
    } as any);

    const periodEnd = (sub as any).current_period_end;

    // Advance clock past the period end
    const advanced = await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: periodEnd + 1,
    });
    expect(advanced.status).toBe("ready");

    // Subscription should have rolled to next period
    const updatedSub = await stripe.subscriptions.retrieve(sub.id);
    expect((updatedSub as any).current_period_start).toBe(periodEnd);
    expect((updatedSub as any).current_period_end).toBeGreaterThan(periodEnd);

    // Invoice should have been created
    const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 5 } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    const cycleInvoice = invoices.data.find((inv) => (inv as any).billing_reason === "subscription_cycle");
    expect(cycleInvoice).toBeDefined();
    expect(cycleInvoice!.status).toBe("paid");
    expect(cycleInvoice!.amount_due).toBe(2000);
  });

  test("advance clock ends trial and transitions to active", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const customer = await stripe.customers.create({ email: "trial@test.com" });
    const product = await stripe.products.create({ name: "Trial Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 3000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 14,
      test_clock: clock.id,
    } as any);

    expect(sub.status).toBe("trialing");
    const trialEnd = sub.trial_end as number;

    // Advance past trial end but before period end
    await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: trialEnd + 1,
    });

    const updatedSub = await stripe.subscriptions.retrieve(sub.id);
    expect(updatedSub.status).toBe("active");
  });

  test("advance clock with failNextPayment sets subscription to past_due", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const customer = await stripe.customers.create({ email: "pastdue@test.com" });
    const product = await stripe.products.create({ name: "PastDue Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 4000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      test_clock: clock.id,
    } as any);

    const periodEnd = (sub as any).current_period_end;

    // Set the flag to fail the next payment
    actionFlags.failNextPayment = "card_declined";

    const advanced = await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: periodEnd + 1,
    });
    expect(advanced.status).toBe("ready");

    // Subscription should be past_due
    const updatedSub = await stripe.subscriptions.retrieve(sub.id);
    expect(updatedSub.status).toBe("past_due");

    // Invoice should exist but not be paid
    const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 5 } as any);
    const cycleInvoice = invoices.data.find((inv) => (inv as any).billing_reason === "subscription_cycle");
    expect(cycleInvoice).toBeDefined();
    expect(cycleInvoice!.status).toBe("open");

    // Flag should be consumed
    expect(actionFlags.failNextPayment).toBeNull();
  });

  test("advance clock: status transitions through advancing to ready", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const advanced = await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: now + 100,
    });

    // After advance completes, status should be ready
    expect(advanced.status).toBe("ready");
  });
});
