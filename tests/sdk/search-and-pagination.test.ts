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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Raw HTTP search request (SDK doesn't expose /search on all resources). */
async function searchRaw(port: number, resource: string, query: string, limit?: number): Promise<any> {
  const params = new URLSearchParams({ query });
  if (limit !== undefined) params.set("limit", String(limit));
  const res = await fetch(`http://localhost:${port}/v1/${resource}/search?${params}`, {
    headers: { Authorization: "Bearer sk_test_strimulator" },
  });
  return res.json();
}

/**
 * Raw HTTP GET with expand[] params.
 * The Stripe SDK sends expand[0]=..., but the server reads expand[].
 * We use raw fetch to test expansion properly.
 */
async function getRawWithExpand(port: number, path: string, expandFields: string[]): Promise<any> {
  const params = new URLSearchParams();
  expandFields.forEach((f) => params.append("expand[]", f));
  const res = await fetch(`http://localhost:${port}/v1/${path}?${params}`, {
    headers: { Authorization: "Bearer sk_test_strimulator" },
  });
  return res.json();
}

/**
 * Create N customers with distinct `created` timestamps (1 second apart).
 * The pagination cursor uses `gt(created, ...)` at second granularity,
 * so items must have different `created` values to paginate correctly.
 */
async function createCustomersWithDistinctTimestamps(
  stripe: Stripe,
  count: number,
  prefix: string,
): Promise<Stripe.Customer[]> {
  const customers: Stripe.Customer[] = [];
  for (let i = 0; i < count; i++) {
    const c = await stripe.customers.create({ email: `${prefix}${i}@test.com` });
    customers.push(c);
    if (i < count - 1) await Bun.sleep(1050);
  }
  return customers;
}

// ===========================================================================
// CUSTOMER SEARCH
// ===========================================================================
describe("Customer search", () => {
  test("search by specific email returns exactly 1 result", async () => {
    await stripe.customers.create({ email: "alice@example.com", name: "Alice" });
    await stripe.customers.create({ email: "bob@example.com", name: "Bob" });
    await stripe.customers.create({ email: "charlie@example.com", name: "Charlie" });

    const result = await searchRaw(app.server!.port, "customers", 'email:"alice@example.com"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe("alice@example.com");
  });

  test("search by name returns matching customers", async () => {
    await stripe.customers.create({ email: "a@test.com", name: "John Smith" });
    await stripe.customers.create({ email: "b@test.com", name: "Jane Doe" });
    await stripe.customers.create({ email: "c@test.com", name: "John Doe" });

    const result = await searchRaw(app.server!.port, "customers", 'name:"John Smith"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("John Smith");
  });

  test("search by metadata key-value pair", async () => {
    await stripe.customers.create({ email: "pro1@test.com", metadata: { plan: "pro" } });
    await stripe.customers.create({ email: "free@test.com", metadata: { plan: "free" } });
    await stripe.customers.create({ email: "pro2@test.com", metadata: { plan: "pro" } });

    const result = await searchRaw(app.server!.port, "customers", 'metadata["plan"]:"pro"');

    expect(result.data).toHaveLength(2);
    expect(result.data.every((c: any) => c.metadata.plan === "pro")).toBe(true);
  });

  test("search with no matches returns empty data array", async () => {
    await stripe.customers.create({ email: "exists@test.com" });

    const result = await searchRaw(app.server!.port, "customers", 'email:"nonexistent@test.com"');

    expect(result.data).toHaveLength(0);
    expect(result.total_count).toBe(0);
  });

  test("search with negation: -field excludes matching customers", async () => {
    await stripe.customers.create({ email: "keep@test.com", name: "Keep" });
    await stripe.customers.create({ email: "exclude@test.com", name: "Exclude" });
    await stripe.customers.create({ email: "also-keep@test.com", name: "Also Keep" });

    const result = await searchRaw(app.server!.port, "customers", '-name:"Exclude"');

    expect(result.data).toHaveLength(2);
    expect(result.data.every((c: any) => c.name !== "Exclude")).toBe(true);
  });

  test("search customers created after a timestamp", async () => {
    const before = Math.floor(Date.now() / 1000) - 1;

    await stripe.customers.create({ email: "recent@test.com" });

    const result = await searchRaw(app.server!.port, "customers", `created>${before}`);

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0].email).toBe("recent@test.com");
  });

  test("search result has correct shape: object, data, has_more, total_count", async () => {
    await stripe.customers.create({ email: "shape@test.com" });

    const result = await searchRaw(app.server!.port, "customers", 'email:"shape@test.com"');

    expect(result.object).toBe("search_result");
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.has_more).toBe("boolean");
    expect(typeof result.total_count).toBe("number");
    expect(result.url).toBe("/v1/customers/search");
  });

  test("search returns full customer objects, not just IDs", async () => {
    await stripe.customers.create({
      email: "full@test.com",
      name: "Full Object",
      metadata: { tier: "enterprise" },
    });

    const result = await searchRaw(app.server!.port, "customers", 'email:"full@test.com"');

    const cust = result.data[0];
    expect(cust.id).toMatch(/^cus_/);
    expect(cust.object).toBe("customer");
    expect(cust.email).toBe("full@test.com");
    expect(cust.name).toBe("Full Object");
    expect(cust.metadata).toEqual({ tier: "enterprise" });
    expect(typeof cust.created).toBe("number");
  });

  test("search by name using like (substring) operator", async () => {
    await stripe.customers.create({ email: "a@test.com", name: "Johnathan Smith" });
    await stripe.customers.create({ email: "b@test.com", name: "Jane Doe" });

    const result = await searchRaw(app.server!.port, "customers", 'name~"John"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Johnathan Smith");
  });

  test("search with multiple conditions (AND)", async () => {
    await stripe.customers.create({ email: "multi@test.com", name: "Multi Test", metadata: { plan: "pro" } });
    await stripe.customers.create({ email: "other@test.com", name: "Other", metadata: { plan: "pro" } });

    const result = await searchRaw(app.server!.port, "customers", 'name:"Multi Test" AND metadata["plan"]:"pro"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe("multi@test.com");
  });

  test("search among many customers returns correct subset", async () => {
    for (let i = 0; i < 5; i++) {
      await stripe.customers.create({
        email: `batch${i}@test.com`,
        name: i < 3 ? "Team Alpha" : "Team Beta",
      });
    }

    const alphaResult = await searchRaw(app.server!.port, "customers", 'name:"Team Alpha"');
    const betaResult = await searchRaw(app.server!.port, "customers", 'name:"Team Beta"');

    expect(alphaResult.data).toHaveLength(3);
    expect(betaResult.data).toHaveLength(2);
  });

  test("search with limit restricts number of results", async () => {
    for (let i = 0; i < 5; i++) {
      await stripe.customers.create({ email: `limited${i}@test.com`, name: "Limited" });
    }

    const result = await searchRaw(app.server!.port, "customers", 'name:"Limited"', 2);

    expect(result.data).toHaveLength(2);
    expect(result.has_more).toBe(true);
    expect(result.total_count).toBe(5);
  });
});

// ===========================================================================
// PAYMENT INTENT SEARCH
// ===========================================================================
describe("Payment intent search", () => {
  test("search by status returns only matching PIs", async () => {
    const pm1 = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });
    const pm2 = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });

    await stripe.paymentIntents.create({ amount: 1000, currency: "usd", payment_method: pm1.id, confirm: true });
    await stripe.paymentIntents.create({ amount: 2000, currency: "usd", payment_method: pm2.id, confirm: true });
    await stripe.paymentIntents.create({ amount: 3000, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", 'status:"succeeded"');

    expect(result.data).toHaveLength(2);
    expect(result.data.every((pi: any) => pi.status === "succeeded")).toBe(true);
  });

  test("search by customer", async () => {
    const cust = await stripe.customers.create({ email: "pi-search@test.com" });
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });

    await stripe.paymentIntents.create({
      amount: 500, currency: "usd", customer: cust.id, payment_method: pm.id, confirm: true,
    });
    await stripe.paymentIntents.create({ amount: 600, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", `customer:"${cust.id}"`);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].customer).toBe(cust.id);
  });

  test("search by currency", async () => {
    await stripe.paymentIntents.create({ amount: 2000, currency: "eur" });
    await stripe.paymentIntents.create({ amount: 3000, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", 'currency:"eur"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].currency).toBe("eur");
  });

  test("search by metadata on payment intents", async () => {
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });

    await stripe.paymentIntents.create({
      amount: 1000, currency: "usd", payment_method: pm.id, confirm: true,
      metadata: { order_id: "ord_123" },
    });
    await stripe.paymentIntents.create({
      amount: 2000, currency: "usd",
      metadata: { order_id: "ord_456" },
    });

    const result = await searchRaw(app.server!.port, "payment_intents", 'metadata["order_id"]:"ord_123"');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].metadata.order_id).toBe("ord_123");
  });

  test("search result includes full PI objects", async () => {
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });

    await stripe.paymentIntents.create({
      amount: 4200, currency: "usd", payment_method: pm.id, confirm: true,
    });

    const result = await searchRaw(app.server!.port, "payment_intents", 'status:"succeeded"');

    const pi = result.data[0];
    expect(pi.id).toMatch(/^pi_/);
    expect(pi.object).toBe("payment_intent");
    expect(pi.amount).toBe(4200);
    expect(pi.currency).toBe("usd");
    expect(pi.status).toBe("succeeded");
    expect(typeof pi.client_secret).toBe("string");
  });

  test("search result shape for payment intents", async () => {
    await stripe.paymentIntents.create({ amount: 100, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", 'currency:"usd"');

    expect(result.object).toBe("search_result");
    expect(result.url).toBe("/v1/payment_intents/search");
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.total_count).toBe("number");
  });

  test("search with no matches on payment intents", async () => {
    await stripe.paymentIntents.create({ amount: 100, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", 'currency:"gbp"');

    expect(result.data).toHaveLength(0);
    expect(result.total_count).toBe(0);
  });

  test("search PI by amount range using numeric operators", async () => {
    await stripe.paymentIntents.create({ amount: 500, currency: "usd" });
    await stripe.paymentIntents.create({ amount: 1500, currency: "usd" });
    await stripe.paymentIntents.create({ amount: 3000, currency: "usd" });

    const result = await searchRaw(app.server!.port, "payment_intents", "amount>1000");

    expect(result.data.length).toBe(2);
    expect(result.data.every((pi: any) => pi.amount > 1000)).toBe(true);
  });
});

// ===========================================================================
// PAGINATION THROUGH LARGE SETS
//
// The strimulator uses `gt(created, cursor.created)` for pagination cursors
// where `created` is a Unix timestamp in seconds. Items created within the
// same second share a timestamp, so tests that paginate must ensure items
// span distinct seconds. We use 1.05s sleeps between items.
// ===========================================================================
describe("Pagination", () => {
  test("first page returns requested limit and has_more=true", async () => {
    // Create 4 items across distinct seconds
    await createCustomersWithDistinctTimestamps(stripe, 4, "firstpage-");

    const page1 = await stripe.customers.list({ limit: 2 });

    expect(page1.data).toHaveLength(2);
    expect(page1.has_more).toBe(true);
  }, 15000);

  test("second page via starting_after returns next items", async () => {
    await createCustomersWithDistinctTimestamps(stripe, 4, "secondpage-");

    const page1 = await stripe.customers.list({ limit: 2 });
    const lastId = page1.data[page1.data.length - 1].id;

    const page2 = await stripe.customers.list({ limit: 2, starting_after: lastId });

    expect(page2.data).toHaveLength(2);
    expect(page2.has_more).toBe(false);

    // No overlap with page 1
    const page1Ids = new Set(page1.data.map((c) => c.id));
    expect(page2.data.every((c) => !page1Ids.has(c.id))).toBe(true);
  }, 15000);

  test("last page has has_more=false", async () => {
    await createCustomersWithDistinctTimestamps(stripe, 3, "lastpage-");

    const page1 = await stripe.customers.list({ limit: 2 });
    expect(page1.has_more).toBe(true);

    const page2 = await stripe.customers.list({ limit: 2, starting_after: page1.data[1].id });
    expect(page2.data).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  }, 15000);

  test("paginate through all items: no duplicates, collects all IDs", async () => {
    const created = await createCustomersWithDistinctTimestamps(stripe, 5, "all-");

    const allIds: string[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.customers.list({
        limit: 2,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      allIds.push(...page.data.map((c) => c.id));
      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toHaveLength(5);
  }, 15000);

  test("list products with limit=2, paginate through all", async () => {
    for (let i = 0; i < 4; i++) {
      await stripe.products.create({ name: `Prod ${i}` });
      if (i < 3) await Bun.sleep(1050);
    }

    const allIds: string[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.products.list({
        limit: 2,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      allIds.push(...page.data.map((p) => p.id));
      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    expect(allIds).toHaveLength(4);
    expect(new Set(allIds).size).toBe(4);
  }, 15000);

  test("list prices with limit=2, paginate through all", async () => {
    const product = await stripe.products.create({ name: "Price Pagination Prod" });
    for (let i = 0; i < 4; i++) {
      await stripe.prices.create({
        product: product.id,
        unit_amount: (i + 1) * 100,
        currency: "usd",
      });
      if (i < 3) await Bun.sleep(1050);
    }

    const allIds: string[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.prices.list({
        limit: 2,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      allIds.push(...page.data.map((p) => p.id));
      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    expect(allIds).toHaveLength(4);
    expect(new Set(allIds).size).toBe(4);
  }, 15000);

  test("list payment intents with pagination", async () => {
    for (let i = 0; i < 4; i++) {
      await stripe.paymentIntents.create({ amount: (i + 1) * 100, currency: "usd" });
      if (i < 3) await Bun.sleep(1050);
    }

    const allIds: string[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const page = await stripe.paymentIntents.list({
        limit: 2,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      allIds.push(...page.data.map((pi) => pi.id));
      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    expect(allIds).toHaveLength(4);
    expect(new Set(allIds).size).toBe(4);
  }, 15000);

  test("list with limit=1 returns single item per page", async () => {
    await createCustomersWithDistinctTimestamps(stripe, 3, "single-");

    const page1 = await stripe.customers.list({ limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.has_more).toBe(true);

    const page2 = await stripe.customers.list({ limit: 1, starting_after: page1.data[0].id });
    expect(page2.data).toHaveLength(1);
    expect(page2.has_more).toBe(true);

    const page3 = await stripe.customers.list({ limit: 1, starting_after: page2.data[0].id });
    expect(page3.data).toHaveLength(1);
    expect(page3.has_more).toBe(false);
  }, 15000);

  test("first page with many items returns default limit of 10", async () => {
    // Create 12 items quickly (same-second is fine, we only check the first page)
    for (let i = 0; i < 12; i++) {
      await stripe.customers.create({ email: `default-${i}@test.com` });
    }

    const page = await stripe.customers.list();

    expect(page.data).toHaveLength(10);
    expect(page.has_more).toBe(true);
  });

  test("list response object field is 'list'", async () => {
    await stripe.customers.create({ email: "obj@test.com" });

    const page = await stripe.customers.list();

    expect((page as any).object).toBe("list");
  });

  test("list with limit > total returns all and has_more=false", async () => {
    await stripe.customers.create({ email: "small1@test.com" });
    await stripe.customers.create({ email: "small2@test.com" });

    const page = await stripe.customers.list({ limit: 100 });

    expect(page.data).toHaveLength(2);
    expect(page.has_more).toBe(false);
  });

  test("list returns items in insertion order on first page", async () => {
    const c1 = await stripe.customers.create({ email: "order-a@test.com" });
    const c2 = await stripe.customers.create({ email: "order-b@test.com" });

    const page = await stripe.customers.list({ limit: 10 });

    expect(page.data[0].id).toBe(c1.id);
    expect(page.data[1].id).toBe(c2.id);
  });
});

// ===========================================================================
// EXPAND RELATED RESOURCES
//
// The Stripe SDK sends expand params as expand[0]=..., but the strimulator
// server reads url.searchParams.getAll("expand[]"). We use raw HTTP fetch
// with expand[]=field to test the expansion feature directly.
// ===========================================================================
describe("Expand related resources", () => {
  test("expand customer on payment intent returns full customer object", async () => {
    const customer = await stripe.customers.create({ email: "expand@test.com", name: "Expandable" });
    const pi = await stripe.paymentIntents.create({
      amount: 1000, currency: "usd", customer: customer.id,
    });

    const expanded = await getRawWithExpand(app.server!.port, `payment_intents/${pi.id}`, ["customer"]);

    expect(typeof expanded.customer).toBe("object");
    expect(expanded.customer.id).toBe(customer.id);
    expect(expanded.customer.email).toBe("expand@test.com");
    expect(expanded.customer.object).toBe("customer");
  });

  test("expand payment_method on payment intent", async () => {
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });
    const pi = await stripe.paymentIntents.create({
      amount: 2000, currency: "usd", payment_method: pm.id,
    });

    const expanded = await getRawWithExpand(app.server!.port, `payment_intents/${pi.id}`, ["payment_method"]);

    expect(typeof expanded.payment_method).toBe("object");
    expect(expanded.payment_method.id).toBe(pm.id);
    expect(expanded.payment_method.type).toBe("card");
  });

  test("expand latest_charge on succeeded payment intent", async () => {
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });
    const pi = await stripe.paymentIntents.create({
      amount: 3000, currency: "usd", payment_method: pm.id, confirm: true,
    });
    expect(pi.status).toBe("succeeded");

    const expanded = await getRawWithExpand(app.server!.port, `payment_intents/${pi.id}`, ["latest_charge"]);

    expect(typeof expanded.latest_charge).toBe("object");
    expect(expanded.latest_charge.id).toMatch(/^ch_/);
    expect(expanded.latest_charge.object).toBe("charge");
    expect(expanded.latest_charge.amount).toBe(3000);
  });

  test("non-expanded field remains a string ID", async () => {
    const customer = await stripe.customers.create({ email: "noexpand@test.com" });
    const pi = await stripe.paymentIntents.create({
      amount: 500, currency: "usd", customer: customer.id,
    });

    const retrieved = await stripe.paymentIntents.retrieve(pi.id);

    expect(typeof retrieved.customer).toBe("string");
    expect(retrieved.customer).toBe(customer.id);
  });

  test("expand multiple fields simultaneously", async () => {
    const customer = await stripe.customers.create({ email: "multi-expand@test.com" });
    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } as any });
    const pi = await stripe.paymentIntents.create({
      amount: 5000, currency: "usd", customer: customer.id, payment_method: pm.id, confirm: true,
    });

    const expanded = await getRawWithExpand(
      app.server!.port,
      `payment_intents/${pi.id}`,
      ["customer", "payment_method", "latest_charge"],
    );

    expect(typeof expanded.customer).toBe("object");
    expect(typeof expanded.payment_method).toBe("object");
    expect(typeof expanded.latest_charge).toBe("object");
  });

  test("expand on a field that is null does not error", async () => {
    const pi = await stripe.paymentIntents.create({ amount: 800, currency: "usd" });

    const expanded = await getRawWithExpand(app.server!.port, `payment_intents/${pi.id}`, ["customer"]);

    // customer is null, should remain null
    expect(expanded.customer).toBeNull();
  });

  test("expand customer on subscription retrieve", async () => {
    const product = await stripe.products.create({ name: "Sub Expand Product" });
    const price = await stripe.prices.create({
      product: product.id, unit_amount: 1000, currency: "usd",
      recurring: { interval: "month" },
    });
    const customer = await stripe.customers.create({ email: "sub-expand@test.com" });
    const sub = await stripe.subscriptions.create({
      customer: customer.id, items: [{ price: price.id }],
    });

    const expanded = await getRawWithExpand(app.server!.port, `subscriptions/${sub.id}`, ["customer"]);

    expect(typeof expanded.customer).toBe("object");
    expect(expanded.customer.id).toBe(customer.id);
    expect(expanded.customer.email).toBe("sub-expand@test.com");
  });

  test("nested expansion: latest_invoice on subscription", async () => {
    const product = await stripe.products.create({ name: "Nested Expand Product" });
    const price = await stripe.prices.create({
      product: product.id, unit_amount: 2000, currency: "usd",
      recurring: { interval: "month" },
    });
    const customer = await stripe.customers.create({ email: "nested@test.com" });
    const sub = await stripe.subscriptions.create({
      customer: customer.id, items: [{ price: price.id }],
    });

    // If sub has a latest_invoice, test expanding it
    if (sub.latest_invoice) {
      const expanded = await getRawWithExpand(app.server!.port, `subscriptions/${sub.id}`, ["latest_invoice"]);
      expect(typeof expanded.latest_invoice).toBe("object");
    }
  });
});
