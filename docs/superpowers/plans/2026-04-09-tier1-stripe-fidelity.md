# Tier 1 Stripe Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps that break real Stripe integration tests: subscription updates, test clock billing, 3DS simulation, and subscription update events.

**Architecture:** Each feature modifies existing service classes with new methods or extended logic. No new DB tables — only new service dependencies and route wiring. Tests use the real Stripe SDK against a live strimulator instance (same pattern as existing `tests/sdk/` files).

**Tech Stack:** Bun, Elysia, Drizzle ORM (bun-sqlite), Stripe SDK for tests, bun:test

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/services/payment-methods.ts` | Modify | Add 3DS magic tokens to `MAGIC_TOKEN_MAP` |
| `src/services/payment-intents.ts` | Modify | Add `requires_action` state, `next_action` field, 3DS confirm flow |
| `src/services/subscriptions.ts` | Modify | Add `update()` method, `test_clock` param on create, emit update events |
| `src/services/test-clocks.ts` | Modify | Add billing cycle processing to `advance()`, new service deps |
| `src/routes/subscriptions.ts` | Modify | Add `POST /v1/subscriptions/:id` route |
| `src/routes/test-clocks.ts` | Modify | Pass new deps to `TestClockService` |
| `src/app.ts` | Modify | Wire `EventService` into test clock routes |
| `tests/integration/three-d-secure.test.ts` | Create | 3DS integration tests |
| `tests/integration/subscription-updates.test.ts` | Create | Subscription update integration tests |
| `tests/integration/test-clock-billing.test.ts` | Create | Test clock billing integration tests |

---

### Task 1: Add 3DS Magic Tokens

**Files:**
- Modify: `src/services/payment-methods.ts:41-46`

- [ ] **Step 1: Add 3DS tokens to MAGIC_TOKEN_MAP**

In `src/services/payment-methods.ts`, add two entries to the `MAGIC_TOKEN_MAP` constant (after line 45):

```typescript
const MAGIC_TOKEN_MAP: Record<string, CardDetails> = {
  tok_visa: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_mastercard: { brand: "mastercard", last4: "4444", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_amex: { brand: "amex", last4: "8431", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_visa_debit: { brand: "visa", last4: "5556", expMonth: 12, expYear: 2034, funding: "debit" },
  tok_threeDSecureRequired: { brand: "visa", last4: "3220", expMonth: 12, expYear: 2034, funding: "credit" },
  tok_threeDSecureOptional: { brand: "visa", last4: "3222", expMonth: 12, expYear: 2034, funding: "credit" },
};
```

- [ ] **Step 2: Verify tests still pass**

Run: `bun test`
Expected: All 464 existing tests pass (no behavioral change yet).

- [ ] **Step 3: Commit**

```bash
git add src/services/payment-methods.ts
git commit -m "feat: add 3DS magic tokens to payment method map"
```

---

### Task 2: Add `requires_action` State to Payment Intents

**Files:**
- Modify: `src/services/payment-intents.ts`
- Create: `tests/integration/three-d-secure.test.ts`

- [ ] **Step 1: Write the failing 3DS test**

Create `tests/integration/three-d-secure.test.ts`:

```typescript
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
    // No charge created yet
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

    // Simulate user completing 3DS by calling confirm again
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/three-d-secure.test.ts`
Expected: FAIL — first test fails because `pi.status` is `"succeeded"` instead of `"requires_action"`.

- [ ] **Step 3: Implement 3DS in PaymentIntentService**

In `src/services/payment-intents.ts`, make these changes:

**3a.** Add `requiresAction` to `SimulationResult` (line 116-121):

```typescript
interface SimulationResult {
  success: boolean;
  requiresAction?: boolean;
  failureCode?: string;
  failureMessage?: string;
  declineCode?: string;
}
```

**3b.** Add `next_action` to `buildPaymentIntentShape` params and output. Replace the params type (line 64-77) to add the field:

```typescript
function buildPaymentIntentShape(
  id: string,
  createdAt: number,
  clientSecret: string,
  params: {
    amount: number;
    currency: string;
    customer?: string | null;
    payment_method?: string | null;
    capture_method: "automatic" | "manual";
    status: PaymentIntentStatus;
    metadata?: Record<string, string>;
    latest_charge?: string | null;
    last_payment_error?: Stripe.PaymentIntent["last_payment_error"] | null;
    amount_received?: number;
    canceled_at?: number | null;
    cancellation_reason?: string | null;
    next_action?: Stripe.PaymentIntent.NextAction | null;
  },
): Stripe.PaymentIntent {
```

And in the return object, change the `next_action` line from hardcoded `null` to:

```typescript
    next_action: params.next_action ?? null,
```

**3c.** Add 3DS check in `simulatePaymentOutcome` (after the `last4 === "0002"` check, before `return { success: true }`):

```typescript
    if (last4 === "3220") {
      return { success: true, requiresAction: true };
    }
    return { success: true };
```

**3d.** Handle `requires_action` in `confirm()`. After `const outcome = this.simulatePaymentOutcome(pm);`, before the `if (!outcome.success)` block, add:

```typescript
    // 3DS: requires_action
    if (outcome.requiresAction) {
      const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret as string, {
        amount: existing.amount,
        currency: existing.currency,
        customer: existing.customer as string | null,
        payment_method: pmId,
        capture_method: captureMethod,
        status: "requires_action",
        metadata: existing.metadata as Record<string, string>,
        next_action: {
          type: "use_stripe_sdk",
          use_stripe_sdk: {
            type: "three_d_secure_redirect",
            stripe_js: "",
          },
        } as unknown as Stripe.PaymentIntent.NextAction,
      });

      this.db.update(paymentIntents)
        .set({
          payment_method_id: pmId,
          status: "requires_action",
          data: JSON.stringify(updatedData),
        })
        .where(eq(paymentIntents.id, id))
        .run();

      return updatedData;
    }
```

**3e.** Allow `requires_action` as a valid source state in `confirm()`. Change the status validation (currently lines 253-257):

From:
```typescript
    if (
      existing.status !== "requires_confirmation" &&
      existing.status !== "requires_payment_method"
    ) {
      throw stateTransitionError("payment_intent", id, existing.status, "confirm");
    }
```

To:
```typescript
    if (
      existing.status !== "requires_confirmation" &&
      existing.status !== "requires_payment_method" &&
      existing.status !== "requires_action"
    ) {
      throw stateTransitionError("payment_intent", id, existing.status, "confirm");
    }

    // If re-confirming after 3DS, skip simulation — go straight to charge creation
    if (existing.status === "requires_action") {
      const pmId = existing.payment_method as string;
      const captureMethod = existing.capture_method as "automatic" | "manual";

      const charge = this.chargeService.create({
        amount: existing.amount,
        currency: existing.currency,
        customerId: existing.customer as string | null,
        paymentIntentId: id,
        paymentMethodId: pmId,
        status: "succeeded",
      });

      const newStatus: PaymentIntentStatus = captureMethod === "manual" ? "requires_capture" : "succeeded";

      const updatedData = buildPaymentIntentShape(id, existing.created, existing.client_secret as string, {
        amount: existing.amount,
        currency: existing.currency,
        customer: existing.customer as string | null,
        payment_method: pmId,
        capture_method: captureMethod,
        status: newStatus,
        metadata: existing.metadata as Record<string, string>,
        latest_charge: charge.id,
        amount_received: newStatus === "succeeded" ? existing.amount : 0,
      });

      this.db.update(paymentIntents)
        .set({
          payment_method_id: pmId,
          status: newStatus,
          data: JSON.stringify(updatedData),
        })
        .where(eq(paymentIntents.id, id))
        .run();

      return updatedData;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/three-d-secure.test.ts`
Expected: All 4 tests PASS.

Run: `bun test`
Expected: All tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/services/payment-intents.ts tests/integration/three-d-secure.test.ts
git commit -m "feat: add 3DS requires_action simulation for payment intents"
```

---

### Task 3: Add Subscription Update Method

**Files:**
- Modify: `src/services/subscriptions.ts`
- Create: `tests/integration/subscription-updates.test.ts`

- [ ] **Step 1: Write the failing subscription update tests**

Create `tests/integration/subscription-updates.test.ts`:

```typescript
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

    // Create a new higher price
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

    await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true,
    });

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
      await stripe.subscriptions.update(sub.id, {
        metadata: { key: "value" },
      });
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });

  test("emits customer.subscription.updated event", async () => {
    const { sub } = await createSubWithPrice(1000);

    await stripe.subscriptions.update(sub.id, {
      metadata: { env: "test" },
    });

    // Fetch events and verify
    const events = await stripe.events.list({ type: "customer.subscription.updated", limit: 5 });
    expect(events.data.length).toBeGreaterThanOrEqual(1);
    const latest = events.data[0];
    expect(latest.type).toBe("customer.subscription.updated");
    expect((latest.data.object as any).id).toBe(sub.id);
    expect(latest.data.previous_attributes).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/subscription-updates.test.ts`
Expected: FAIL — `stripe.subscriptions.update` hits a route that doesn't exist yet.

- [ ] **Step 3: Add UpdateSubscriptionParams and update() method to SubscriptionService**

In `src/services/subscriptions.ts`, add the interface after `ListSubscriptionParams` (around line 28):

```typescript
export interface UpdateSubscriptionParams {
  items?: Array<{ id?: string; price: string; quantity?: number }>;
  cancel_at_period_end?: boolean;
  trial_end?: "now" | number;
  metadata?: Record<string, string>;
  proration_behavior?: "create_prorations" | "none" | "always_invoice";
}
```

Add the `update()` method to the `SubscriptionService` class, after `retrieve()`:

```typescript
  update(id: string, params: UpdateSubscriptionParams, eventService?: EventService): Stripe.Subscription {
    const row = this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();

    if (!row) {
      throw resourceNotFoundError("subscription", id);
    }

    const existing = JSON.parse(row.data as string) as Stripe.Subscription;

    if (existing.status === "canceled") {
      throw stateTransitionError("subscription", id, existing.status, "update");
    }

    const previousAttributes: Record<string, unknown> = {};

    // --- Items update ---
    let updatedItems = (existing.items as Stripe.ApiList<Stripe.SubscriptionItem>).data;

    if (params.items && params.items.length > 0) {
      previousAttributes.items = { ...existing.items };
      const newItems: Stripe.SubscriptionItem[] = [];

      for (const itemParam of params.items) {
        const price = this.priceService.retrieve(itemParam.price);
        const quantity = itemParam.quantity ?? 1;

        if (itemParam.id) {
          // Update existing item
          const existingItem = updatedItems.find(i => i.id === itemParam.id);
          if (!existingItem) {
            throw invalidRequestError(`No such subscription item: '${itemParam.id}'`, "items");
          }
          const updatedItem = buildSubscriptionItemShape(
            existingItem.id, existingItem.created, id, price, quantity,
          );
          newItems.push(updatedItem);

          // Update subscription_items row
          this.db.update(subscriptionItems)
            .set({
              priceId: itemParam.price,
              quantity,
              data: JSON.stringify(updatedItem),
            })
            .where(eq(subscriptionItems.id, existingItem.id))
            .run();
        } else {
          // Add new item (or replace first if no id given and only 1 existing)
          if (newItems.length === 0 && updatedItems.length === 1 && params.items.length === 1) {
            // Single-item upgrade: replace the existing item
            const existingItem = updatedItems[0];
            const updatedItem = buildSubscriptionItemShape(
              existingItem.id, existingItem.created, id, price, quantity,
            );
            newItems.push(updatedItem);

            this.db.update(subscriptionItems)
              .set({
                priceId: itemParam.price,
                quantity,
                data: JSON.stringify(updatedItem),
              })
              .where(eq(subscriptionItems.id, existingItem.id))
              .run();
          } else {
            // Add brand new item
            const itemId = generateId("subscription_item");
            const createdAt = now();
            const newItem = buildSubscriptionItemShape(itemId, createdAt, id, price, quantity);
            newItems.push(newItem);

            this.db.insert(subscriptionItems).values({
              id: itemId,
              subscriptionId: id,
              priceId: itemParam.price,
              quantity,
              created: createdAt,
              data: JSON.stringify(newItem),
            }).run();
          }
        }
      }

      // Keep any existing items not touched by the update
      for (const existing of updatedItems) {
        if (!newItems.find(i => i.id === existing.id)) {
          newItems.push(existing);
        }
      }

      updatedItems = newItems;
    }

    // --- cancel_at_period_end ---
    let cancelAt = (existing as any).cancel_at ?? null;
    let cancelAtPeriodEnd = existing.cancel_at_period_end;

    if (params.cancel_at_period_end !== undefined) {
      previousAttributes.cancel_at_period_end = existing.cancel_at_period_end;
      previousAttributes.cancel_at = (existing as any).cancel_at;
      cancelAtPeriodEnd = params.cancel_at_period_end;
      cancelAt = params.cancel_at_period_end
        ? (existing as any).current_period_end
        : null;
    }

    // --- trial_end ---
    let trialEnd = existing.trial_end;
    let status = existing.status as string;

    if (params.trial_end !== undefined) {
      previousAttributes.trial_end = existing.trial_end;
      previousAttributes.status = existing.status;
      if (params.trial_end === "now") {
        trialEnd = now();
        status = "active";
      } else {
        trialEnd = params.trial_end;
      }
    }

    // --- metadata ---
    let metadata = existing.metadata as Record<string, string>;
    if (params.metadata !== undefined) {
      previousAttributes.metadata = { ...existing.metadata };
      metadata = { ...metadata, ...params.metadata };
    }

    // Determine currency from first price
    const currency = (updatedItems[0]?.price as Stripe.Price)?.currency ?? existing.currency;

    const updated = buildSubscriptionShape(id, existing.created, {
      customer: existing.customer as string,
      status,
      currency,
      current_period_start: (existing as any).current_period_start,
      current_period_end: (existing as any).current_period_end,
      trial_start: existing.trial_start,
      trial_end: trialEnd,
      items: updatedItems,
      metadata,
      canceled_at: existing.canceled_at,
      ended_at: existing.ended_at,
      cancel_at: cancelAt,
      cancel_at_period_end: cancelAtPeriodEnd,
      latest_invoice: existing.latest_invoice as string | null,
    });

    this.db.update(subscriptions)
      .set({
        status,
        data: JSON.stringify(updated),
      })
      .where(eq(subscriptions.id, id))
      .run();

    // Emit event
    if (Object.keys(previousAttributes).length > 0 && eventService) {
      eventService.emit(
        "customer.subscription.updated",
        updated as unknown as Record<string, unknown>,
        previousAttributes,
      );
    }

    return updated;
  }
```

Add the `EventService` import at the top of the file:

```typescript
import type { EventService } from "./events";
```

- [ ] **Step 4: Add the route**

In `src/routes/subscriptions.ts`, add this route after the `POST /` handler and before `GET /`:

```typescript
    // POST /v1/subscriptions/:id — update
    .post("/:id", async ({ params: { id }, request }) => {
      const rawBody = await request.text();
      const body = parseStripeBody(rawBody);

      // Parse items array — quantity to number
      if (Array.isArray(body.items)) {
        body.items = body.items.map((item: any) => ({
          ...item,
          quantity: item.quantity !== undefined ? parseInt(item.quantity, 10) : undefined,
        }));
      }

      // Parse cancel_at_period_end
      if (body.cancel_at_period_end !== undefined) {
        body.cancel_at_period_end = body.cancel_at_period_end === "true" || body.cancel_at_period_end === true;
      }

      // Parse trial_end
      if (body.trial_end !== undefined && body.trial_end !== "now") {
        body.trial_end = parseInt(body.trial_end as string, 10);
      }

      const updated = service.update(id, body as any, eventService);
      return updated;
    })
```

**Important:** This route must be placed AFTER `/search` but the Elysia router handles `/:id` vs `/search` correctly because `/search` is registered first. Place the new `.post("/:id", ...)` right before the `.get("/", ...)` list handler.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/integration/subscription-updates.test.ts`
Expected: All 6 tests PASS.

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/subscriptions.ts src/routes/subscriptions.ts tests/integration/subscription-updates.test.ts
git commit -m "feat: add subscription update route with item swap, cancel_at_period_end, trial_end, metadata"
```

---

### Task 4: Emit Update Events from Subscription Cancel

**Files:**
- Modify: `src/services/subscriptions.ts`
- Modify: `src/routes/subscriptions.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/subscription-updates.test.ts`:

```typescript
  test("cancel emits customer.subscription.updated before deleted", async () => {
    const { sub } = await createSubWithPrice(1000);

    await stripe.subscriptions.cancel(sub.id);

    const updatedEvents = await stripe.events.list({
      type: "customer.subscription.updated",
      limit: 5,
    });
    const deletedEvents = await stripe.events.list({
      type: "customer.subscription.deleted",
      limit: 5,
    });

    // Both events should exist
    expect(updatedEvents.data.length).toBeGreaterThanOrEqual(1);
    expect(deletedEvents.data.length).toBeGreaterThanOrEqual(1);

    // Updated event should have previous status
    const updateEvent = updatedEvents.data.find(
      (e) => (e.data.object as any).id === sub.id,
    );
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.data.previous_attributes).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/subscription-updates.test.ts`
Expected: FAIL — no `customer.subscription.updated` event from cancel.

- [ ] **Step 3: Add eventService parameter to cancel() and emit update event**

In `src/services/subscriptions.ts`, change the `cancel()` method signature:

```typescript
  cancel(id: string, eventService?: EventService): Stripe.Subscription {
```

Before the return statement in `cancel()` (after the DB update, before `return updated;`), add:

```typescript
    // Emit updated event before deleted (matches real Stripe ordering)
    if (eventService) {
      eventService.emit(
        "customer.subscription.updated",
        updated as unknown as Record<string, unknown>,
        { status: existing.status },
      );
    }
```

- [ ] **Step 4: Pass eventService through the route**

In `src/routes/subscriptions.ts`, update the DELETE handler to pass `eventService`:

```typescript
    // DELETE /v1/subscriptions/:id — cancel
    .delete("/:id", ({ params: { id } }) => {
      const canceled = service.cancel(id, eventService);
      eventService?.emit("customer.subscription.deleted", canceled as unknown as Record<string, unknown>);
      return canceled;
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/integration/subscription-updates.test.ts`
Expected: All 7 tests PASS.

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/subscriptions.ts src/routes/subscriptions.ts tests/integration/subscription-updates.test.ts
git commit -m "feat: emit customer.subscription.updated event on cancel"
```

---

### Task 5: Add test_clock Param to Subscription Create

**Files:**
- Modify: `src/services/subscriptions.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test-clock-billing.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/test-clock-billing.test.ts`
Expected: FAIL — `sub.test_clock` is null.

- [ ] **Step 3: Accept test_clock in CreateSubscriptionParams and wire it through**

In `src/services/subscriptions.ts`, add `test_clock` to `CreateSubscriptionParams`:

```typescript
export interface CreateSubscriptionParams {
  customer: string;
  items: CreateSubscriptionItemParam[];
  trial_period_days?: number;
  metadata?: Record<string, string>;
  test_clock?: string;
}
```

In `buildSubscriptionShape`, add `test_clock` to the params type:

```typescript
    test_clock?: string | null;
```

And in the return object, change `test_clock: null,` to:

```typescript
    test_clock: params.test_clock ?? null,
```

In the `create()` method, pass `test_clock` in the call to `buildSubscriptionShape`:

```typescript
    const subscription = buildSubscriptionShape(id, createdAt, {
      customer: params.customer,
      status,
      currency,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      trial_start: trialStart,
      trial_end: trialEnd,
      items: itemShapes,
      metadata: params.metadata,
      test_clock: params.test_clock ?? null,
    });
```

In the DB insert, change `testClockId: null` to `testClockId: params.test_clock ?? null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/test-clock-billing.test.ts`
Expected: PASS.

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/subscriptions.ts tests/integration/test-clock-billing.test.ts
git commit -m "feat: accept test_clock param on subscription create"
```

---

### Task 6: Test Clock Advance Drives Billing Cycles

**Files:**
- Modify: `src/services/test-clocks.ts`
- Modify: `src/routes/test-clocks.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Add billing cycle tests**

Append to `tests/integration/test-clock-billing.test.ts`:

```typescript
  test("advance clock past period_end creates invoice and rolls period", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const customer = await stripe.customers.create({ email: "billing@test.com" });
    const product = await stripe.products.create({ name: "Billing Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      test_clock: clock.id,
    } as any);

    const periodEnd = (sub as any).current_period_end;

    // Advance clock past the period end
    const advanced = await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: periodEnd + 1,
    });
    expect(advanced.status).toBe("ready");

    // Subscription should have rolled to next period
    const updatedSub = await stripe.subscriptions.retrieve(sub.id);
    expect((updatedSub as any).current_period_start).toBe(periodEnd);
    expect((updatedSub as any).current_period_end).toBeGreaterThan(periodEnd);

    // Invoice should have been created
    const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 5 } as any);
    expect(invoices.data.length).toBeGreaterThanOrEqual(1);
    const cycleInvoice = invoices.data.find((inv) => (inv as any).billing_reason === "subscription_cycle");
    expect(cycleInvoice).toBeDefined();
    expect(cycleInvoice!.status).toBe("paid");
    expect(cycleInvoice!.amount_due).toBe(2000);
  });

  test("advance clock ends trial and transitions to active", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const customer = await stripe.customers.create({ email: "trial@test.com" });
    const product = await stripe.products.create({ name: "Trial Product" });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 3000,
      currency: "usd",
      recurring: { interval: "month" },
    });

    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 14,
      test_clock: clock.id,
    } as any);

    expect(sub.status).toBe("trialing");
    const trialEnd = sub.trial_end as number;

    // Advance past trial end but before period end
    await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: trialEnd + 1,
    });

    const updatedSub = await stripe.subscriptions.retrieve(sub.id);
    expect(updatedSub.status).toBe("active");
  });

  test("advance clock: status transitions through advancing to ready", async () => {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: now,
    });

    const advanced = await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: now + 100,
    });

    // After advance completes, status should be ready
    expect(advanced.status).toBe("ready");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/test-clock-billing.test.ts`
Expected: FAIL — advance does not create invoices or roll periods.

- [ ] **Step 3: Add billing_reason to InvoiceService.create()**

In `src/services/invoices.ts`, add `billing_reason` to `CreateInvoiceParams`:

```typescript
export interface CreateInvoiceParams {
  customer: string;
  subscription?: string;
  currency?: string;
  amount_due?: number;
  metadata?: Record<string, string>;
  billing_reason?: string;
}
```

In the `create()` method, pass `billing_reason` to `buildInvoiceShape`:

```typescript
    const invoice = buildInvoiceShape(id, createdAt, {
      customer: params.customer,
      subscription: params.subscription ?? null,
      currency,
      amount_due: amountDue,
      amount_paid: 0,
      status: "draft",
      metadata: params.metadata,
      billing_reason: params.billing_reason ?? null,
    });
