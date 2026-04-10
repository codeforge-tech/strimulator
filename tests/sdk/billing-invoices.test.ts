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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createCustomer(email = "invoice-test@example.com") {
  return stripe.customers.create({ email, name: "Invoice Tester" });
}

async function createDraftInvoice(customerId: string, amountDue = 5000) {
  // The SDK doesn't pass amount_due directly, so we use the raw API
  const port = app.server!.port;
  const res = await fetch(`http://localhost:${port}/v1/invoices`, {
    method: "POST",
    headers: {
      Authorization: "Bearer sk_test_strimulator",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `customer=${customerId}&amount_due=${amountDue}&currency=usd`,
  });
  return res.json() as Promise<Stripe.Invoice>;
}

async function createSubscriptionFixture() {
  const customer = await createCustomer();
  const product = await stripe.products.create({ name: "Sub Product" });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 2999,
    currency: "usd",
    recurring: { interval: "month" },
  });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id }],
  });
  return { customer, product, price, subscription };
}

// ─── Manual invoice lifecycle ─────────────────────────────────────────────────

describe("Manual invoice lifecycle", () => {
  test("create invoice for customer returns status=draft", async () => {
    const customer = await createCustomer();
    const invoice = await createDraftInvoice(customer.id);

    expect(invoice.object).toBe("invoice");
    expect(invoice.id).toMatch(/^in_/);
    expect(invoice.status).toBe("draft");
    expect(invoice.customer).toBe(customer.id);
  });

  test("finalize draft invoice transitions to status=open", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);

    expect(finalized.status).toBe("open");
    expect(finalized.id).toBe(draft.id);
  });

  test("pay open invoice transitions to status=paid", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 3000);
    await stripe.invoices.finalizeInvoice(draft.id);

    const paid = await stripe.invoices.pay(draft.id);

    expect(paid.status).toBe("paid");
    expect(paid.id).toBe(draft.id);
    expect(paid.paid).toBe(true);
  });

  test("void open invoice transitions to status=void", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);
    await stripe.invoices.finalizeInvoice(draft.id);

    const voided = await stripe.invoices.voidInvoice(draft.id);

    expect(voided.status).toBe("void");
    expect(voided.id).toBe(draft.id);
  });

  test("amount_due, amount_paid, amount_remaining change through lifecycle", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 7500);

    // Draft: nothing paid yet
    expect(draft.amount_due).toBe(7500);
    expect(draft.amount_paid).toBe(0);
    expect(draft.amount_remaining).toBe(7500);

    // Open: still nothing paid
    const open = await stripe.invoices.finalizeInvoice(draft.id);
    expect(open.amount_due).toBe(7500);
    expect(open.amount_paid).toBe(0);
    expect(open.amount_remaining).toBe(7500);

    // Paid: fully paid
    const paid = await stripe.invoices.pay(draft.id);
    expect(paid.amount_due).toBe(7500);
    expect(paid.amount_paid).toBe(7500);
    expect(paid.amount_remaining).toBe(0);
  });

  test("finalize generates an invoice number", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    // Draft should have no number
    expect(draft.number).toBeNull();

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);
    expect(finalized.number).toBeTruthy();
    expect(typeof finalized.number).toBe("string");
    expect(finalized.number).toMatch(/^INV-/);
  });

  test("two invoices have different invoice numbers", async () => {
    const customer = await createCustomer();

    const draft1 = await createDraftInvoice(customer.id);
    const draft2 = await createDraftInvoice(customer.id);

    const finalized1 = await stripe.invoices.finalizeInvoice(draft1.id);
    const finalized2 = await stripe.invoices.finalizeInvoice(draft2.id);

    expect(finalized1.number).not.toBe(finalized2.number);
  });

  test("invoice numbers are sequential", async () => {
    const customer = await createCustomer();

    const draft1 = await createDraftInvoice(customer.id);
    const draft2 = await createDraftInvoice(customer.id);
    const draft3 = await createDraftInvoice(customer.id);

    const f1 = await stripe.invoices.finalizeInvoice(draft1.id);
    const f2 = await stripe.invoices.finalizeInvoice(draft2.id);
    const f3 = await stripe.invoices.finalizeInvoice(draft3.id);

    // Extract the numeric part from INV-XXXXXX
    const num1 = parseInt(f1.number!.replace("INV-", ""), 10);
    const num2 = parseInt(f2.number!.replace("INV-", ""), 10);
    const num3 = parseInt(f3.number!.replace("INV-", ""), 10);

    expect(num2).toBe(num1 + 1);
    expect(num3).toBe(num2 + 1);
  });

  test("pay updates attempted and attempt_count", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);

    // Draft: not attempted, attempt_count=0
    expect(draft.attempted).toBe(false);
    expect(draft.attempt_count).toBe(0);

    await stripe.invoices.finalizeInvoice(draft.id);
    const paid = await stripe.invoices.pay(draft.id);

    expect(paid.attempted).toBe(true);
    expect(paid.attempt_count).toBe(1);
  });

  test("retrieve invoice at each stage shows consistent status", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    // Retrieve draft
    const retrievedDraft = await stripe.invoices.retrieve(draft.id);
    expect(retrievedDraft.status).toBe("draft");

    // Finalize and retrieve
    await stripe.invoices.finalizeInvoice(draft.id);
    const retrievedOpen = await stripe.invoices.retrieve(draft.id);
    expect(retrievedOpen.status).toBe("open");

    // Pay and retrieve
    await stripe.invoices.pay(draft.id);
    const retrievedPaid = await stripe.invoices.retrieve(draft.id);
    expect(retrievedPaid.status).toBe("paid");
  });

  test("invoice.customer matches the customer id", async () => {
    const customer = await createCustomer("match@example.com");
    const invoice = await createDraftInvoice(customer.id);

    expect(invoice.customer).toBe(customer.id);

    const retrieved = await stripe.invoices.retrieve(invoice.id);
    expect(retrieved.customer).toBe(customer.id);
  });

  test("finalize sets effective_at to a timestamp", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    expect(draft.effective_at).toBeNull();

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);
    expect(finalized.effective_at).toBeGreaterThan(0);
  });
});

