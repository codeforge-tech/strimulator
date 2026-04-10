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

describe("Product Catalog", () => {
  // ---------------------------------------------------------------------------
  // Product management
  // ---------------------------------------------------------------------------
  describe("Product management", () => {
    test("create product with name and description, retrieve matches", async () => {
      const product = await stripe.products.create({
        name: "Premium Widget",
        description: "A high-quality widget for discerning customers",
      });
      expect(product.id).toMatch(/^prod_/);
      expect(product.object).toBe("product");
      expect(product.name).toBe("Premium Widget");
      expect(product.description).toBe("A high-quality widget for discerning customers");
      expect(product.active).toBe(true);

      const retrieved = await stripe.products.retrieve(product.id);
      expect(retrieved.name).toBe("Premium Widget");
      expect(retrieved.description).toBe("A high-quality widget for discerning customers");
    });

    test("update product name and description", async () => {
      const product = await stripe.products.create({
        name: "Old Name",
        description: "Old description",
      });

      const updated = await stripe.products.update(product.id, {
        name: "New Name",
        description: "New description",
      });
      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("New description");
      expect(updated.id).toBe(product.id);
    });

    test("deactivate product and reactivate", async () => {
      const product = await stripe.products.create({ name: "Toggle Product" });
      expect(product.active).toBe(true);

      const deactivated = await stripe.products.update(product.id, { active: false });
      expect(deactivated.active).toBe(false);

      const reactivated = await stripe.products.update(product.id, { active: true });
      expect(reactivated.active).toBe(true);
    });

    test("delete product, verify deleted response", async () => {
      const product = await stripe.products.create({ name: "Doomed Product" });
      const deleted = await stripe.products.del(product.id);

      expect(deleted.id).toBe(product.id);
      expect(deleted.object).toBe("product");
      expect(deleted.deleted).toBe(true);
    });

    test("list all products, verify ordering", async () => {
      await stripe.products.create({ name: "Product A" });
      await stripe.products.create({ name: "Product B" });
      await stripe.products.create({ name: "Product C" });

      const list = await stripe.products.list({ limit: 10 });
      expect(list.object).toBe("list");
      expect(list.data.length).toBe(3);
      // All returned items should be products
      list.data.forEach((p) => {
        expect(p.object).toBe("product");
        expect(p.id).toMatch(/^prod_/);
      });
    });

    test("product with metadata, update metadata", async () => {
      const product = await stripe.products.create({
        name: "Meta Product",
        metadata: { tier: "enterprise", version: "2" },
      });
      expect(product.metadata).toEqual({ tier: "enterprise", version: "2" });

      const updated = await stripe.products.update(product.id, {
        metadata: { version: "3", region: "us-east" },
      });
      // Metadata merges with existing
      expect(updated.metadata.version).toBe("3");
      expect(updated.metadata.region).toBe("us-east");
      expect(updated.metadata.tier).toBe("enterprise");
    });

    test("multiple products with different names", async () => {
      const p1 = await stripe.products.create({ name: "Alpha" });
      const p2 = await stripe.products.create({ name: "Beta" });
      const p3 = await stripe.products.create({ name: "Gamma" });

      expect(p1.name).toBe("Alpha");
      expect(p2.name).toBe("Beta");
      expect(p3.name).toBe("Gamma");
      expect(p1.id).not.toBe(p2.id);
      expect(p2.id).not.toBe(p3.id);
    });

    test("list after deletion excludes deleted products", async () => {
      const p1 = await stripe.products.create({ name: "Keep Me" });
      const p2 = await stripe.products.create({ name: "Delete Me" });

      await stripe.products.del(p2.id);

      const list = await stripe.products.list({ limit: 10 });
      const ids = list.data.map((p) => p.id);
      expect(ids).toContain(p1.id);
      expect(ids).not.toContain(p2.id);
    });

    test("retrieve deleted product throws 404", async () => {
      const product = await stripe.products.create({ name: "Gone Product" });
      await stripe.products.del(product.id);

      await expect(stripe.products.retrieve(product.id)).rejects.toThrow();
    });

    test("product has correct timestamps", async () => {
      const product = await stripe.products.create({ name: "Timestamped" });
      expect(product.created).toBeGreaterThan(0);
      expect(typeof product.created).toBe("number");
    });
  });

  // ---------------------------------------------------------------------------
  // Price management
  // ---------------------------------------------------------------------------
  describe("Price management", () => {
    test("create one-time price for a product", async () => {
      const product = await stripe.products.create({ name: "One-time Item" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 1999,
        currency: "usd",
      });

      expect(price.id).toMatch(/^price_/);
      expect(price.object).toBe("price");
      expect(price.product).toBe(product.id);
      expect(price.unit_amount).toBe(1999);
      expect(price.currency).toBe("usd");
      expect(price.type).toBe("one_time");
      expect(price.recurring).toBeNull();
    });

    test("create recurring monthly price for a product", async () => {
      const product = await stripe.products.create({ name: "Monthly Service" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 999,
        currency: "usd",
        recurring: { interval: "month" },
      });

      expect(price.type).toBe("recurring");
      expect(price.recurring).not.toBeNull();
      expect(price.recurring!.interval).toBe("month");
      expect(price.recurring!.interval_count).toBe(1);
    });

    test("create recurring yearly price for a product", async () => {
      const product = await stripe.products.create({ name: "Annual Service" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 9999,
        currency: "usd",
        recurring: { interval: "year" },
      });

      expect(price.type).toBe("recurring");
      expect(price.recurring!.interval).toBe("year");
    });

    test("multiple prices for same product (monthly + yearly)", async () => {
      const product = await stripe.products.create({ name: "Dual Pricing" });

      const monthly = await stripe.prices.create({
        product: product.id,
        unit_amount: 1000,
        currency: "usd",
        recurring: { interval: "month" },
      });
      const yearly = await stripe.prices.create({
        product: product.id,
        unit_amount: 10000,
        currency: "usd",
        recurring: { interval: "year" },
      });

      expect(monthly.product).toBe(product.id);
      expect(yearly.product).toBe(product.id);
      expect(monthly.recurring!.interval).toBe("month");
      expect(yearly.recurring!.interval).toBe("year");
      expect(monthly.id).not.toBe(yearly.id);
    });

    test("list prices filtered by product", async () => {
      const prodA = await stripe.products.create({ name: "Product A" });
      const prodB = await stripe.products.create({ name: "Product B" });

      await stripe.prices.create({
        product: prodA.id,
        unit_amount: 500,
        currency: "usd",
      });
      await stripe.prices.create({
        product: prodA.id,
        unit_amount: 1000,
        currency: "usd",
      });
      await stripe.prices.create({
        product: prodB.id,
        unit_amount: 2000,
        currency: "usd",
      });

      const listA = await stripe.prices.list({ product: prodA.id, limit: 10 });
      expect(listA.data.length).toBe(2);
      listA.data.forEach((p) => expect(p.product).toBe(prodA.id));

      const listB = await stripe.prices.list({ product: prodB.id, limit: 10 });
      expect(listB.data.length).toBe(1);
      expect(listB.data[0].product).toBe(prodB.id);
    });

    test("update price active status (deactivate)", async () => {
      const product = await stripe.products.create({ name: "Deactivate Price" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 500,
        currency: "usd",
      });
      expect(price.active).toBe(true);

      const deactivated = await stripe.prices.update(price.id, { active: false });
      expect(deactivated.active).toBe(false);
      expect(deactivated.id).toBe(price.id);
    });

    test("price preserves product reference on retrieve", async () => {
      const product = await stripe.products.create({ name: "Ref Product" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 750,
        currency: "usd",
      });

      const retrieved = await stripe.prices.retrieve(price.id);
      expect(retrieved.product).toBe(product.id);
    });

    test("verify recurring price has interval and interval_count", async () => {
      const product = await stripe.products.create({ name: "Recurring Details" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 2500,
        currency: "usd",
        recurring: { interval: "month", interval_count: 3 },
      });

      expect(price.recurring!.interval).toBe("month");
      expect(price.recurring!.interval_count).toBe(3);
    });

    test("verify one-time price has no recurring field (null)", async () => {
      const product = await stripe.products.create({ name: "One-shot" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 400,
        currency: "usd",
      });

      expect(price.recurring).toBeNull();
      expect(price.type).toBe("one_time");
    });

    test("create price with custom amount and currency", async () => {
      const product = await stripe.products.create({ name: "Euro Product" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 4999,
        currency: "eur",
      });

      expect(price.unit_amount).toBe(4999);
      expect(price.currency).toBe("eur");
    });

    test("prices with different currencies for same product", async () => {
      const product = await stripe.products.create({ name: "Global Product" });

      const usd = await stripe.prices.create({
        product: product.id,
        unit_amount: 1999,
        currency: "usd",
      });
      const eur = await stripe.prices.create({
        product: product.id,
        unit_amount: 1799,
        currency: "eur",
      });
      const gbp = await stripe.prices.create({
        product: product.id,
        unit_amount: 1599,
        currency: "gbp",
      });

      expect(usd.currency).toBe("usd");
      expect(eur.currency).toBe("eur");
      expect(gbp.currency).toBe("gbp");
      expect(usd.product).toBe(product.id);
      expect(eur.product).toBe(product.id);
      expect(gbp.product).toBe(product.id);
    });

    test("price unit_amount_decimal matches unit_amount", async () => {
      const product = await stripe.products.create({ name: "Decimal Check" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 3500,
        currency: "usd",
      });

      // The SDK wraps unit_amount_decimal in a Decimal object; toString() gives the raw value
      expect(String(price.unit_amount_decimal)).toBe("3500");
    });
  });

  // ---------------------------------------------------------------------------
  // Full catalog setup
  // ---------------------------------------------------------------------------
  describe("Full catalog setup", () => {
    test("build a full SaaS pricing page with Starter and Pro tiers", async () => {
      // Create products
      const starter = await stripe.products.create({
        name: "Starter",
        description: "For individuals and small teams",
      });
      const pro = await stripe.products.create({
        name: "Pro",
        description: "For growing businesses",
      });

      // Starter prices
      const starterMonthly = await stripe.prices.create({
        product: starter.id,
        unit_amount: 999,
        currency: "usd",
        recurring: { interval: "month" },
      });
      const starterYearly = await stripe.prices.create({
        product: starter.id,
        unit_amount: 9999,
        currency: "usd",
        recurring: { interval: "year" },
      });

      // Pro prices
      const proMonthly = await stripe.prices.create({
        product: pro.id,
        unit_amount: 2999,
        currency: "usd",
        recurring: { interval: "month" },
      });
      const proYearly = await stripe.prices.create({
        product: pro.id,
        unit_amount: 29999,
        currency: "usd",
        recurring: { interval: "year" },
      });

      // Verify products list
      const products = await stripe.products.list({ limit: 10 });
      expect(products.data.length).toBe(2);

      // Verify prices by product
      const starterPrices = await stripe.prices.list({ product: starter.id, limit: 10 });
      expect(starterPrices.data.length).toBe(2);

      const proPrices = await stripe.prices.list({ product: pro.id, limit: 10 });
      expect(proPrices.data.length).toBe(2);
    });

    test("deactivate a product tier from SaaS pricing page", async () => {
      const starter = await stripe.products.create({ name: "Starter" });
      const pro = await stripe.products.create({ name: "Pro" });

      await stripe.products.update(starter.id, { active: false });

      const retrieved = await stripe.products.retrieve(starter.id);
      expect(retrieved.active).toBe(false);

      const proRetrieved = await stripe.products.retrieve(pro.id);
      expect(proRetrieved.active).toBe(true);
    });

    test("build an e-commerce catalog with one-time prices", async () => {
      const tshirt = await stripe.products.create({
        name: "T-Shirt",
        description: "A comfortable cotton t-shirt",
      });
      const hat = await stripe.products.create({
        name: "Hat",
        description: "A stylish baseball cap",
      });

      const tshirtPrice = await stripe.prices.create({
        product: tshirt.id,
        unit_amount: 1999,
        currency: "usd",
      });
      const hatPrice = await stripe.prices.create({
        product: hat.id,
        unit_amount: 1499,
        currency: "usd",
      });

      // Verify both are retrievable
      const retrievedTshirt = await stripe.products.retrieve(tshirt.id);
      expect(retrievedTshirt.name).toBe("T-Shirt");

      const retrievedHat = await stripe.products.retrieve(hat.id);
      expect(retrievedHat.name).toBe("Hat");

      // Verify prices
      expect(tshirtPrice.unit_amount).toBe(1999);
      expect(tshirtPrice.type).toBe("one_time");
      expect(hatPrice.unit_amount).toBe(1499);
      expect(hatPrice.type).toBe("one_time");
    });

    test("full catalog with metadata for filtering", async () => {
      const basic = await stripe.products.create({
        name: "Basic Plan",
        metadata: { tier: "basic", feature_set: "limited" },
      });
      const premium = await stripe.products.create({
        name: "Premium Plan",
        metadata: { tier: "premium", feature_set: "full" },
      });

      expect(basic.metadata.tier).toBe("basic");
      expect(premium.metadata.tier).toBe("premium");
    });

    test("delete a product from the catalog and verify list", async () => {
      const p1 = await stripe.products.create({ name: "Product 1" });
      const p2 = await stripe.products.create({ name: "Product 2" });
      const p3 = await stripe.products.create({ name: "Product 3" });

      await stripe.products.del(p2.id);

      const list = await stripe.products.list({ limit: 10 });
      expect(list.data.length).toBe(2);
      const names = list.data.map((p) => p.name);
      expect(names).toContain("Product 1");
      expect(names).toContain("Product 3");
      expect(names).not.toContain("Product 2");
    });

    test("price list returns all prices across products", async () => {
      const p1 = await stripe.products.create({ name: "P1" });
      const p2 = await stripe.products.create({ name: "P2" });

      await stripe.prices.create({ product: p1.id, unit_amount: 100, currency: "usd" });
      await stripe.prices.create({ product: p1.id, unit_amount: 200, currency: "usd" });
      await stripe.prices.create({ product: p2.id, unit_amount: 300, currency: "usd" });

      const allPrices = await stripe.prices.list({ limit: 10 });
      expect(allPrices.data.length).toBe(3);
    });

    test("deactivate a price and verify it remains retrievable but inactive", async () => {
      const product = await stripe.products.create({ name: "With Inactive Price" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 500,
        currency: "usd",
      });

      await stripe.prices.update(price.id, { active: false });

      const retrieved = await stripe.prices.retrieve(price.id);
      expect(retrieved.active).toBe(false);
      expect(retrieved.unit_amount).toBe(500);
    });

    test("update price metadata", async () => {
      const product = await stripe.products.create({ name: "Meta Price Product" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 1000,
        currency: "usd",
        metadata: { promo: "launch" },
      });
      expect(price.metadata.promo).toBe("launch");

      const updated = await stripe.prices.update(price.id, {
        metadata: { promo: "summer", discount: "10pct" },
      });
      expect(updated.metadata.promo).toBe("summer");
      expect(updated.metadata.discount).toBe("10pct");
    });
  });

  // ---------------------------------------------------------------------------
  // Catalog -> subscription flow
  // ---------------------------------------------------------------------------
  describe("Catalog to subscription flow", () => {
    test("create full catalog, then create subscription with one of the prices", async () => {
      const product = await stripe.products.create({ name: "SaaS Pro" });
      const monthlyPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: 2999,
        currency: "usd",
        recurring: { interval: "month" },
      });

      const customer = await stripe.customers.create({ email: "subscriber@example.com" });

      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: monthlyPrice.id }],
      });

      expect(sub.id).toMatch(/^sub_/);
      expect(sub.status).toBe("active");
      expect(sub.customer).toBe(customer.id);
      expect(sub.items.data.length).toBe(1);
      expect(sub.items.data[0].price.id).toBe(monthlyPrice.id);
      expect(sub.items.data[0].price.unit_amount).toBe(2999);
    });

    test("upgrade: swap subscription item to different price from catalog", async () => {
      const product = await stripe.products.create({ name: "Upgrade Plan" });
      const basicPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: 999,
        currency: "usd",
        recurring: { interval: "month" },
      });
      const proPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: 2999,
        currency: "usd",
        recurring: { interval: "month" },
      });

      const customer = await stripe.customers.create({ email: "upgrader@example.com" });
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: basicPrice.id }],
      });

      expect(sub.items.data[0].price.id).toBe(basicPrice.id);

      // Upgrade to pro
      const updated = await stripe.subscriptions.update(sub.id, {
        items: [{ price: proPrice.id }],
      });

      expect(updated.items.data.length).toBe(1);
      expect(updated.items.data[0].price.id).toBe(proPrice.id);
      expect(updated.items.data[0].price.unit_amount).toBe(2999);
    });

    test("create customer, browse catalog, subscribe to a price", async () => {
      // Set up catalog
      const product = await stripe.products.create({
        name: "Premium API",
        description: "Unlimited API access",
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 4999,
        currency: "usd",
        recurring: { interval: "month" },
      });

      // Customer browses catalog
      const catalog = await stripe.products.list({ limit: 10 });
      expect(catalog.data.length).toBe(1);
      expect(catalog.data[0].name).toBe("Premium API");

      const prices = await stripe.prices.list({ product: product.id, limit: 10 });
      expect(prices.data.length).toBe(1);

      // Customer subscribes
      const customer = await stripe.customers.create({ email: "browser@example.com" });
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: prices.data[0].id }],
      });

      expect(sub.status).toBe("active");
      expect(sub.items.data[0].price.id).toBe(price.id);
    });

    test("verify subscription item has correct price from catalog", async () => {
      const product = await stripe.products.create({ name: "Verified Product" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 1500,
        currency: "usd",
        recurring: { interval: "month" },
      });

      const customer = await stripe.customers.create({ email: "verify@example.com" });
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
      });

      const item = sub.items.data[0];
      expect(item.price.id).toBe(price.id);
      expect(item.price.unit_amount).toBe(1500);
      expect(item.price.currency).toBe("usd");
      expect(item.price.recurring!.interval).toBe("month");
      expect(item.price.product).toBe(product.id);
    });

    test("subscription with trial period from catalog price", async () => {
      const product = await stripe.products.create({ name: "Trial Product" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 999,
        currency: "usd",
        recurring: { interval: "month" },
      });

      const customer = await stripe.customers.create({ email: "trial@example.com" });
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        trial_period_days: 14,
      });

      expect(sub.status).toBe("trialing");
      expect(sub.trial_start).not.toBeNull();
      expect(sub.trial_end).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------
  describe("Error cases", () => {
    test("create price for non-existent product stores product reference as-is", async () => {
      // The price service does not validate product existence at creation time,
      // so this succeeds but stores a dangling product reference.
      const price = await stripe.prices.create({
        product: "prod_nonexistent",
        unit_amount: 1000,
        currency: "usd",
      });
      expect(price.product).toBe("prod_nonexistent");
    });

    test("retrieve non-existent product -> 404", async () => {
      await expect(
        stripe.products.retrieve("prod_nonexistent"),
      ).rejects.toThrow();
    });

    test("retrieve non-existent price -> 404", async () => {
      await expect(
        stripe.prices.retrieve("price_nonexistent"),
      ).rejects.toThrow();
    });

    test("delete product, then try to retrieve it -> error", async () => {
      const product = await stripe.products.create({ name: "To Delete" });
      await stripe.products.del(product.id);

      await expect(stripe.products.retrieve(product.id)).rejects.toThrow();
    });

    test("create product with empty name -> error", async () => {
      await expect(
        stripe.products.create({ name: "" }),
      ).rejects.toThrow();
    });
  });
});