```

- [ ] **Step 4: Add billing deps to TestClockService constructor**

Replace the `TestClockService` constructor and add imports in `src/services/test-clocks.ts`:

```typescript
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { StrimulatorDB } from "../db";
import { testClocks } from "../db/schema/test-clocks";
import { subscriptions, subscriptionItems } from "../db/schema/subscriptions";
import { generateId } from "../lib/id-generator";
import { now } from "../lib/timestamps";
import { buildListResponse, type ListParams, type ListResponse } from "../lib/pagination";
import { resourceNotFoundError, invalidRequestError } from "../errors";
import type { EventService } from "./events";
import type { InvoiceService } from "./invoices";
import type { PriceService } from "./prices";
import { actionFlags } from "../dashboard/api";
```

```typescript
export class TestClockService {
  constructor(
    private db: StrimulatorDB,
    private eventService?: EventService,
    private invoiceService?: InvoiceService,
    private priceService?: PriceService,
  ) {}
```

- [ ] **Step 5: Add billing cycle logic to advance()**

Replace the `advance()` method in `src/services/test-clocks.ts`:

```typescript
  advance(id: string, frozenTime: number): Stripe.TestHelpers.TestClock {
    const existing = this.retrieve(id);
    const currentFrozenTime = (existing as unknown as { frozen_time: number }).frozen_time;

    if (frozenTime <= currentFrozenTime) {
      throw invalidRequestError(
        "The frozen_time must be after the current frozen_time of the test clock.",
        "frozen_time",
      );
    }

    // Set status to advancing
    const advancing = {
      ...existing,
      frozen_time: frozenTime,
      status: "advancing",
    } as unknown as Stripe.TestHelpers.TestClock;

    this.db.update(testClocks)
      .set({
        frozenTime,
        status: "advancing",
        data: JSON.stringify(advancing),
      })
      .where(eq(testClocks.id, id))
      .run();

    // Process billing for linked subscriptions
    this.processBillingCycles(id, frozenTime);

    // Set status back to ready
    const ready = {
      ...advancing,
      status: "ready",
    } as unknown as Stripe.TestHelpers.TestClock;

    this.db.update(testClocks)
      .set({
        status: "ready",
        data: JSON.stringify(ready),
      })
      .where(eq(testClocks.id, id))
      .run();

    return ready;
  }

