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

describe("Payment Flow SDK Tests", () => {
  test("full payment flow: create customer → create PM → attach → create PI with confirm → succeeded", async () => {
    // Create customer
    const customer = await stripe.customers.create({
      email: "sdk-test@example.com",
      name: "SDK Test User",
    });
    expect(customer.id).toMatch(/^cus_/);
    expect(customer.email).toBe("sdk-test@example.com");

    // Create payment method
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });
    expect(pm.id).toMatch(/^pm_/);
    expect(pm.type).toBe("card");

    // Attach PM to customer
    const attached = await stripe.paymentMethods.attach(pm.id, {
      customer: customer.id,
    });
    expect(attached.customer).toBe(customer.id);

    // Create and confirm payment intent
    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.id).toMatch(/^pi_/);
    expect(pi.status).toBe("succeeded");
    expect(pi.amount).toBe(2000);
    expect(pi.amount_received).toBe(2000);
  });

  test("manual capture: create PI with confirm=true + capture_method=manual → requires_capture → capture → succeeded", async () => {
    // Create payment method
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" } as any,
    });

    // Create and confirm payment intent with manual capture
    const pi = await stripe.paymentIntents.create({
      amount: 3000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
      capture_method: "manual",
    });

    expect(pi.id).toMatch(/^pi_/);
    expect(pi.status).toBe("requires_capture");

    // Capture
    const captured = await stripe.paymentIntents.capture(pi.id);
    expect(captured.status).toBe("succeeded");
    expect(captured.amount_received).toBe(3000);
  });

  test("create and retrieve customer: verify fields match", async () => {
    const customer = await stripe.customers.create({
      email: "retrieve-test@example.com",
      name: "Retrieve Test",
      metadata: { plan: "pro", userId: "42" },
    });

    expect(customer.id).toMatch(/^cus_/);

    const retrieved = await stripe.customers.retrieve(customer.id);
    // Cast to non-deleted customer
    const c = retrieved as Stripe.Customer;
    expect(c.id).toBe(customer.id);
    expect(c.email).toBe("retrieve-test@example.com");
    expect(c.name).toBe("Retrieve Test");
    expect(c.metadata).toEqual({ plan: "pro", userId: "42" });
  });
});