// ─── Invoice state machine enforcement ────────────────────────────────────────

describe("Invoice state machine enforcement", () => {
  test("cannot pay a draft invoice directly", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);

    try {
      await stripe.invoices.pay(draft.id);
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("draft");
      expect(err.message).toContain("pay");
    }
  });

  test("cannot void a draft invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    try {
      await stripe.invoices.voidInvoice(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("draft");
      expect(err.message).toContain("void");
    }
  });

  test("cannot finalize an already open invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);
    await stripe.invoices.finalizeInvoice(draft.id);

    try {
      await stripe.invoices.finalizeInvoice(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("open");
      expect(err.message).toContain("finalize");
    }
  });

  test("cannot pay an already paid invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);
    await stripe.invoices.finalizeInvoice(draft.id);
    await stripe.invoices.pay(draft.id);

    try {
      await stripe.invoices.pay(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("paid");
      expect(err.message).toContain("pay");
    }
  });

  test("cannot void a paid invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);
    await stripe.invoices.finalizeInvoice(draft.id);
    await stripe.invoices.pay(draft.id);

    try {
      await stripe.invoices.voidInvoice(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("paid");
      expect(err.message).toContain("void");
    }
  });

  test("cannot pay a voided invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);
    await stripe.invoices.finalizeInvoice(draft.id);
    await stripe.invoices.voidInvoice(draft.id);

    try {
      await stripe.invoices.pay(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("void");
      expect(err.message).toContain("pay");
    }
  });

  test("cannot finalize a paid invoice", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);
    await stripe.invoices.finalizeInvoice(draft.id);
    await stripe.invoices.pay(draft.id);

    try {
      await stripe.invoices.finalizeInvoice(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("paid");
      expect(err.message).toContain("finalize");
    }
  });

  test("error messages describe the invalid transition", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id, 1000);

    try {
      await stripe.invoices.pay(draft.id);
      expect(true).toBe(false);
    } catch (err: any) {
      // The error format: "You cannot pay this invoice because it has a status of draft."
      expect(err.message).toContain("You cannot pay this invoice");
      expect(err.message).toContain("status of draft");
      expect(err.code).toBe("invoice_unexpected_state");
    }
  });
});

// ─── Subscription invoices ────────────────────────────────────────────────────

