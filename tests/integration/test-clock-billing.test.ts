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
});
