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

describe("3D Secure Simulation", () => {
  test("3DS-required card enters requires_action on confirm", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_threeDSecureRequired" } as any,
    });
    expect(pm.card?.last4).toBe("3220");

    const pi = await stripe.paymentIntents.create({
      amount: 5000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.status).toBe("requires_action");
    expect(pi.next_action).not.toBeNull();
    expect(pi.next_action!.type).toBe("use_stripe_sdk");
    expect(pi.latest_charge).toBeNull();
  });

  test("re-confirm a requires_action PI completes the payment", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_threeDSecureRequired" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 5000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });
    expect(pi.status).toBe("requires_action");

    const confirmed = await stripe.paymentIntents.confirm(pi.id);
    expect(confirmed.status).toBe("succeeded");
    expect(confirmed.latest_charge).toMatch(/^ch_/);
    expect(confirmed.next_action).toBeNull();
  });

  test("3DS with manual capture: requires_action → confirm → requires_capture", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_threeDSecureRequired" } as any,
    });

    const pi = await stripe.paymentIntents.create({
      amount: 3000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
      capture_method: "manual",
    });
    expect(pi.status).toBe("requires_action");

    const confirmed = await stripe.paymentIntents.confirm(pi.id);
    expect(confirmed.status).toBe("requires_capture");

    const captured = await stripe.paymentIntents.capture(pi.id);
    expect(captured.status).toBe("succeeded");
    expect(captured.amount_received).toBe(3000);
  });

  test("3DS-optional card succeeds without requires_action", async () => {
    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_threeDSecureOptional" } as any,
    });
    expect(pm.card?.last4).toBe("3222");

    const pi = await stripe.paymentIntents.create({
      amount: 2000,
      currency: "usd",
      payment_method: pm.id,
      confirm: true,
    });

    expect(pi.status).toBe("succeeded");
    expect(pi.next_action).toBeNull();
  });
});