  private processBillingCycles(clockId: string, frozenTime: number): void {
    if (!this.eventService || !this.invoiceService || !this.priceService) return;

    const THIRTY_DAYS = 30 * 24 * 60 * 60;

    // Find all subscriptions linked to this clock
    const subRows = this.db.select().from(subscriptions)
      .where(eq(subscriptions.testClockId, clockId))
      .all();

    for (const subRow of subRows) {
      const sub = JSON.parse(subRow.data as string) as any;
      if (sub.status !== "active" && sub.status !== "trialing") continue;

      let currentStatus = sub.status as string;
      let periodStart = subRow.currentPeriodStart;
      let periodEnd = subRow.currentPeriodEnd;
      let trialEnd = sub.trial_end as number | null;

      // End trial if needed
      if (currentStatus === "trialing" && trialEnd && frozenTime >= trialEnd) {
        const prevStatus = currentStatus;
        currentStatus = "active";

        // Update sub in DB
        const updatedSub = { ...sub, status: "active" };
        this.db.update(subscriptions)
          .set({ status: "active", data: JSON.stringify(updatedSub) })
          .where(eq(subscriptions.id, sub.id))
          .run();

        this.eventService.emit(
          "customer.subscription.updated",
          updatedSub,
          { status: prevStatus, trial_end: trialEnd },
        );

        // Reload sub data
        Object.assign(sub, updatedSub);
      }

      // Roll periods
      while (frozenTime >= periodEnd && currentStatus === "active") {
        const prevPeriodStart = periodStart;
        const prevPeriodEnd = periodEnd;
        periodStart = periodEnd;
        periodEnd = periodStart + THIRTY_DAYS;

        // Calculate amount from subscription items
        const itemRows = this.db.select().from(subscriptionItems)
          .where(eq(subscriptionItems.subscriptionId, sub.id))
          .all();

        let totalAmount = 0;
        for (const itemRow of itemRows) {
          const item = JSON.parse(itemRow.data as string) as any;
          const priceAmount = item.price?.unit_amount ?? 0;
          const quantity = itemRow.quantity ?? 1;
          totalAmount += priceAmount * quantity;
        }

        // Update subscription period
        const rolledSub = {
          ...sub,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          status: currentStatus,
        };

        this.db.update(subscriptions)
          .set({
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            status: currentStatus,
            data: JSON.stringify(rolledSub),
          })
          .where(eq(subscriptions.id, sub.id))
          .run();

        this.eventService.emit(
          "customer.subscription.updated",
          rolledSub,
          { current_period_start: prevPeriodStart, current_period_end: prevPeriodEnd },
        );

        // Create invoice
        const invoice = this.invoiceService.create({
          customer: sub.customer as string,
          subscription: sub.id,
          currency: sub.currency,
          amount_due: totalAmount,
          billing_reason: "subscription_cycle",
        });

        // Finalize
        this.invoiceService.finalizeInvoice(invoice.id);

        // Auto-pay (unless failNextPayment flag is set)
        if (actionFlags.failNextPayment) {
          actionFlags.failNextPayment = null;
          // Mark subscription as past_due
          const pastDueSub = { ...rolledSub, status: "past_due" };
          this.db.update(subscriptions)
            .set({ status: "past_due", data: JSON.stringify(pastDueSub) })
            .where(eq(subscriptions.id, sub.id))
            .run();

          this.eventService.emit(
            "customer.subscription.updated",
            pastDueSub,
            { status: "active" },
          );

          currentStatus = "past_due";
        } else {
          this.invoiceService.pay(invoice.id);
        }

        Object.assign(sub, rolledSub);
      }
    }
  }
```

- [ ] **Step 6: Wire deps in route and app**

In `src/routes/test-clocks.ts`, update the function signature and service construction:

```typescript
import { EventService } from "../services/events";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
```

```typescript
export function testClockRoutes(db: StrimulatorDB, eventService?: EventService) {
  const invoiceService = new InvoiceService(db);
  const priceService = new PriceService(db);
  const service = new TestClockService(db, eventService, invoiceService, priceService);
```

In `src/app.ts`, change line 78:

From:
```typescript
    .use(testClockRoutes(database))
```

To:
```typescript
    .use(testClockRoutes(database, eventService))
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/integration/test-clock-billing.test.ts`
Expected: All 4 tests PASS.

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/services/test-clocks.ts src/services/invoices.ts src/routes/test-clocks.ts src/app.ts tests/integration/test-clock-billing.test.ts
git commit -m "feat: test clock advance drives subscription billing cycles"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing 464 + new tests).

- [ ] **Step 2: Type check**

Run: `bun x tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify existing SDK tests still pass**

Run: `bun test tests/sdk/`
Expected: All 3 SDK test files pass.
