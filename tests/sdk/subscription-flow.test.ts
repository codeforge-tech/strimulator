import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import Stripe from "stripe";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let stripe: Stripe;

beforeEach(() => {
  app = createApp();
  app.listen(0); // random port
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

describe("Subscription Flow SDK Tests", () => {
  test("create product → price → subscription: verify active with items", async () => {
    // Create customer
    const customer = await stripe.customers.create({
      email: "sub-test@example.com",
      name: "Subscription Test",
    });
    expect(customer.id).toMatch(/^cus_/);

    // Create product
    const product = await stripe.products.create({
      name: "Test Product",
    });
    expect(product.id).toMatch(/^prod_/);

    // Create price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1999,
      currency: "usd",
      recurring: { interval: "month" },
    });
    expect(price.id).toMatch(/^price_/);
    expect(price.unit_amount).toBe(1999);

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    expect(subscription.id).toMatch(/^sub_/);
    expect(subscription.status).toBe("active");
    expect(subscription.customer).toBe(customer.id);

    // Verify items are embedded
    const items = subscription.items as Stripe.ApiList<Stripe.SubscriptionItem>;
    expect(items.object).toBe("list");
    expect(items.data.length).toBe(1);
    expect(items.data[0].price.id).toBe(price.id);
  });

  test("subscription with trial: verify trialing status and trial_end > 0", async () => {
    // Create customer
    const customer = await stripe.customers.create({
      email: "trial-test@example.com",
    });

    // Create product
    const product = await stripe.products.create({
      name: "Trial Product",
    });

    // Create price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 4999,
      currency: "usd",
      recurring: { interval: "month" },
    });

    // Create subscription with trial
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 14,
    });

    expect(subscription.id).toMatch(/^sub_/);
    expect(subscription.status).toBe("trialing");
    expect(subscription.trial_end).toBeGreaterThan(0);
    expect(subscription.trial_start).toBeGreaterThan(0);
    // trial_end should be approximately 14 days from now
    const expectedTrialEnd = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
    expect(subscription.trial_end as number).toBeCloseTo(expectedTrialEnd, -2);
  });

  test("cancel subscription: verify canceled status", async () => {
    // Create customer
    const customer = await stripe.customers.create({
      email: "cancel-test@example.com",
    });

    // Create product
    const product = await stripe.products.create({
      name: "Cancel Product",
    });

    // Create price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "usd",
      recurring: { interval: "month" },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
    });

    expect(subscription.status).toBe("active");

    // Cancel subscription
    const canceled = await stripe.subscriptions.cancel(subscription.id);
    expect(canceled.status).toBe("canceled");
    expect(canceled.id).toBe(subscription.id);
  });
});