describe("Subscription invoices", () => {
  test("using test clock: advance billing period creates new invoice", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Clock Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 4999,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);

    // Create test clock
    const port = app.server!.port;
    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}&name=billing-test`,
    });
    const clock = await clockRes.json() as any;
    expect(clock.id).toMatch(/^clock_/);

    // Create subscription linked to test clock
    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;
    expect(sub.status).toBe("active");

    // Advance clock by 31 days to trigger a billing cycle
    const advancedTime = frozenTime + 31 * 24 * 60 * 60;
    const advRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${advancedTime}`,
    });
    const advanced = await advRes.json() as any;
    expect(advanced.status).toBe("ready");

    // List invoices for this subscription — should have at least one
    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
  });

  test("test clock invoice has correct amount matching subscription price", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Amount Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1299,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Advance past one billing period
    const advancedTime = frozenTime + 31 * 24 * 60 * 60;
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${advancedTime}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    const billingInvoice = invoices.data.find((inv) => inv.amount_due === 1299);
    expect(billingInvoice).toBeDefined();
    expect(billingInvoice!.amount_due).toBe(1299);
  });

  test("list invoices for a subscription returns only that subscription's invoices", async () => {
    const customer = await createCustomer();

    // Create a standalone invoice not linked to any subscription
    await createDraftInvoice(customer.id, 100);

    const product = await stripe.products.create({ name: "List Sub Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Advance to trigger billing
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const subInvoices = await stripe.invoices.list({ subscription: sub.id } as any);
    // All returned invoices should belong to this subscription
    for (const inv of subInvoices.data) {
      expect(inv.subscription).toBe(sub.id);
    }
  });

  test("test clock invoice has billing_reason set to subscription_cycle", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Reason Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 500,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    const billingInvoice = invoices.data[0];
    expect(billingInvoice.billing_reason).toBe("subscription_cycle");
  });

  test("test clock auto-created invoice is finalized and paid", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Auto Pay Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1500,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);

    // The billing invoice should be paid (auto-finalized and auto-paid)
    const billingInvoice = invoices.data[0];
    expect(billingInvoice.status).toBe("paid");
    expect(billingInvoice.paid).toBe(true);
    expect(billingInvoice.number).toBeTruthy();
  });

  test("multiple billing periods create multiple invoices", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Multi Period Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Advance by 91 days (3 billing periods of 30 days each)
    const advancedTime = frozenTime + 91 * 24 * 60 * 60;
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${advancedTime}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 100 } as any);
    // Should have 3 invoices for 3 billing periods
    expect(invoices.data.length).toBe(3);
  });

  test("each billing invoice has a unique number", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Unique Num Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Advance by 61 days (2 billing periods)
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 61 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 100 } as any);
    expect(invoices.data.length).toBe(2);

    const numbers = invoices.data.map((inv) => inv.number);
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(2);
  });

  test("invoice currency matches subscription currency", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Currency Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "eur",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    expect(invoices.data[0].currency).toBe("eur");
  });

  test("invoice customer matches subscription customer", async () => {
    const customer = await createCustomer("sub-cust@example.com");
    const product = await stripe.products.create({ name: "Cust Match Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 750,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    expect(invoices.data[0].customer).toBe(customer.id);
  });
});

// ─── Invoice search and listing ───────────────────────────────────────────────

