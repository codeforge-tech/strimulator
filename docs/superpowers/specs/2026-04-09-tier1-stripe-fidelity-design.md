# Tier 1 Stripe Fidelity — Design Spec

**Date:** 2026-04-09
**Branch:** `feat/tier1-stripe-fidelity`
**Goal:** Close the four gaps that break real integration tests against strimulator.

---

## 1. Subscription Updates

### Problem
No `POST /v1/subscriptions/:id` route exists. Any SaaS that upgrades/downgrades a plan or sets `cancel_at_period_end` gets a 404.

### Design

**Route:** `POST /v1/subscriptions/:id`

**Accepted params** (matching Stripe's API):
- `items` — array of `{ id?, price, quantity? }`. If `id` is provided, update that subscription item. If only `price` is provided without `id`, replace the first item (common single-plan upgrade pattern). New items without a matching `id` are added.
- `cancel_at_period_end` — boolean. Sets/unsets end-of-period cancellation.
- `trial_end` — `"now"` or Unix timestamp. Ends or extends trial.
- `metadata` — merged with existing metadata.
- `proration_behavior` — `"create_prorations"` | `"none"` | `"always_invoice"`. Stored on the response but no actual proration invoices generated (acceptable simplification — proration math is complex and rarely asserted on in tests).

**Service method:** `SubscriptionService.update(id, params)`

**Behavior:**
1. Retrieve subscription. Reject if `status === "canceled"`.
2. Capture `previous_attributes` for changed fields.
3. If `items` provided: validate each price exists via `PriceService.retrieve()`. Update/insert/remove subscription_items rows. Rebuild `items.data` on the subscription object.
4. If `cancel_at_period_end` is `true`: set `cancel_at = current_period_end`, `cancel_at_period_end = true`. If `false`: clear both.
5. If `trial_end === "now"`: set `trial_end = now()`, `status = "active"`. If timestamp: set `trial_end = timestamp`.
6. Merge metadata.
7. Persist updated subscription + items.
8. Emit `customer.subscription.updated` with `previous_attributes`.
9. Return updated subscription.

**Not implemented (intentional):**
- Proration invoice generation (param accepted but no invoice created)
- `default_payment_method` changes
- `billing_cycle_anchor` changes

---

## 2. Test Clocks Drive Billing

### Problem
`TestClockService.advance()` stores a new `frozen_time` but nothing happens. Real Stripe's test clock advance triggers subscription period rollovers, invoice creation, and payment attempts.

### Design

**Modified method:** `TestClockService.advance(id, frozenTime)`

After updating the clock's `frozen_time`, scan all subscriptions linked to that clock and process billing events:

**Algorithm:**
```
for each subscription where test_clock_id = clock.id AND status in ("active", "trialing"):
  while frozen_time >= subscription.current_period_end:
    1. If status is "trialing" and frozen_time >= trial_end:
       - Set status = "active", clear trial fields
       - Emit customer.subscription.updated

    2. Roll period forward:
       - new_period_start = current_period_end
       - new_period_end = new_period_start + period_length (30 days)
       - Emit customer.subscription.updated with previous period

    3. Create invoice for the new period:
       - customer, subscription, currency from sub
       - amount_due = sum of (item.price.unit_amount * item.quantity) for all items
       - billing_reason = "subscription_cycle"
       - Emit invoice.created

    4. Auto-finalize the invoice:
       - Set status = "open", assign invoice number
       - Emit invoice.finalized

    5. Auto-pay the invoice (simulate charge_automatically):
       - Set status = "paid", amount_paid = amount_due
       - Emit invoice.paid
       
       (If actionFlags.failNextPayment is set, mark invoice as
        status = "open" with attempted = true, and set subscription
        status = "past_due" instead. Emit invoice.payment_failed.)
```

**Linking subscriptions to clocks:**
- `SubscriptionService.create()` needs a new optional param: `test_clock`. When provided, store in `subscriptions.test_clock_id` and set the subscription's `test_clock` field.
- `CustomerService` is NOT clock-aware (Stripe ties clocks to customers, but for MVP we tie directly to subscriptions — simpler, still testable).

**Clock status transitions:**
- Set `status = "advancing"` at the start of `advance()`.
- Set `status = "ready"` when done.
- This matches Stripe's async model. Since our advance is synchronous, the transition is immediate, but tests that check `status` after advance will see the correct final state.

---

## 3. 3DS / `requires_action` Simulation

### Problem
`PaymentIntentService.confirm()` always resolves to `succeeded` or `requires_payment_method`. No way to simulate the `requires_action` state that real Stripe produces for 3D Secure cards.

### Design

**Magic cards** (matching Stripe's real test cards):
| Token | last4 | Behavior |
|---|---|---|
| `tok_threeDSecureRequired` | `3220` | Always triggers `requires_action` |
| `tok_threeDSecureOptional` | `3222` | Succeeds without 3DS (treated as normal) |

Add these to `MAGIC_TOKEN_MAP` in `payment-methods.ts`.

**Confirm flow change in `PaymentIntentService.confirm()`:**

After `simulatePaymentOutcome()`, add a new check:

```
if (outcome.requires_action):
  status = "requires_action"
  next_action = {
    type: "use_stripe_sdk",
    use_stripe_sdk: {
      type: "three_d_secure_redirect",
      stripe_js: ""  // empty in test mode, matches stripe-mock
    }
  }
  persist and return (do NOT create a charge yet)
```

Update `SimulationResult` to include `requiresAction: boolean`.
Update `simulatePaymentOutcome()`: if card last4 is `3220`, return `{ success: true, requiresAction: true }`.

**Completing the 3DS challenge:**

The user's integration calls `confirm()` again on a `requires_action` PI (this is what the real Stripe SDK does after the user completes the 3DS challenge). Modify `confirm()` to accept `requires_action` as a valid source state:

```
// In confirm():
if (existing.status !== "requires_confirmation" 
    && existing.status !== "requires_payment_method"
    && existing.status !== "requires_action") {
  throw stateTransitionError(...)
}

// If status is "requires_action", skip simulatePaymentOutcome entirely —
// treat as 3DS completed, go straight to charge creation (success path).
// Do NOT re-check the card; the "challenge" is done.
if (existing.status === "requires_action") {
  // Proceed directly to charge creation (success path)
}
```

This matches Stripe's behavior: calling confirm on a `requires_action` PI (after the user has completed 3DS in the browser) transitions it to `succeeded`/`requires_capture`.

**`next_action` on the PI shape:**

Add `next_action` to `buildPaymentIntentShape()` params. Default to `null`. Set to the 3DS object when entering `requires_action`.

---

## 4. Subscription Update Events

### Problem
Only `customer.subscription.created` and `customer.subscription.deleted` are emitted. No `customer.subscription.updated`.

### Design

This is wired into items 1 and 2 above. Summary of all emission points:

| Trigger | Event | `previous_attributes` |
|---|---|---|
| `SubscriptionService.update()` — items changed | `customer.subscription.updated` | `{ items: <old items list> }` |
| `SubscriptionService.update()` — cancel_at_period_end set | `customer.subscription.updated` | `{ cancel_at_period_end: <old>, cancel_at: <old> }` |
| `SubscriptionService.update()` — trial_end changed | `customer.subscription.updated` | `{ trial_end: <old>, status: <old> }` |
| `SubscriptionService.update()` — metadata changed | `customer.subscription.updated` | `{ metadata: <old> }` |
| `TestClockService.advance()` — period rollover | `customer.subscription.updated` | `{ current_period_start: <old>, current_period_end: <old> }` |
| `TestClockService.advance()` — trial ends | `customer.subscription.updated` | `{ status: "trialing", trial_end: <old> }` |
| `TestClockService.advance()` — payment fails | `customer.subscription.updated` | `{ status: "active" }` (now `past_due`) |

**EventService** already supports `previousAttributes` as the third arg to `emit()`. No changes needed there.

**SubscriptionService.cancel()** already emits `customer.subscription.deleted`. It should also emit `customer.subscription.updated` with `{ status: <old> }` before the deleted event, matching Stripe's real event ordering.

---

## Files Changed

| File | Change |
|---|---|
| `src/services/subscriptions.ts` | Add `update()` method, emit update events from `cancel()` |
| `src/routes/subscriptions.ts` | Add `POST /v1/subscriptions/:id` route |
| `src/services/test-clocks.ts` | Billing cycle processing in `advance()`. Constructor gains `SubscriptionService`, `InvoiceService`, `PriceService`, `EventService` deps. |
| `src/services/payment-intents.ts` | `requires_action` state + 3DS flow in `confirm()`, `next_action` in PI shape |
| `src/services/payment-methods.ts` | Add `tok_threeDSecureRequired`, `tok_threeDSecureOptional` to magic token map |
| `src/lib/id-generator.ts` | No changes needed (invoice_line_item prefix already exists) |
| `src/routes/subscriptions.ts` | Wire `priceService` into route for update validation |

**New test files:**
| File | Coverage |
|---|---|
| `tests/integration/subscription-updates.test.ts` | Item swap, cancel_at_period_end, trial_end, metadata update, event emission |
| `tests/integration/test-clock-billing.test.ts` | Clock advance triggers period rollover, invoice creation, payment, past_due on failure |
| `tests/integration/three-d-secure.test.ts` | `requires_action` → re-confirm → `succeeded`, capture after 3DS, magic card routing |

---

## Out of Scope

- Proration invoice math
- `default_payment_method` on subscriptions
- Tying test clocks to customers (we tie to subscriptions directly)
- Invoice line items with amounts (lines.data stays empty for now)
- Multi-period catch-up in a single advance (handled by the while loop, but no partial-period invoices)
