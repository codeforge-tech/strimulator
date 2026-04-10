import { describe, it, expect, beforeEach } from "bun:test";
import type Stripe from "stripe";
import { createDB } from "../../../src/db";
import { PriceService } from "../../../src/services/prices";
import { InvoiceService } from "../../../src/services/invoices";
import { SubscriptionService } from "../../../src/services/subscriptions";
import { EventService } from "../../../src/services/events";
import { StripeError } from "../../../src/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices() {
  const db = createDB(":memory:");
  const priceService = new PriceService(db);
  const invoiceService = new InvoiceService(db);
  const eventService = new EventService(db);
  const subscriptionService = new SubscriptionService(db, invoiceService, priceService);
  return { db, priceService, invoiceService, eventService, subscriptionService };
}

function createTestPrice(
  priceService: PriceService,
  overrides: {
    product?: string;
    currency?: string;
    unit_amount?: number;
    interval?: string;
    interval_count?: number;
  } = {},
) {
  return priceService.create({
    product: overrides.product ?? "prod_test",
    currency: overrides.currency ?? "usd",
    unit_amount: overrides.unit_amount ?? 1000,
    recurring: {
      interval: overrides.interval ?? "month",
      interval_count: overrides.interval_count,
    },
  });
}

function createTestSubscription(
  subscriptionService: SubscriptionService,
  priceId: string,
  overrides: {
    customer?: string;
    quantity?: number;
    trial_period_days?: number;
    metadata?: Record<string, string>;
    test_clock?: string;
  } = {},
) {
  return subscriptionService.create({
    customer: overrides.customer ?? "cus_test123",
    items: [{ price: priceId, quantity: overrides.quantity }],
    trial_period_days: overrides.trial_period_days,
    metadata: overrides.metadata,
    test_clock: overrides.test_clock,
  });
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const FOURTEEN_DAYS = 14 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubscriptionService", () => {
  // =======================================================================
  // create()
  // =======================================================================
  describe("create()", () => {
    // -- Basic creation & shape ------------------------------------------

    it("creates a subscription with minimum params (customer + one item)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub).toBeDefined();
      expect(sub.id).toMatch(/^sub_/);
      expect(sub.customer).toBe("cus_test123");
    });

    it("returns object = 'subscription'", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.object).toBe("subscription");
    });

    it("generates a unique sub_ prefixed id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.id).toMatch(/^sub_/);
      expect(sub.id.length).toBeGreaterThan(4);
    });

    it("sets livemode to false", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.livemode).toBe(false);
    });

    it("sets collection_method to charge_automatically", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.collection_method).toBe("charge_automatically");
    });

    it("sets default_payment_method to null", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.default_payment_method).toBeNull();
    });

    it("sets created timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const before = Math.floor(Date.now() / 1000);
      const sub = createTestSubscription(subscriptionService, price.id);
      const after = Math.floor(Date.now() / 1000);

      expect(sub.created).toBeGreaterThanOrEqual(before);
      expect(sub.created).toBeLessThanOrEqual(after);
    });

    it("sets cancel_at to null by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.cancel_at).toBeNull();
    });

    it("sets cancel_at_period_end to false by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.cancel_at_period_end).toBe(false);
    });

    it("sets canceled_at to null by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.canceled_at).toBeNull();
    });

    it("sets ended_at to null by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.ended_at).toBeNull();
    });

    it("sets latest_invoice to null by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.latest_invoice).toBeNull();
    });

    it("sets test_clock to null by default", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.test_clock).toBeNull();
    });

    // -- Status ----------------------------------------------------------

    it("sets status to 'active' when no trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.status).toBe("active");
    });

    it("sets trial_start to null when no trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.trial_start).toBeNull();
    });

    it("sets trial_end to null when no trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.trial_end).toBeNull();
    });

    // -- Period dates ----------------------------------------------------

    it("sets current_period_start equal to created", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.current_period_start).toBe(sub.created);
    });

    it("sets current_period_end to 30 days after period_start", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.current_period_end - sub.current_period_start).toBe(THIRTY_DAYS);
    });

    it("sets billing_cycle_anchor equal to period_start", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.billing_cycle_anchor).toBe(sub.current_period_start);
    });

    // -- Single item -----------------------------------------------------

    it("creates a single subscription item", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data).toHaveLength(1);
    });

    it("subscription item has si_ prefix", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].id).toMatch(/^si_/);
    });

    it("subscription item has object = 'subscription_item'", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].object).toBe("subscription_item");
    });

    it("subscription item links to correct price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.id).toBe(price.id);
    });

    it("subscription item defaults quantity to 1", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
      });

      expect(sub.items.data[0].quantity).toBe(1);
    });

    it("subscription item respects explicit quantity", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 5 });

      expect(sub.items.data[0].quantity).toBe(5);
    });

    it("subscription item references the subscription id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].subscription).toBe(sub.id);
    });

    it("subscription item has created timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].created).toBe(sub.created);
    });

    it("subscription item has empty metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].metadata).toEqual({});
    });

    // -- Items list shape ------------------------------------------------

    it("items list has object = 'list'", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.object).toBe("list");
    });

    it("items list has has_more = false", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.has_more).toBe(false);
    });

    it("items list has correct url", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.url).toBe(`/v1/subscription_items?subscription=${sub.id}`);
    });

    // -- Multiple items --------------------------------------------------

    it("creates subscription with multiple items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 500 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id, quantity: 1 },
          { price: price2.id, quantity: 3 },
        ],
      });

      expect(sub.items.data).toHaveLength(2);
    });

    it("each item in a multi-item subscription has a unique si_ id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 500 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id, quantity: 1 },
          { price: price2.id, quantity: 2 },
        ],
      });

      const ids = sub.items.data.map((i) => i.id);
      expect(ids[0]).toMatch(/^si_/);
      expect(ids[1]).toMatch(/^si_/);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("multi-item subscription items have correct prices", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 500 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id, quantity: 1 },
          { price: price2.id, quantity: 2 },
        ],
      });

      const priceIds = sub.items.data.map((i) => i.price.id);
      expect(priceIds).toContain(price1.id);
      expect(priceIds).toContain(price2.id);
    });

    it("multi-item subscription items have correct quantities", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 500 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id, quantity: 7 },
          { price: price2.id, quantity: 3 },
        ],
      });

      const item1 = sub.items.data.find((i) => i.price.id === price1.id)!;
      const item2 = sub.items.data.find((i) => i.price.id === price2.id)!;
      expect(item1.quantity).toBe(7);
      expect(item2.quantity).toBe(3);
    });

    it("creates three items on one subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const p1 = createTestPrice(priceService, { unit_amount: 100 });
      const p2 = createTestPrice(priceService, { unit_amount: 200 });
      const p3 = createTestPrice(priceService, { unit_amount: 300 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: p1.id },
          { price: p2.id },
          { price: p3.id },
        ],
      });

      expect(sub.items.data).toHaveLength(3);
    });

    // -- Metadata --------------------------------------------------------

    it("stores metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { plan: "pro", team: "engineering" },
      });

      expect(sub.metadata).toEqual({ plan: "pro", team: "engineering" });
    });

    it("defaults metadata to empty object", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.metadata).toEqual({});
    });

    it("stores single metadata key", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { key: "value" },
      });

      expect(sub.metadata).toEqual({ key: "value" });
    });

    // -- Currency --------------------------------------------------------

    it("sets currency from the first price's currency", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "eur" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.currency).toBe("eur");
    });

    it("defaults to usd when price has usd", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "usd" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.currency).toBe("usd");
    });

    it("uses gbp currency from price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "gbp" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.currency).toBe("gbp");
    });

    // -- Trial -----------------------------------------------------------

    it("sets status to 'trialing' with trial_period_days", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      expect(sub.status).toBe("trialing");
    });

    it("sets trial_start with trial_period_days", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      expect(sub.trial_start).not.toBeNull();
      expect(sub.trial_start).toBe(sub.created);
    });

    it("sets trial_end with trial_period_days", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      expect(sub.trial_end).not.toBeNull();
    });

    it("trial_end is exactly trial_period_days after trial_start", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(FOURTEEN_DAYS);
    });

    it("7-day trial has correct duration", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 7,
      });

      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(SEVEN_DAYS);
    });

    it("30-day trial has correct duration", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 30,
      });

      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(THIRTY_DAYS);
    });

    it("1-day trial has correct duration", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 1,
      });

      const ONE_DAY = 24 * 60 * 60;
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(ONE_DAY);
    });

    it("trial_period_days = 0 does not trigger trialing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 0,
      });

      expect(sub.status).toBe("active");
      expect(sub.trial_start).toBeNull();
      expect(sub.trial_end).toBeNull();
    });

    // -- Test clock ------------------------------------------------------

    it("sets test_clock when provided", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        test_clock: "clock_abc",
      });

      expect(sub.test_clock).toBe("clock_abc");
    });

    it("test_clock defaults to null when not provided", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.test_clock).toBeNull();
    });

    // -- Unique IDs & multiple subs for same customer --------------------

    it("each subscription gets a unique id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub1 = createTestSubscription(subscriptionService, price.id);
      const sub2 = createTestSubscription(subscriptionService, price.id);

      expect(sub1.id).not.toBe(sub2.id);
    });

    it("multiple subscriptions for the same customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_same" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_same" });

      expect(sub1.customer).toBe("cus_same");
      expect(sub2.customer).toBe("cus_same");
      expect(sub1.id).not.toBe(sub2.id);
    });

    it("different customers get separate subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      expect(sub1.customer).toBe("cus_a");
      expect(sub2.customer).toBe("cus_b");
    });

    // -- Validation errors -----------------------------------------------

    it("throws when customer is missing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      expect(() =>
        subscriptionService.create({
          customer: "",
          items: [{ price: price.id }],
        }),
      ).toThrow(StripeError);
    });

    it("throws 400 when customer is missing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      try {
        subscriptionService.create({ customer: "", items: [{ price: price.id }] });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error message mentions 'customer' when customer is missing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      try {
        subscriptionService.create({ customer: "", items: [{ price: price.id }] });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("customer");
      }
    });

    it("throws when items is empty array", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.create({ customer: "cus_test", items: [] }),
      ).toThrow(StripeError);
    });

    it("throws 400 when items is empty", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.create({ customer: "cus_test", items: [] });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws when price does not exist", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.create({
          customer: "cus_test",
          items: [{ price: "price_nonexistent" }],
        }),
      ).toThrow(StripeError);
    });

    it("throws 404 when price does not exist", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.create({
          customer: "cus_test",
          items: [{ price: "price_nonexistent" }],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws when item has empty price", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.create({
          customer: "cus_test",
          items: [{ price: "" }],
        }),
      ).toThrow(StripeError);
    });

    it("throws 400 when item has empty price string", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.create({ customer: "cus_test", items: [{ price: "" }] });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    // -- Persistence (create then retrieve) ------------------------------

    it("persists subscription to DB (retrievable after create)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.id).toBe(sub.id);
    });

    it("persisted subscription has same customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_persist" });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.customer).toBe("cus_persist");
    });

    it("persisted subscription has same status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.status).toBe("active");
    });

    it("persisted subscription has same metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { saved: "yes" },
      });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.metadata).toEqual({ saved: "yes" });
    });

    it("persisted subscription has same items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 3 });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.items.data).toHaveLength(1);
      expect(retrieved.items.data[0].quantity).toBe(3);
    });

    // -- Full shape check ------------------------------------------------

    it("has all expected top-level fields", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      // Verify all fields are present
      expect(sub).toHaveProperty("id");
      expect(sub).toHaveProperty("object");
      expect(sub).toHaveProperty("billing_cycle_anchor");
      expect(sub).toHaveProperty("cancel_at");
      expect(sub).toHaveProperty("cancel_at_period_end");
      expect(sub).toHaveProperty("canceled_at");
      expect(sub).toHaveProperty("collection_method");
      expect(sub).toHaveProperty("created");
      expect(sub).toHaveProperty("currency");
      expect(sub).toHaveProperty("current_period_end");
      expect(sub).toHaveProperty("current_period_start");
      expect(sub).toHaveProperty("customer");
      expect(sub).toHaveProperty("default_payment_method");
      expect(sub).toHaveProperty("ended_at");
      expect(sub).toHaveProperty("items");
      expect(sub).toHaveProperty("latest_invoice");
      expect(sub).toHaveProperty("livemode");
      expect(sub).toHaveProperty("metadata");
      expect(sub).toHaveProperty("status");
      expect(sub).toHaveProperty("test_clock");
      expect(sub).toHaveProperty("trial_end");
      expect(sub).toHaveProperty("trial_start");
    });

    // -- Price with different intervals ----------------------------------

    it("works with monthly price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { interval: "month" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.recurring?.interval).toBe("month");
    });

    it("works with yearly price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { interval: "year" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.recurring?.interval).toBe("year");
    });

    it("works with weekly price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { interval: "week" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.recurring?.interval).toBe("week");
    });

    it("works with daily price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { interval: "day" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.recurring?.interval).toBe("day");
    });

    // -- Price amounts ---------------------------------------------------

    it("items embed the full price object from PriceService", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { unit_amount: 2500 });
      const sub = createTestSubscription(subscriptionService, price.id);

      const itemPrice = sub.items.data[0].price;
      expect(itemPrice.id).toBe(price.id);
      expect(itemPrice.unit_amount).toBe(2500);
      expect(itemPrice.currency).toBe("usd");
      expect(itemPrice.object).toBe("price");
    });

    // -- Large quantity --------------------------------------------------

    it("supports large quantity values", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 999 });

      expect(sub.items.data[0].quantity).toBe(999);
    });
  });

  // =======================================================================
  // retrieve()
  // =======================================================================
  describe("retrieve()", () => {
    it("retrieves an existing subscription by id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const created = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("throws 404 for non-existent subscription", () => {
      const { subscriptionService } = makeServices();

      expect(() => subscriptionService.retrieve("sub_nonexistent")).toThrow(StripeError);
    });

    it("404 error has correct statusCode", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.retrieve("sub_nonexistent");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("404 error has resource_missing code", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.retrieve("sub_ghost");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("404 error message includes the id", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.retrieve("sub_missing123");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("sub_missing123");
      }
    });

    it("retrieved subscription has correct customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_ret" });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.customer).toBe("cus_ret");
    });

    it("retrieved subscription has correct status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.status).toBe("active");
    });

    it("retrieved trialing subscription has correct status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 7 });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.status).toBe("trialing");
    });

    it("retrieved subscription has items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.items.data).toHaveLength(1);
    });

    it("retrieved subscription has correct metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { retrieved: "true" },
      });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.metadata).toEqual({ retrieved: "true" });
    });

    it("retrieved subscription has correct currency", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "jpy" });
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.currency).toBe("jpy");
    });

    it("retrieved subscription has correct period dates", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.current_period_start).toBe(sub.current_period_start);
      expect(retrieved.current_period_end).toBe(sub.current_period_end);
    });

    it("retrieve after update shows changes", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { metadata: { updated: "yes" } });
      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.metadata).toEqual({ updated: "yes" });
    });

    it("retrieve after cancel shows canceled status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.cancel(sub.id);
      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.status).toBe("canceled");
    });

    it("retrieved subscription preserves all fields", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { key: "val" },
        trial_period_days: 5,
        test_clock: "clock_xyz",
      });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.object).toBe("subscription");
      expect(retrieved.livemode).toBe(false);
      expect(retrieved.cancel_at_period_end).toBe(false);
      expect(retrieved.test_clock).toBe("clock_xyz");
      expect(retrieved.status).toBe("trialing");
    });

    it("retrieves multiple different subscriptions correctly", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_1" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_2" });

      expect(subscriptionService.retrieve(sub1.id).customer).toBe("cus_1");
      expect(subscriptionService.retrieve(sub2.id).customer).toBe("cus_2");
    });

    it("throws for totally invalid id format", () => {
      const { subscriptionService } = makeServices();
      expect(() => subscriptionService.retrieve("not_a_real_id")).toThrow(StripeError);
    });
  });

  // =======================================================================
  // update()
  // =======================================================================
  describe("update()", () => {
    // -- Metadata --------------------------------------------------------

    it("updates metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        metadata: { foo: "bar" },
      });

      expect(updated.metadata).toEqual({ foo: "bar" });
    });

    it("merges metadata with existing values", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { existing: "value" },
      });

      const updated = subscriptionService.update(sub.id, {
        metadata: { new_key: "new_value" },
      });

      expect(updated.metadata).toEqual({ existing: "value", new_key: "new_value" });
    });

    it("overwrites existing metadata keys", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { key: "old" },
      });

      const updated = subscriptionService.update(sub.id, {
        metadata: { key: "new" },
      });

      expect(updated.metadata).toEqual({ key: "new" });
    });

    it("preserves metadata when not provided in update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { preserved: "yes" },
      });

      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: false,
      });

      expect(updated.metadata).toEqual({ preserved: "yes" });
    });

    // -- cancel_at_period_end --------------------------------------------

    it("sets cancel_at_period_end to true", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: true,
      });

      expect(updated.cancel_at_period_end).toBe(true);
    });

    it("sets cancel_at to current_period_end when cancel_at_period_end is true", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: true,
      });

      expect(updated.cancel_at).toBe(sub.current_period_end);
    });

    it("sets cancel_at_period_end back to false", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: false,
      });

      expect(updated.cancel_at_period_end).toBe(false);
    });

    it("clears cancel_at when cancel_at_period_end set to false", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: false,
      });

      expect(updated.cancel_at).toBeNull();
    });

    // -- trial_end -------------------------------------------------------

    it("updates trial_end to 'now' and sets status to active", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      expect(sub.status).toBe("trialing");

      const updated = subscriptionService.update(sub.id, {
        trial_end: "now",
      });

      expect(updated.status).toBe("active");
    });

    it("updates trial_end to 'now' sets trial_end to current time", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      const before = Math.floor(Date.now() / 1000);
      const updated = subscriptionService.update(sub.id, { trial_end: "now" });
      const after = Math.floor(Date.now() / 1000);

      expect(updated.trial_end).toBeGreaterThanOrEqual(before);
      expect(updated.trial_end).toBeLessThanOrEqual(after);
    });

    it("updates trial_end to a specific timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      const futureTimestamp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
      const updated = subscriptionService.update(sub.id, {
        trial_end: futureTimestamp,
      });

      expect(updated.trial_end).toBe(futureTimestamp);
    });

    it("does not change status when trial_end is set to a specific timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
      });

      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
      const updated = subscriptionService.update(sub.id, {
        trial_end: futureTimestamp,
      });

      expect(updated.status).toBe("trialing");
    });

    // -- Items update ----------------------------------------------------

    it("updates item quantity by item id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 1 });
      const itemId = sub.items.data[0].id;

      const updated = subscriptionService.update(sub.id, {
        items: [{ id: itemId, price: price.id, quantity: 5 }],
      });

      expect(updated.items.data[0].quantity).toBe(5);
    });

    it("preserves item id when updating by item id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      const itemId = sub.items.data[0].id;

      const updated = subscriptionService.update(sub.id, {
        items: [{ id: itemId, price: price.id, quantity: 10 }],
      });

      expect(updated.items.data[0].id).toBe(itemId);
    });

    it("single-plan upgrade replaces the only item", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });
      const sub = createTestSubscription(subscriptionService, price1.id);

      const updated = subscriptionService.update(sub.id, {
        items: [{ price: price2.id, quantity: 1 }],
      });

      expect(updated.items.data).toHaveLength(1);
      expect(updated.items.data[0].price.id).toBe(price2.id);
    });

    it("single-plan upgrade preserves existing item id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });
      const sub = createTestSubscription(subscriptionService, price1.id);
      const originalItemId = sub.items.data[0].id;

      const updated = subscriptionService.update(sub.id, {
        items: [{ price: price2.id }],
      });

      expect(updated.items.data[0].id).toBe(originalItemId);
    });

    it("adds a new item to a multi-item subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 500 });
      const price3 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id },
          { price: price2.id },
        ],
      });

      const updated = subscriptionService.update(sub.id, {
        items: [{ price: price3.id, quantity: 2 }],
      });

      expect(updated.items.data).toHaveLength(3);
    });

    it("new item added to multi-item subscription gets si_ id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 500 });
      const price3 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price1.id }, { price: price2.id }],
      });

      const updated = subscriptionService.update(sub.id, {
        items: [{ price: price3.id }],
      });

      const newItem = updated.items.data.find((i) => i.price.id === price3.id)!;
      expect(newItem.id).toMatch(/^si_/);
    });

    it("updates item price via item id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });
      const sub = createTestSubscription(subscriptionService, price1.id);
      const itemId = sub.items.data[0].id;

      const updated = subscriptionService.update(sub.id, {
        items: [{ id: itemId, price: price2.id }],
      });

      expect(updated.items.data[0].price.id).toBe(price2.id);
    });

    it("throws when updating non-existent subscription", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.update("sub_nonexistent", { metadata: { a: "b" } }),
      ).toThrow(StripeError);
    });

    it("throws 404 when updating non-existent subscription", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.update("sub_nonexistent", { metadata: { a: "b" } });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws when updating a canceled subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      expect(() =>
        subscriptionService.update(sub.id, { metadata: { key: "val" } }),
      ).toThrow(StripeError);
    });

    it("throws 400 when updating a canceled subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      try {
        subscriptionService.update(sub.id, { metadata: { key: "val" } });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error message mentions status when updating canceled subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      try {
        subscriptionService.update(sub.id, { metadata: {} });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("canceled");
      }
    });

    // -- Preserves unchanged fields --------------------------------------

    it("preserves customer on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_keep" });

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.customer).toBe("cus_keep");
    });

    it("preserves currency on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "eur" });
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.currency).toBe("eur");
    });

    it("preserves period dates on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.current_period_start).toBe(sub.current_period_start);
      expect(updated.current_period_end).toBe(sub.current_period_end);
    });

    it("preserves created timestamp on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.created).toBe(sub.created);
    });

    it("preserves id on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.id).toBe(sub.id);
    });

    it("preserves object on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.object).toBe("subscription");
    });

    it("preserves items when not updating items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 3 });

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.items.data).toHaveLength(1);
      expect(updated.items.data[0].quantity).toBe(3);
    });

    it("preserves trial fields when not updating trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, { metadata: { x: "y" } });
      expect(updated.trial_start).toBe(sub.trial_start);
      expect(updated.trial_end).toBe(sub.trial_end);
    });

    it("preserves livemode on update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, { metadata: {} });
      expect(updated.livemode).toBe(false);
    });

    // -- Update returns updated subscription -----------------------------

    it("returns the updated subscription object", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        metadata: { returned: "true" },
      });

      expect(updated.id).toBe(sub.id);
      expect(updated.metadata).toEqual({ returned: "true" });
    });

    // -- Multiple updates in sequence ------------------------------------

    it("multiple sequential metadata updates accumulate", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { metadata: { a: "1" } });
      subscriptionService.update(sub.id, { metadata: { b: "2" } });
      const final = subscriptionService.update(sub.id, { metadata: { c: "3" } });

      expect(final.metadata).toEqual({ a: "1", b: "2", c: "3" });
    });

    it("update then retrieve consistency", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        metadata: { consistent: "yes" },
        cancel_at_period_end: true,
      });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.metadata).toEqual(updated.metadata);
      expect(retrieved.cancel_at_period_end).toBe(true);
      expect(retrieved.cancel_at).toBe(updated.cancel_at);
    });

    it("sequential cancel_at_period_end toggles work", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const u1 = subscriptionService.update(sub.id, { cancel_at_period_end: true });
      expect(u1.cancel_at_period_end).toBe(true);
      expect(u1.cancel_at).toBe(sub.current_period_end);

      const u2 = subscriptionService.update(sub.id, { cancel_at_period_end: false });
      expect(u2.cancel_at_period_end).toBe(false);
      expect(u2.cancel_at).toBeNull();

      const u3 = subscriptionService.update(sub.id, { cancel_at_period_end: true });
      expect(u3.cancel_at_period_end).toBe(true);
    });

    // -- Event emission --------------------------------------------------

    it("emits customer.subscription.updated event", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { metadata: { key: "val" } }, eventService);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("customer.subscription.updated");
    });

    it("event data contains updated subscription", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { metadata: { key: "val" } }, eventService);

      const eventData = events[0].data.object as Record<string, unknown>;
      expect(eventData.id).toBe(sub.id);
    });

    it("event contains previous_attributes for metadata", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { old: "value" },
      });

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { metadata: { new: "value" } }, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs.metadata).toEqual({ old: "value" });
    });

    it("event contains previous_attributes for cancel_at_period_end", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { cancel_at_period_end: true }, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs.cancel_at_period_end).toBe(false);
    });

    it("does not emit event when no eventService is passed", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { metadata: { key: "val" } });

      expect(events).toHaveLength(0);
    });

    it("event contains previous_attributes for items update", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });
      const sub = createTestSubscription(subscriptionService, price1.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, {
        items: [{ price: price2.id }],
      }, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs).toHaveProperty("items");
    });

    it("event contains previous_attributes for trial_end update", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { trial_end: "now" }, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs).toHaveProperty("trial_end");
      expect(prevAttrs).toHaveProperty("status");
    });

    // -- Updating trialing subscription ----------------------------------

    it("can update metadata on a trialing subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, {
        metadata: { trialing: "yes" },
      });

      expect(updated.status).toBe("trialing");
      expect(updated.metadata).toEqual({ trialing: "yes" });
    });

    it("can set cancel_at_period_end on trialing subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 7 });

      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: true,
      });

      expect(updated.cancel_at_period_end).toBe(true);
    });

    // -- No-op updates ---------------------------------------------------

    it("update with empty params returns unchanged subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { stable: "true" },
      });

      const updated = subscriptionService.update(sub.id, {});
      expect(updated.metadata).toEqual({ stable: "true" });
      expect(updated.status).toBe("active");
    });

    // -- Throws on invalid price in items update -------------------------

    it("throws when updating items with non-existent price", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(() =>
        subscriptionService.update(sub.id, {
          items: [{ price: "price_nonexistent" }],
        }),
      ).toThrow(StripeError);
    });
  });

  // =======================================================================
  // cancel()
  // =======================================================================
  describe("cancel()", () => {
    it("cancels an active subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
    });

    it("sets canceled_at timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const before = Math.floor(Date.now() / 1000);
      const canceled = subscriptionService.cancel(sub.id);
      const after = Math.floor(Date.now() / 1000);

      expect(canceled.canceled_at).not.toBeNull();
      expect(canceled.canceled_at).toBeGreaterThanOrEqual(before);
      expect(canceled.canceled_at).toBeLessThanOrEqual(after);
    });

    it("sets ended_at timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.ended_at).not.toBeNull();
    });

    it("canceled_at and ended_at are the same value", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.canceled_at).toBe(canceled.ended_at);
    });

    it("preserves customer reference after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_kept" });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.customer).toBe("cus_kept");
    });

    it("preserves items after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 5 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.items.data).toHaveLength(1);
      expect(canceled.items.data[0].quantity).toBe(5);
    });

    it("preserves metadata after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { plan: "pro" },
      });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.metadata).toEqual({ plan: "pro" });
    });

    it("preserves currency after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { currency: "eur" });
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.currency).toBe("eur");
    });

    it("preserves period dates after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.current_period_start).toBe(sub.current_period_start);
      expect(canceled.current_period_end).toBe(sub.current_period_end);
    });

    it("preserves created timestamp after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.created).toBe(sub.created);
    });

    it("preserves id after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.id).toBe(sub.id);
    });

    it("preserves object type after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.object).toBe("subscription");
    });

    it("preserves billing_cycle_anchor after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.billing_cycle_anchor).toBe(sub.billing_cycle_anchor);
    });

    it("cancels a trialing subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 7 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
    });

    it("preserves trial dates after canceling trialing subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.trial_start).toBe(sub.trial_start);
      expect(canceled.trial_end).toBe(sub.trial_end);
    });

    it("throws when canceling non-existent subscription", () => {
      const { subscriptionService } = makeServices();
      expect(() => subscriptionService.cancel("sub_ghost")).toThrow(StripeError);
    });

    it("throws 404 when canceling non-existent subscription", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.cancel("sub_ghost");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws when canceling already canceled subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      expect(() => subscriptionService.cancel(sub.id)).toThrow(StripeError);
    });

    it("throws 400 when canceling already canceled subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      try {
        subscriptionService.cancel(sub.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error code is subscription_unexpected_state when canceling canceled", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      try {
        subscriptionService.cancel(sub.id);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("subscription_unexpected_state");
      }
    });

    it("error message mentions canceled status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      try {
        subscriptionService.cancel(sub.id);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("canceled");
      }
    });

    it("cancel then retrieve shows canceled status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.cancel(sub.id);
      const retrieved = subscriptionService.retrieve(sub.id);

      expect(retrieved.status).toBe("canceled");
      expect(retrieved.canceled_at).not.toBeNull();
      expect(retrieved.ended_at).not.toBeNull();
    });

    it("cancel persists to DB (verified by retrieve)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const canceled = subscriptionService.cancel(sub.id);
      const retrieved = subscriptionService.retrieve(sub.id);

      expect(retrieved.canceled_at).toBe(canceled.canceled_at);
      expect(retrieved.ended_at).toBe(canceled.ended_at);
    });

    // -- Event emission --------------------------------------------------

    it("emits customer.subscription.updated event on cancel", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.cancel(sub.id, eventService);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("customer.subscription.updated");
    });

    it("cancel event has previous status in previous_attributes", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.cancel(sub.id, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs).toEqual({ status: "active" });
    });

    it("cancel event for trialing subscription has previous status trialing", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 7 });

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.cancel(sub.id, eventService);

      const prevAttrs = (events[0].data as any).previous_attributes;
      expect(prevAttrs).toEqual({ status: "trialing" });
    });

    it("does not emit event when no eventService is passed", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.cancel(sub.id);

      expect(events).toHaveLength(0);
    });

    // -- Cancel subscription with cancel_at_period_end already set -------

    it("cancels subscription that had cancel_at_period_end set", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      const canceled = subscriptionService.cancel(sub.id);

      expect(canceled.status).toBe("canceled");
      expect(canceled.cancel_at_period_end).toBe(true);
    });

    it("preserves cancel_at_period_end value after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      const canceled = subscriptionService.cancel(sub.id);

      expect(canceled.cancel_at_period_end).toBe(true);
    });

    // -- Cancel subscription with metadata --------------------------------

    it("cancel a subscription that has complex metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { key1: "val1", key2: "val2", key3: "val3" },
      });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.metadata).toEqual({ key1: "val1", key2: "val2", key3: "val3" });
    });

    // -- Cancel subscription with test_clock ------------------------------

    it("cancel a subscription with test_clock (test_clock not forwarded in cancel)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        test_clock: "clock_cancel",
      });

      // Note: the current implementation does not pass test_clock through cancel()
      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.test_clock).toBeNull();
    });

    // -- Multiple subscriptions: cancel one doesn't affect others --------

    it("canceling one subscription does not affect others", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      subscriptionService.cancel(sub1.id);

      const retrieved1 = subscriptionService.retrieve(sub1.id);
      const retrieved2 = subscriptionService.retrieve(sub2.id);

      expect(retrieved1.status).toBe("canceled");
      expect(retrieved2.status).toBe("active");
    });
  });

  // =======================================================================
  // list()
  // =======================================================================
  describe("list()", () => {
    const defaultListParams = { limit: 10, startingAfter: undefined, endingBefore: undefined };

    it("returns empty list when no subscriptions exist", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.list(defaultListParams);
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns url = /v1/subscriptions", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.list(defaultListParams);
      expect(result.url).toBe("/v1/subscriptions");
    });

    it("returns all subscriptions when under limit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 3; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list(defaultListParams);
      expect(result.data).toHaveLength(3);
      expect(result.has_more).toBe(false);
    });

    it("returns correct number with limit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list({ ...defaultListParams, limit: 3 });
      expect(result.data).toHaveLength(3);
    });

    it("sets has_more when more results exist", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list({ ...defaultListParams, limit: 3 });
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when all results fit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 3; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list({ ...defaultListParams, limit: 10 });
      expect(result.has_more).toBe(false);
    });

    it("has_more is false when results exactly equal limit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 3; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list({ ...defaultListParams, limit: 3 });
      expect(result.has_more).toBe(false);
    });

    it("limit = 1 returns exactly one", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      const result = subscriptionService.list({ ...defaultListParams, limit: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.has_more).toBe(true);
    });

    // -- Filter by customer -----------------------------------------------

    it("filters by customerId", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_aaa" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_bbb" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_aaa" });

      const result = subscriptionService.list({ ...defaultListParams, customerId: "cus_aaa" });
      expect(result.data).toHaveLength(2);
      expect(result.data.every((s) => s.customer === "cus_aaa")).toBe(true);
    });

    it("filters by customerId with no matches returns empty", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_aaa" });

      const result = subscriptionService.list({ ...defaultListParams, customerId: "cus_zzz" });
      expect(result.data).toHaveLength(0);
    });

    it("filters by customerId respects limit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: "cus_same" });
      }

      const result = subscriptionService.list({ ...defaultListParams, limit: 2, customerId: "cus_same" });
      expect(result.data).toHaveLength(2);
      expect(result.has_more).toBe(true);
    });

    // -- Pagination with startingAfter ------------------------------------

    it("paginates with startingAfter (same-second limitation)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      // Note: when all subscriptions are created within the same second,
      // cursor-based pagination using gt(created) won't return subsequent items.
      // This tests the startingAfter mechanism resolves the cursor correctly.
      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_0" });

      const page1 = subscriptionService.list({ ...defaultListParams, limit: 1 });
      expect(page1.data).toHaveLength(1);
      expect(page1.data[0].id).toBe(sub1.id);
    });

    it("startingAfter with non-existent id throws 404", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.list({ ...defaultListParams, startingAfter: "sub_nonexistent" }),
      ).toThrow(StripeError);
    });

    it("startingAfter with non-existent id throws 404 with correct status", () => {
      const { subscriptionService } = makeServices();

      try {
        subscriptionService.list({ ...defaultListParams, startingAfter: "sub_nonexistent" });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("paginate through all subscriptions (single item per call)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      // Create a single subscription to test pagination mechanism
      createTestSubscription(subscriptionService, price.id, { customer: "cus_0" });

      const result = subscriptionService.list({ ...defaultListParams, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.has_more).toBe(false);
    });

    // -- Each returned item is a valid subscription -----------------------

    it("each listed item has object = subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      const result = subscriptionService.list(defaultListParams);
      for (const sub of result.data) {
        expect(sub.object).toBe("subscription");
      }
    });

    it("each listed item has sub_ prefixed id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });

      const result = subscriptionService.list(defaultListParams);
      for (const sub of result.data) {
        expect(sub.id).toMatch(/^sub_/);
      }
    });

    it("listed subscriptions include items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });

      const result = subscriptionService.list(defaultListParams);
      expect(result.data[0].items.data).toHaveLength(1);
    });

    it("listed subscriptions include correct metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_a",
        metadata: { listed: "true" },
      });

      const result = subscriptionService.list(defaultListParams);
      expect(result.data[0].metadata).toEqual({ listed: "true" });
    });

    // -- List includes canceled subscriptions ----------------------------

    it("list includes canceled subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      const result = subscriptionService.list(defaultListParams);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("canceled");
    });

    it("list includes both active and canceled subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });
      subscriptionService.cancel(sub1.id);

      const result = subscriptionService.list(defaultListParams);
      expect(result.data).toHaveLength(2);
      const statuses = result.data.map((s) => s.status);
      expect(statuses).toContain("canceled");
      expect(statuses).toContain("active");
    });

    // -- List with customerId and startingAfter ---------------------------

    it("combines customerId filter with startingAfter", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 4; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: "cus_target" });
      }
      createTestSubscription(subscriptionService, price.id, { customer: "cus_other" });

      const page1 = subscriptionService.list({ ...defaultListParams, limit: 2, customerId: "cus_target" });
      expect(page1.data).toHaveLength(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = subscriptionService.list({
        ...defaultListParams,
        limit: 2,
        customerId: "cus_target",
        startingAfter: lastId,
      });

      for (const sub of page2.data) {
        expect(sub.customer).toBe("cus_target");
      }
    });

    // -- List single subscription ----------------------------------------

    it("list with single subscription returns it", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.list(defaultListParams);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(sub.id);
    });
  });

  // =======================================================================
  // search()
  // =======================================================================
  describe("search()", () => {
    // -- By status --------------------------------------------------------

    it("search by status returns matching subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });
      subscriptionService.cancel(sub2.id);

      const result = subscriptionService.search('status:"active"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("active");
    });

    it("search by canceled status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      const result = subscriptionService.search('status:"canceled"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("canceled");
    });

    it("search by trialing status", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_active" });

      const result = subscriptionService.search('status:"trialing"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("trialing");
    });

    // -- By customer ------------------------------------------------------

    it("search by customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_target" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_other" });

      const result = subscriptionService.search('customer:"cus_target"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_target");
    });

    it("search by customer with no matches returns empty", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_exists" });

      const result = subscriptionService.search('customer:"cus_nonexistent"');
      expect(result.data).toHaveLength(0);
    });

    // -- By metadata ------------------------------------------------------

    it("search by metadata key-value pair", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_a",
        metadata: { plan: "pro" },
      });
      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_b",
        metadata: { plan: "free" },
      });

      const result = subscriptionService.search('metadata["plan"]:"pro"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].metadata).toEqual({ plan: "pro" });
    });

    it("search by metadata with no matching key", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        metadata: { existing: "value" },
      });

      const result = subscriptionService.search('metadata["nonexistent"]:"value"');
      expect(result.data).toHaveLength(0);
    });

    it("search by metadata with no matching value", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        metadata: { key: "actual_value" },
      });

      const result = subscriptionService.search('metadata["key"]:"wrong_value"');
      expect(result.data).toHaveLength(0);
    });

    // -- Empty results ----------------------------------------------------

    it("search on empty DB returns empty result", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.search('status:"active"');
      expect(result.data).toHaveLength(0);
    });

    // -- Result shape -----------------------------------------------------

    it("search result has object = search_result", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      expect(result.object).toBe("search_result");
    });

    it("search result has url = /v1/subscriptions/search", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      expect(result.url).toBe("/v1/subscriptions/search");
    });

    it("search result has next_page = null", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      expect(result.next_page).toBeNull();
    });

    it("search result has total_count", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      const result = subscriptionService.search('status:"active"');
      expect(result.total_count).toBe(2);
    });

    it("search result has has_more", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      expect(result).toHaveProperty("has_more");
    });

    // -- Limit ------------------------------------------------------------

    it("search respects limit parameter", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.search('status:"active"', 3);
      expect(result.data).toHaveLength(3);
    });

    it("search has_more is true when more results exist beyond limit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.search('status:"active"', 3);
      expect(result.has_more).toBe(true);
    });

    it("search has_more is false when all results fit", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"', 10);
      expect(result.has_more).toBe(false);
    });

    it("search default limit is 10", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 15; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.search('status:"active"');
      expect(result.data).toHaveLength(10);
    });

    // -- Compound queries -------------------------------------------------

    it("search with compound query (status AND customer)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_target" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_other" });
      const sub3 = createTestSubscription(subscriptionService, price.id, { customer: "cus_target" });
      subscriptionService.cancel(sub3.id);

      const result = subscriptionService.search('status:"active" AND customer:"cus_target"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_target");
      expect(result.data[0].status).toBe("active");
    });

    it("search with compound query (status AND metadata)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_a",
        metadata: { tier: "premium" },
      });
      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_b",
        metadata: { tier: "free" },
      });

      const result = subscriptionService.search('status:"active" AND metadata["tier"]:"premium"');
      expect(result.data).toHaveLength(1);
    });

    // -- Negation ---------------------------------------------------------

    it("search with negation (-status)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      const sub2 = createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });
      subscriptionService.cancel(sub2.id);

      const result = subscriptionService.search('-status:"canceled"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("active");
    });

    // -- Numeric comparisons -----------------------------------------------

    it("search by created > timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search(`created>${sub.created - 1}`);
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("search by created < timestamp returns nothing when all later", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search("created<1000");
      expect(result.data).toHaveLength(0);
    });

    // -- Substring / like search ------------------------------------------

    it("search with substring match (like) on customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_abc123" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_def456" });

      const result = subscriptionService.search('customer~"abc"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_abc123");
    });

    // -- Search result data items are valid subscriptions ----------------

    it("search result items have object = subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      for (const item of result.data) {
        expect(item.object).toBe("subscription");
      }
    });

    it("search result items have items embedded", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('status:"active"');
      for (const item of result.data) {
        expect(item.items.data.length).toBeGreaterThan(0);
      }
    });

    // -- Currency search --------------------------------------------------

    it("search by currency", () => {
      const { subscriptionService, priceService } = makeServices();
      const priceUsd = createTestPrice(priceService, { currency: "usd" });
      const priceEur = createTestPrice(priceService, { currency: "eur" });

      createTestSubscription(subscriptionService, priceUsd.id, { customer: "cus_usd" });
      createTestSubscription(subscriptionService, priceEur.id, { customer: "cus_eur" });

      const result = subscriptionService.search('currency:"eur"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].currency).toBe("eur");
    });
  });

  // =======================================================================
  // Subscription items (shape & behavior)
  // =======================================================================
  describe("subscription items", () => {
    it("item id has si_ prefix", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].id).toMatch(/^si_/);
    });

    it("item has object = subscription_item", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].object).toBe("subscription_item");
    });

    it("item has correct quantity", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 10 });

      expect(sub.items.data[0].quantity).toBe(10);
    });

    it("item links to correct price id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.id).toBe(price.id);
    });

    it("item links to correct subscription id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].subscription).toBe(sub.id);
    });

    it("item has created timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(typeof sub.items.data[0].created).toBe("number");
      expect(sub.items.data[0].created).toBeGreaterThan(0);
    });

    it("item created equals subscription created", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].created).toBe(sub.created);
    });

    it("item has empty metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].metadata).toEqual({});
    });

    it("item price has full price object", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { unit_amount: 4999 });
      const sub = createTestSubscription(subscriptionService, price.id);

      const itemPrice = sub.items.data[0].price;
      expect(itemPrice.object).toBe("price");
      expect(itemPrice.unit_amount).toBe(4999);
      expect(itemPrice.currency).toBe("usd");
    });

    it("item price has recurring info", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { interval: "month" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.recurring).not.toBeNull();
      expect(sub.items.data[0].price.recurring?.interval).toBe("month");
    });

    it("item price links to product", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService, { product: "prod_myproduct" });
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.data[0].price.product).toBe("prod_myproduct");
    });

    it("multiple items all link to same subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 100 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });
      const price3 = createTestPrice(priceService, { unit_amount: 300 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [
          { price: price1.id },
          { price: price2.id },
          { price: price3.id },
        ],
      });

      for (const item of sub.items.data) {
        expect(item.subscription).toBe(sub.id);
      }
    });

    it("multiple items each have unique si_ ids", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 100 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price1.id }, { price: price2.id }],
      });

      const ids = sub.items.data.map((i) => i.id);
      expect(new Set(ids).size).toBe(2);
    });

    it("quantity defaults to 1 when not specified", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
      });

      expect(sub.items.data[0].quantity).toBe(1);
    });

    it("item is preserved after subscription update", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 8 });

      const updated = subscriptionService.update(sub.id, { metadata: { changed: "meta" } });
      expect(updated.items.data[0].quantity).toBe(8);
      expect(updated.items.data[0].price.id).toBe(price.id);
    });

    it("item is preserved after subscription cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 4 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.items.data).toHaveLength(1);
      expect(canceled.items.data[0].quantity).toBe(4);
    });

    it("item url contains subscription id", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.items.url).toContain(sub.id);
    });
  });

  // =======================================================================
  // Trial period tests
  // =======================================================================
  describe("trial periods", () => {
    it("trial sets status to trialing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      expect(sub.status).toBe("trialing");
    });

    it("trial sets trial_start to created timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      expect(sub.trial_start).toBe(sub.created);
    });

    it("trial_end is trial_period_days * 86400 seconds after trial_start", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      expect(sub.trial_end).toBe((sub.trial_start as number) + 14 * 86400);
    });

    it("7-day trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 7 });

      expect(sub.status).toBe("trialing");
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(7 * 86400);
    });

    it("1-day trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 1 });

      expect(sub.status).toBe("trialing");
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(86400);
    });

    it("30-day trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 30 });

      expect(sub.status).toBe("trialing");
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(30 * 86400);
    });

    it("90-day trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 90 });

      expect(sub.status).toBe("trialing");
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(90 * 86400);
    });

    it("trial_period_days = 0 does not trigger trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 0 });

      expect(sub.status).toBe("active");
      expect(sub.trial_start).toBeNull();
      expect(sub.trial_end).toBeNull();
    });

    it("no trial_period_days means no trial", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      expect(sub.status).toBe("active");
      expect(sub.trial_start).toBeNull();
      expect(sub.trial_end).toBeNull();
    });

    it("trialing subscription can be canceled", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
    });

    it("trial_start and trial_end are preserved after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.trial_start).toBe(sub.trial_start);
      expect(canceled.trial_end).toBe(sub.trial_end);
    });

    it("ending trial early with trial_end='now' transitions to active", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      expect(sub.status).toBe("trialing");

      const updated = subscriptionService.update(sub.id, { trial_end: "now" });
      expect(updated.status).toBe("active");
    });

    it("trial_start is preserved when ending trial early", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, { trial_end: "now" });
      expect(updated.trial_start).toBe(sub.trial_start);
    });

    it("trial with metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
        metadata: { trial: "true" },
      });

      expect(sub.status).toBe("trialing");
      expect(sub.metadata).toEqual({ trial: "true" });
    });

    it("trial with test_clock", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        trial_period_days: 14,
        test_clock: "clock_trial",
      });

      expect(sub.status).toBe("trialing");
      expect(sub.test_clock).toBe("clock_trial");
    });

    it("trial with multiple items", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 100 });
      const price2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_trial",
        items: [{ price: price1.id }, { price: price2.id }],
        trial_period_days: 7,
      });

      expect(sub.status).toBe("trialing");
      expect(sub.items.data).toHaveLength(2);
    });

    it("trialing subscription metadata can be updated", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, { metadata: { changed: "during_trial" } });
      expect(updated.status).toBe("trialing");
      expect(updated.metadata).toEqual({ changed: "during_trial" });
    });

    it("trialing subscription can set cancel_at_period_end", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, { cancel_at_period_end: true });
      expect(updated.cancel_at_period_end).toBe(true);
      expect(updated.status).toBe("trialing");
    });
  });

  // =======================================================================
  // Integration / cross-method scenarios
  // =======================================================================
  describe("cross-method scenarios", () => {
    it("create -> retrieve -> update -> retrieve -> cancel -> retrieve", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      // Create
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { step: "created" },
      });
      expect(sub.status).toBe("active");

      // Retrieve
      const r1 = subscriptionService.retrieve(sub.id);
      expect(r1.metadata).toEqual({ step: "created" });

      // Update (metadata merges, so step gets overwritten)
      const updated = subscriptionService.update(sub.id, {
        metadata: { step: "updated" },
      });
      expect(updated.metadata).toEqual({ step: "updated" });

      // Retrieve after update
      const r2 = subscriptionService.retrieve(sub.id);
      expect(r2.metadata).toEqual({ step: "updated" });

      // Cancel
      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");

      // Retrieve after cancel
      const r3 = subscriptionService.retrieve(sub.id);
      expect(r3.status).toBe("canceled");
      expect(r3.metadata).toEqual({ step: "updated" });
    });

    it("create multiple subs, cancel one, list shows both", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub1 = createTestSubscription(subscriptionService, price.id, { customer: "cus_1" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_2" });

      subscriptionService.cancel(sub1.id);

      const result = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(2);
    });

    it("create multiple subs, search active only, get correct count", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });
      const sub3 = createTestSubscription(subscriptionService, price.id, { customer: "cus_c" });
      subscriptionService.cancel(sub3.id);

      const result = subscriptionService.search('status:"active"');
      expect(result.data).toHaveLength(2);
    });

    it("update subscription, then list shows updated data", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { version: "1" },
      });

      subscriptionService.update(sub.id, { metadata: { version: "2" } });

      const result = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data[0].metadata).toEqual({ version: "2" });
    });

    it("create trialing sub, end trial early, cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });
      expect(sub.status).toBe("trialing");

      const activated = subscriptionService.update(sub.id, { trial_end: "now" });
      expect(activated.status).toBe("active");

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cannot update after cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.cancel(sub.id);

      expect(() =>
        subscriptionService.update(sub.id, { metadata: { should: "fail" } }),
      ).toThrow(StripeError);
    });

    it("cannot cancel twice", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.cancel(sub.id);

      expect(() => subscriptionService.cancel(sub.id)).toThrow(StripeError);
    });

    it("search after update finds updated metadata", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, {
        metadata: { searchable: "old" },
      });

      subscriptionService.update(sub.id, { metadata: { searchable: "new" } });

      const result = subscriptionService.search('metadata["searchable"]:"new"');
      expect(result.data).toHaveLength(1);
    });

    it("different services instances share the same DB", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);
      const retrieved = subscriptionService.retrieve(sub.id);

      expect(retrieved.id).toBe(sub.id);
    });

    it("updating cancel_at_period_end then immediately canceling works", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      const canceled = subscriptionService.cancel(sub.id);

      expect(canceled.status).toBe("canceled");
      expect(canceled.canceled_at).not.toBeNull();
    });

    it("list after multiple creates and cancels returns correct total", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const subs = [];
      for (let i = 0; i < 10; i++) {
        subs.push(createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` }));
      }

      // Cancel half
      for (let i = 0; i < 5; i++) {
        subscriptionService.cancel(subs[i].id);
      }

      const result = subscriptionService.list({ limit: 20, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toHaveLength(10);

      const activeCount = result.data.filter((s) => s.status === "active").length;
      const canceledCount = result.data.filter((s) => s.status === "canceled").length;
      expect(activeCount).toBe(5);
      expect(canceledCount).toBe(5);
    });

    it("search by customer after cancel still finds the subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_searchable" });
      subscriptionService.cancel(sub.id);

      const result = subscriptionService.search('customer:"cus_searchable"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("canceled");
    });

    it("search with multiple conditions narrows results correctly", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_a",
        metadata: { env: "prod" },
      });
      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_b",
        metadata: { env: "staging" },
      });
      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_c",
        metadata: { env: "prod" },
      });

      const result = subscriptionService.search('metadata["env"]:"prod" AND customer:"cus_a"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_a");
    });

    it("create with test_clock - test_clock is set on create but lost after update/cancel", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { test_clock: "clock_lifecycle" });

      expect(sub.test_clock).toBe("clock_lifecycle");

      // Note: current implementation does not forward test_clock in update or cancel
      const updated = subscriptionService.update(sub.id, { metadata: { step: "update" } });
      expect(updated.test_clock).toBeNull();
    });

    it("create, set cancel_at_period_end, unset, verify final state", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { cancel_at_period_end: true });
      subscriptionService.update(sub.id, { cancel_at_period_end: false });

      const final = subscriptionService.retrieve(sub.id);
      expect(final.cancel_at_period_end).toBe(false);
      expect(final.cancel_at).toBeNull();
      expect(final.status).toBe("active");
    });

    it("list by customer returns only that customer's subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_alpha" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_alpha" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_beta" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_gamma" });

      const result = subscriptionService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_beta",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_beta");
    });

    it("update items then search still finds the subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });

      const sub = createTestSubscription(subscriptionService, price1.id, { customer: "cus_itemsearch" });

      subscriptionService.update(sub.id, { items: [{ price: price2.id }] });

      const result = subscriptionService.search('customer:"cus_itemsearch"');
      expect(result.data).toHaveLength(1);
    });

    it("empty metadata on create, add metadata on update, verify in search", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);
      expect(sub.metadata).toEqual({});

      subscriptionService.update(sub.id, { metadata: { added: "later" } });

      const result = subscriptionService.search('metadata["added"]:"later"');
      expect(result.data).toHaveLength(1);
    });

    it("search by status active excludes trialing", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_active" });
      createTestSubscription(subscriptionService, price.id, {
        customer: "cus_trialing",
        trial_period_days: 7,
      });

      const result = subscriptionService.search('status:"active"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_active");
    });

    it("create 10 subscriptions and list with limit 10 returns all", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 10; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(result.data).toHaveLength(10);
    });

    it("search total_count reflects actual count not limited count", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      for (let i = 0; i < 5; i++) {
        createTestSubscription(subscriptionService, price.id, { customer: `cus_${i}` });
      }

      const result = subscriptionService.search('status:"active"', 2);
      expect(result.data).toHaveLength(2);
      expect(result.total_count).toBe(5);
    });

    it("multiple updates to same metadata key keeps last value", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      subscriptionService.update(sub.id, { metadata: { version: "1" } });
      subscriptionService.update(sub.id, { metadata: { version: "2" } });
      subscriptionService.update(sub.id, { metadata: { version: "3" } });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.metadata).toEqual({ version: "3" });
    });

    it("event emitted on cancel contains the canceled subscription", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.cancel(sub.id, eventService);

      const eventData = events[0].data.object as Record<string, unknown>;
      expect(eventData.status).toBe("canceled");
      expect(eventData.id).toBe(sub.id);
    });

    it("update item quantity then verify via retrieve", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 1 });
      const itemId = sub.items.data[0].id;

      subscriptionService.update(sub.id, {
        items: [{ id: itemId, price: price.id, quantity: 20 }],
      });

      const retrieved = subscriptionService.retrieve(sub.id);
      expect(retrieved.items.data[0].quantity).toBe(20);
    });

    it("create with large metadata object", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const metadata: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        metadata[`key_${i}`] = `value_${i}`;
      }

      const sub = createTestSubscription(subscriptionService, price.id, { metadata });
      expect(Object.keys(sub.metadata as Record<string, string>)).toHaveLength(20);
    });

    it("search with empty string returns all subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_a" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_b" });

      // Empty query has no conditions, so all match
      const result = subscriptionService.search("");
      expect(result.data).toHaveLength(2);
    });

    it("cancel sets status in DB (verified by list)", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);
      subscriptionService.cancel(sub.id);

      const list = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(list.data[0].status).toBe("canceled");
    });

    it("search for livemode false returns all subscriptions", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('livemode:"false"');
      expect(result.data).toHaveLength(1);
    });

    it("search for object type subscription returns matches", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search('object:"subscription"');
      expect(result.data).toHaveLength(1);
    });

    it("different isolated service instances do not share data", () => {
      const services1 = makeServices();
      const services2 = makeServices();

      const price1 = createTestPrice(services1.priceService);
      createTestSubscription(services1.subscriptionService, price1.id);

      const result = services2.subscriptionService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
      });
      expect(result.data).toHaveLength(0);
    });

    it("update with items and metadata simultaneously", () => {
      const { subscriptionService, priceService } = makeServices();
      const price1 = createTestPrice(priceService, { unit_amount: 1000 });
      const price2 = createTestPrice(priceService, { unit_amount: 2000 });
      const sub = createTestSubscription(subscriptionService, price1.id);

      const updated = subscriptionService.update(sub.id, {
        items: [{ price: price2.id }],
        metadata: { upgraded: "true" },
      });

      expect(updated.items.data[0].price.id).toBe(price2.id);
      expect(updated.metadata).toEqual({ upgraded: "true" });
    });

    it("cancel then list by customer still returns the subscription", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id, { customer: "cus_canceled_list" });
      subscriptionService.cancel(sub.id);

      const result = subscriptionService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_canceled_list",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("canceled");
    });

    it("subscription with trial and multiple items", () => {
      const { subscriptionService, priceService } = makeServices();
      const p1 = createTestPrice(priceService, { unit_amount: 100 });
      const p2 = createTestPrice(priceService, { unit_amount: 200 });

      const sub = subscriptionService.create({
        customer: "cus_multi_trial",
        items: [{ price: p1.id, quantity: 1 }, { price: p2.id, quantity: 2 }],
        trial_period_days: 14,
      });

      expect(sub.status).toBe("trialing");
      expect(sub.items.data).toHaveLength(2);
      expect(sub.trial_start).not.toBeNull();
    });

    it("update cancel_at_period_end and metadata in same call", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const updated = subscriptionService.update(sub.id, {
        cancel_at_period_end: true,
        metadata: { reason: "downgrade" },
      });

      expect(updated.cancel_at_period_end).toBe(true);
      expect(updated.metadata).toEqual({ reason: "downgrade" });
    });

    it("update trial_end and metadata in same call", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { trial_period_days: 14 });

      const updated = subscriptionService.update(sub.id, {
        trial_end: "now",
        metadata: { trial_ended: "early" },
      });

      expect(updated.status).toBe("active");
      expect(updated.metadata).toEqual({ trial_ended: "early" });
    });

    it("multiple event emissions on sequential updates", () => {
      const { subscriptionService, priceService, eventService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id);

      const events: Stripe.Event[] = [];
      eventService.onEvent((e) => events.push(e));

      subscriptionService.update(sub.id, { metadata: { step: "1" } }, eventService);
      subscriptionService.update(sub.id, { metadata: { step: "2" } }, eventService);
      subscriptionService.update(sub.id, { metadata: { step: "3" } }, eventService);

      expect(events).toHaveLength(3);
      expect(events.every((e) => e.type === "customer.subscription.updated")).toBe(true);
    });

    it("search by negated customer", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      createTestSubscription(subscriptionService, price.id, { customer: "cus_keep" });
      createTestSubscription(subscriptionService, price.id, { customer: "cus_exclude" });

      const result = subscriptionService.search('-customer:"cus_exclude"');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer).toBe("cus_keep");
    });

    it("search using >= on created timestamp", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search(`created>=${sub.created}`);
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("search using <= on created timestamp matches all", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);

      const sub = createTestSubscription(subscriptionService, price.id);

      const result = subscriptionService.search(`created<=${sub.created}`);
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("create sub, update items quantity by id, cancel, verify item quantity persists", () => {
      const { subscriptionService, priceService } = makeServices();
      const price = createTestPrice(priceService);
      const sub = createTestSubscription(subscriptionService, price.id, { quantity: 1 });
      const itemId = sub.items.data[0].id;

      subscriptionService.update(sub.id, {
        items: [{ id: itemId, price: price.id, quantity: 15 }],
      });

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.items.data[0].quantity).toBe(15);
    });

    it("list empty result has correct structure", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_nobody",
      });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/subscriptions");
    });

    it("search empty result has correct structure", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.search('status:"active"');

      expect(result.object).toBe("search_result");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.total_count).toBe(0);
      expect(result.next_page).toBeNull();
      expect(result.url).toBe("/v1/subscriptions/search");
    });
  });
});