describe("Invoice search and listing", () => {
  test("list invoices by customer", async () => {
    const customer1 = await createCustomer("c1@example.com");
    const customer2 = await createCustomer("c2@example.com");

    await createDraftInvoice(customer1.id, 100);
    await createDraftInvoice(customer1.id, 200);
    await createDraftInvoice(customer2.id, 300);

    const c1Invoices = await stripe.invoices.list({ customer: customer1.id });
    expect(c1Invoices.data.length).toBe(2);
    for (const inv of c1Invoices.data) {
      expect(inv.customer).toBe(customer1.id);
    }

    const c2Invoices = await stripe.invoices.list({ customer: customer2.id });
    expect(c2Invoices.data.length).toBe(1);
    expect(c2Invoices.data[0].customer).toBe(customer2.id);
  });

  test("list invoices by subscription", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "List by Sub Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Create unrelated invoice
    await createDraftInvoice(customer.id, 100);

    // Advance clock to generate a billing invoice
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const subInvoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(subInvoices.data.length).toBeGreaterThanOrEqual(1);
    for (const inv of subInvoices.data) {
      expect(inv.subscription).toBe(sub.id);
    }

    // All invoices for this customer should be more than just the subscription ones
    const allInvoices = await stripe.invoices.list({ customer: customer.id });
    expect(allInvoices.data.length).toBeGreaterThan(subInvoices.data.length);
  });

  test("search invoices by status", async () => {
    const customer = await createCustomer();
    const draft1 = await createDraftInvoice(customer.id, 100);
    const draft2 = await createDraftInvoice(customer.id, 200);
    await stripe.invoices.finalizeInvoice(draft1.id);

    const port = app.server!.port;
    const searchRes = await fetch(
      `http://localhost:${port}/v1/invoices/search?query=${encodeURIComponent('status:"open"')}`,
      { headers: { Authorization: "Bearer sk_test_strimulator" } },
    );
    const body = await searchRes.json() as any;

    expect(body.object).toBe("search_result");
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("open");
    expect(body.data[0].id).toBe(draft1.id);
  });

  test("search invoices by customer", async () => {
    const customer1 = await createCustomer("search-c1@example.com");
    const customer2 = await createCustomer("search-c2@example.com");

    await createDraftInvoice(customer1.id, 100);
    await createDraftInvoice(customer1.id, 200);
    await createDraftInvoice(customer2.id, 300);

    const port = app.server!.port;
    const searchRes = await fetch(
      `http://localhost:${port}/v1/invoices/search?query=${encodeURIComponent(`customer:"${customer1.id}"`)}`,
      { headers: { Authorization: "Bearer sk_test_strimulator" } },
    );
    const body = await searchRes.json() as any;

    expect(body.total_count).toBe(2);
    for (const inv of body.data) {
      expect(inv.customer).toBe(customer1.id);
    }
  });

  test("pagination with limit returns correct page size", async () => {
    const customer = await createCustomer();

    // Create 5 invoices
    for (let i = 0; i < 5; i++) {
      await createDraftInvoice(customer.id, (i + 1) * 100);
    }

    // Get first page with limit 3
    const page1 = await stripe.invoices.list({ customer: customer.id, limit: 3 });
    expect(page1.data.length).toBe(3);
    expect(page1.has_more).toBe(true);

    // Verify all returned invoices belong to the customer
    for (const inv of page1.data) {
      expect(inv.customer).toBe(customer.id);
    }
  });

  test("list returns object=list shape with has_more", async () => {
    const customer = await createCustomer();
    await createDraftInvoice(customer.id, 100);

    const list = await stripe.invoices.list({ customer: customer.id });
    expect(list.object).toBe("list");
    expect(Array.isArray(list.data)).toBe(true);
    expect(typeof list.has_more).toBe("boolean");
  });

  test("search result has correct shape (object, data, has_more, total_count)", async () => {
    const customer = await createCustomer();
    await createDraftInvoice(customer.id, 100);

    const port = app.server!.port;
    const searchRes = await fetch(
      `http://localhost:${port}/v1/invoices/search?query=${encodeURIComponent('status:"draft"')}`,
      { headers: { Authorization: "Bearer sk_test_strimulator" } },
    );
    const body = await searchRes.json() as any;

    expect(body.object).toBe("search_result");
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.has_more).toBe("boolean");
    expect(typeof body.total_count).toBe("number");
    expect(body.url).toBe("/v1/invoices/search");
    expect(body.next_page).toBeNull();
  });

  test("list all invoices without filters returns everything", async () => {
    const customer = await createCustomer();
    await createDraftInvoice(customer.id, 100);
    await createDraftInvoice(customer.id, 200);
    await createDraftInvoice(customer.id, 300);

    const all = await stripe.invoices.list();
    expect(all.data.length).toBe(3);
  });
});

// ─── Invoice with expansion ──────────────────────────────────────────────────
// Note: The Stripe SDK sends expand as expand[0]=field, but the server expects
// expand[]=field. We use raw fetch with expand[]=field to test expansion directly.

async function fetchInvoiceWithExpand(invoiceId: string, expandFields: string[]): Promise<any> {
  const port = app.server!.port;
  const expandParams = expandFields.map((f) => `expand[]=${encodeURIComponent(f)}`).join("&");
  const res = await fetch(`http://localhost:${port}/v1/invoices/${invoiceId}?${expandParams}`, {
    headers: { Authorization: "Bearer sk_test_strimulator" },
  });
  return res.json();
}

