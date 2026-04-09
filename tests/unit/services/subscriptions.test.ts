import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PriceService } from "../../../src/services/prices";
import { InvoiceService } from "../../../src/services/invoices";
import { SubscriptionService } from "../../../src/services/subscriptions";
import { StripeError } from "../../../src/errors";

function makeServices() {
  const db = createDB(":memory:");
  const priceService = new PriceService(db);
  const invoiceService = new InvoiceService(db);
  const subscriptionService = new SubscriptionService(db, invoiceService, priceService);

  // Create a default price to use in tests
  const price = priceService.create({
    product: "prod_test",
    currency: "usd",
    unit_amount: 1000,
    recurring: { interval: "month" },
  });

  return { db, priceService, invoiceService, subscriptionService, price };
}

describe("SubscriptionService", () => {
  describe("create", () => {
    it("creates a subscription with correct shape", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id, quantity: 1 }],
      });

      expect(sub.id).toMatch(/^sub_/);
      expect(sub.object).toBe("subscription");
      expect(sub.customer).toBe("cus_test123");
      expect(sub.livemode).toBe(false);
      expect(sub.collection_method).toBe("charge_automatically");
      expect(sub.default_payment_method).toBeNull();
      expect(sub.cancel_at).toBeNull();
      expect(sub.cancel_at_period_end).toBe(false);
      expect(sub.canceled_at).toBeNull();
      expect(sub.test_clock).toBeNull();
      expect(sub.latest_invoice).toBeNull();
    });

    it("creates a subscription with status active when no trial", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id }],
      });

      expect(sub.status).toBe("active");
      expect(sub.trial_start).toBeNull();
      expect(sub.trial_end).toBeNull();
    });

    it("creates a subscription with items embedded", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id, quantity: 2 }],
      });

      expect(sub.items.object).toBe("list");
      expect(sub.items.data).toHaveLength(1);
      const item = sub.items.data[0];
      expect(item.id).toMatch(/^si_/);
      expect(item.object).toBe("subscription_item");
      expect(item.quantity).toBe(2);
      expect(item.price.id).toBe(price.id);
      expect(item.subscription).toBe(sub.id);
    });

    it("sets period dates (30 days)", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id }],
      });

      const THIRTY_DAYS = 30 * 24 * 60 * 60;
      expect(sub.current_period_end - sub.current_period_start).toBe(THIRTY_DAYS);
      expect(sub.billing_cycle_anchor).toBe(sub.current_period_start);
    });

    it("creates a subscription with trial", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id }],
        trial_period_days: 14,
      });

      expect(sub.status).toBe("trialing");
      expect(sub.trial_start).not.toBeNull();
      expect(sub.trial_end).not.toBeNull();
      const FOURTEEN_DAYS = 14 * 24 * 60 * 60;
      expect((sub.trial_end as number) - (sub.trial_start as number)).toBe(FOURTEEN_DAYS);
    });

    it("stores metadata", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [{ price: price.id }],
        metadata: { plan: "pro" },
      });

      expect(sub.metadata).toEqual({ plan: "pro" });
    });

    it("throws 404 when price does not exist", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.create({
          customer: "cus_test123",
          items: [{ price: "price_nonexistent" }],
        })
      ).toThrow(StripeError);

      try {
        subscriptionService.create({
          customer: "cus_test123",
          items: [{ price: "price_nonexistent" }],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws 400 when items is empty", () => {
      const { subscriptionService } = makeServices();

      expect(() =>
        subscriptionService.create({
          customer: "cus_test123",
          items: [],
        })
      ).toThrow(StripeError);
    });

    it("supports multiple items", () => {
      const { subscriptionService, priceService } = makeServices();

      const price1 = priceService.create({
        product: "prod_test",
        currency: "usd",
        unit_amount: 500,
        recurring: { interval: "month" },
      });
      const price2 = priceService.create({
        product: "prod_test",
        currency: "usd",
        unit_amount: 200,
        recurring: { interval: "month" },
      });

      const sub = subscriptionService.create({
        customer: "cus_test123",
        items: [
          { price: price1.id, quantity: 1 },
          { price: price2.id, quantity: 3 },
        ],
      });

      expect(sub.items.data).toHaveLength(2);
    });
  });

  describe("retrieve", () => {
    it("retrieves a subscription by ID", () => {
      const { subscriptionService, price } = makeServices();

      const created = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
      });

      const retrieved = subscriptionService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.customer).toBe("cus_test");
    });

    it("throws 404 for nonexistent subscription", () => {
      const { subscriptionService } = makeServices();

      expect(() => subscriptionService.retrieve("sub_nonexistent")).toThrow(StripeError);

      try {
        subscriptionService.retrieve("sub_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("cancel", () => {
    it("cancels an active subscription", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
      });
      expect(sub.status).toBe("active");

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
      expect(canceled.canceled_at).not.toBeNull();
      expect(canceled.ended_at).not.toBeNull();
    });

    it("cancels a trialing subscription", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
        trial_period_days: 7,
      });
      expect(sub.status).toBe("trialing");

      const canceled = subscriptionService.cancel(sub.id);
      expect(canceled.status).toBe("canceled");
    });

    it("throws 400 when canceling an already canceled subscription", () => {
      const { subscriptionService, price } = makeServices();

      const sub = subscriptionService.create({
        customer: "cus_test",
        items: [{ price: price.id }],
      });
      subscriptionService.cancel(sub.id);

      expect(() => subscriptionService.cancel(sub.id)).toThrow(StripeError);

      try {
        subscriptionService.cancel(sub.id);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws 404 for nonexistent subscription", () => {
      const { subscriptionService } = makeServices();
      expect(() => subscriptionService.cancel("sub_ghost")).toThrow(StripeError);
    });
  });

  describe("list", () => {
    it("returns empty list when no subscriptions exist", () => {
      const { subscriptionService } = makeServices();

      const result = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/subscriptions");
    });

    it("returns all subscriptions up to limit", () => {
      const { subscriptionService, price } = makeServices();

      for (let i = 0; i < 3; i++) {
        subscriptionService.create({
          customer: `cus_test${i}`,
          items: [{ price: price.id }],
        });
      }

      const result = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit and sets has_more", () => {
      const { subscriptionService, price } = makeServices();

      for (let i = 0; i < 5; i++) {
        subscriptionService.create({
          customer: `cus_test${i}`,
          items: [{ price: price.id }],
        });
      }

      const result = subscriptionService.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("filters by customerId", () => {
      const { subscriptionService, price } = makeServices();

      subscriptionService.create({ customer: "cus_aaa", items: [{ price: price.id }] });
      subscriptionService.create({ customer: "cus_bbb", items: [{ price: price.id }] });

      const result = subscriptionService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_aaa" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].customer).toBe("cus_aaa");
    });

    it("paginates with startingAfter", () => {
      const { subscriptionService, price } = makeServices();

      for (let i = 0; i < 3; i++) {
        subscriptionService.create({ customer: `cus_${i}`, items: [{ price: price.id }] });
      }

      const page1 = subscriptionService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = subscriptionService.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });
  });
});
