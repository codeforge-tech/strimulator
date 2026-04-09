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

async function createSubWithPrice(unitAmount: number) {
  const customer = await stripe.customers.create({ email: "sub@test.com" });
  const product = await stripe.products.create({ name: "Test" });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval: "month" },
  });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id }],
  });
  return { customer, product, price, sub };
}

describe("Subscription Updates", () => {
  test("upgrade: swap price on subscription item", async () => {
    const { customer, product, price, sub } = await createSubWithPrice(1000);

    const newPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const itemId = sub.items.data[0].id;
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: itemId, price: newPrice.id }],
    });

    expect(updated.id).toBe(sub.id);
    expect(updated.items.data[0].price.id).toBe(newPrice.id);
    expect(updated.items.data[0].price.unit_amount).toBe(2000);
  });

  test("set cancel_at_period_end", async () => {
    const { sub } = await createSubWithPrice(1000);

    const updated = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
    });

    expect(updated.cancel_at_period_end).toBe(true);
    expect(updated.cancel_at).not.toBeNull();
  });

  test("unset cancel_at_period_end", async () => {
    const { sub } = await createSubWithPrice(1000);

    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });

    const updated = await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: false,
    });

    expect(updated.cancel_at_period_end).toBe(false);
    expect(updated.cancel_at).toBeNull();
  });

  test("update metadata", async () => {
    const { sub } = await createSubWithPrice(1000);

    const updated = await stripe.subscriptions.update(sub.id, {
      metadata: { plan_tier: "enterprise" },
    });

    expect(updated.metadata).toEqual({ plan_tier: "enterprise" });
  });

  test("reject update on canceled subscription", async () => {
    const { sub } = await createSubWithPrice(1000);
    await stripe.subscriptions.cancel(sub.id);

    try {
      await stripe.subscriptions.update(sub.id, { metadata: { key: "value" } });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });

  test("emits customer.subscription.updated event", async () => {
    const { sub } = await createSubWithPrice(1000);

    await stripe.subscriptions.update(sub.id, { metadata: { env: "test" } });

    const events = await stripe.events.list({ type: "customer.subscription.updated", limit: 5 });
    expect(events.data.length).toBeGreaterThanOrEqual(1);
    const latest = events.data[0];
    expect(latest.type).toBe("customer.subscription.updated");
    expect((latest.data.object as any).id).toBe(sub.id);
    expect(latest.data.previous_attributes).toBeDefined();
  });
});