describe("Invoice with expansion", () => {
  test("expand customer on invoice retrieve", async () => {
    const customer = await createCustomer("expand-cust@example.com");
    const invoice = await createDraftInvoice(customer.id);

    const expanded = await fetchInvoiceWithExpand(invoice.id, ["customer"]);

    // customer should now be an object, not a string
    expect(typeof expanded.customer).toBe("object");
    expect(expanded.customer.id).toBe(customer.id);
    expect(expanded.customer.email).toBe("expand-cust@example.com");
    expect(expanded.customer.object).toBe("customer");
  });

  test("expand subscription on invoice", async () => {
    const customer = await createCustomer();
    const product = await stripe.products.create({ name: "Expand Sub Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1500,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const frozenTime = Math.floor(Date.now() / 1000);
    const port = app.server!.port;

    const clockRes = await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime}`,
    });
    const clock = await clockRes.json() as any;

    const subRes = await fetch(`http://localhost:${port}/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}&items[0][price]=${price.id}&test_clock=${clock.id}`,
    });
    const sub = await subRes.json() as any;

    // Advance to get an invoice with subscription reference
    await fetch(`http://localhost:${port}/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `frozen_time=${frozenTime + 31 * 24 * 60 * 60}`,
    });

    const invoices = await stripe.invoices.list({ subscription: sub.id } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    const invoiceId = invoices.data[0].id;

    const expanded = await fetchInvoiceWithExpand(invoiceId, ["subscription"]);

    expect(typeof expanded.subscription).toBe("object");
    expect(expanded.subscription.id).toBe(sub.id);
    expect(expanded.subscription.object).toBe("subscription");
  });

  test("non-expanded invoice keeps customer as string ID", async () => {
    const customer = await createCustomer();
    const invoice = await createDraftInvoice(customer.id);

    const retrieved = await stripe.invoices.retrieve(invoice.id);

    expect(typeof retrieved.customer).toBe("string");
    expect(retrieved.customer).toBe(customer.id);
  });

  test("expand customer on draft invoice without subscription", async () => {
    const customer = await createCustomer("solo-expand@example.com");
    const invoice = await createDraftInvoice(customer.id, 2500);

    const expanded = await fetchInvoiceWithExpand(invoice.id, ["customer"]);

    expect(expanded.customer.id).toBe(customer.id);
    expect(expanded.customer.object).toBe("customer");

    // subscription should remain null (not expanded)
    expect(expanded.subscription).toBeNull();
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  test("create invoice for non-existent customer succeeds (no FK validation)", async () => {
    // Strimulator does not enforce FK constraints at the invoice level
    // The invoice service just stores the customer ID
    const invoice = await createDraftInvoice("cus_nonexistent", 1000);
    expect(invoice.id).toMatch(/^in_/);
    expect(invoice.customer).toBe("cus_nonexistent");
  });

  test("retrieve non-existent invoice returns 404", async () => {
    try {
      await stripe.invoices.retrieve("in_nonexistent_12345");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain("No such invoice");
    }
  });

  test("multiple invoices for same customer are all accessible", async () => {
    const customer = await createCustomer("multi@example.com");

    const inv1 = await createDraftInvoice(customer.id, 1000);
    const inv2 = await createDraftInvoice(customer.id, 2000);
    const inv3 = await createDraftInvoice(customer.id, 3000);

    // Each can be individually retrieved
    const r1 = await stripe.invoices.retrieve(inv1.id);
    const r2 = await stripe.invoices.retrieve(inv2.id);
    const r3 = await stripe.invoices.retrieve(inv3.id);

    expect(r1.id).toBe(inv1.id);
    expect(r2.id).toBe(inv2.id);
    expect(r3.id).toBe(inv3.id);

    expect(r1.amount_due).toBe(1000);
    expect(r2.amount_due).toBe(2000);
    expect(r3.amount_due).toBe(3000);

    // All show up in the list
    const list = await stripe.invoices.list({ customer: customer.id });
    expect(list.data.length).toBe(3);
  });

  test("invoice defaults: currency=usd, amount_due=0 when not specified", async () => {
    const customer = await createCustomer();
    const port = app.server!.port;

    const res = await fetch(`http://localhost:${port}/v1/invoices`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk_test_strimulator",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `customer=${customer.id}`,
    });
    const invoice = await res.json() as any;

    expect(invoice.currency).toBe("usd");
    expect(invoice.amount_due).toBe(0);
    expect(invoice.amount_paid).toBe(0);
    expect(invoice.amount_remaining).toBe(0);
  });

  test("invoice object field is always 'invoice'", async () => {
    const customer = await createCustomer();
    const draft = await createDraftInvoice(customer.id);

    expect(draft.object).toBe("invoice");

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);
    expect(finalized.object).toBe("invoice");

    const paid = await stripe.invoices.pay(draft.id);
    expect(paid.object).toBe("invoice");
  });

  test("invoice livemode is always false in strimulator", async () => {
    const customer = await createCustomer();
    const invoice = await createDraftInvoice(customer.id);

    expect(invoice.livemode).toBe(false);
  });

  test("invoice metadata is empty object by default", async () => {
    const customer = await createCustomer();
    const invoice = await createDraftInvoice(customer.id);

    expect(invoice.metadata).toEqual({});
  });

  test("invoice subtotal and total equal amount_due", async () => {
    const customer = await createCustomer();
    const invoice = await createDraftInvoice(customer.id, 4200);

    expect(invoice.subtotal).toBe(4200);
    expect(invoice.total).toBe(4200);
    expect(invoice.amount_due).toBe(4200);
  });
});
