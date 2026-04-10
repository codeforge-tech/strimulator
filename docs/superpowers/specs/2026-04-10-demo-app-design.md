# Demo E-commerce App Design

A demo Astro SSR application that consumes Strimulator as a Stripe API replacement, showcasing an end-to-end e-commerce checkout flow with a custom card form mimicking Stripe Elements.

## Architecture

```
demo/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── src/
│   ├── lib/
│   │   └── stripe.ts            # Stripe SDK client pointed at Strimulator
│   ├── pages/
│   │   ├── index.astro           # Product listing
│   │   ├── checkout.astro        # Cart + payment form
│   │   ├── success.astro         # Confirmation page
│   │   ├── failed.astro          # Error page
│   │   └── api/
│   │       ├── pay.ts            # POST — create customer, PM, PI, confirm
│   │       └── confirm.ts        # POST — re-confirm PI after 3DS
│   ├── components/
│   │   └── CardForm.astro        # Custom card input mimicking Elements
│   └── layouts/
│       └── Layout.astro          # Shared HTML shell
```

### Why a custom card form instead of real Stripe Elements

Real `@stripe/stripe-js` loaded from `js.stripe.com` always talks to Stripe's servers — it cannot be pointed at localhost. The demo uses a custom card form that:

- Looks like Stripe Elements (similar field styling)
- Pre-fills card details based on a test scenario selector
- Sends a magic token (`tok_visa`, `tok_chargeDeclined`, etc.) to the Astro server
- The server does all Stripe SDK calls against Strimulator

## Pages

### Product listing (`/`)

A clean grid of 3 hardcoded products:

| Product        | Price |
|---------------|-------|
| Classic T-Shirt | $25   |
| Coffee Mug      | $15   |
| Sticker Pack    | $8    |

Each card has a placeholder image, name, price, and "Buy Now" button. Clicking navigates to `/checkout?product=<index>`.

### Checkout (`/checkout?product=0`)

Two-column layout:
- **Left:** Order summary — product name, price, total
- **Right:** Payment form
  - Test card selector (dropdown): "Visa (success)", "Mastercard (success)", "Declined card", "3DS Required"
  - Card number, expiry, CVC fields — pre-filled and read-only based on selector. These are visual only; the magic token does the real work.
  - "Pay $XX" submit button

On submit: POST to `/api/pay`, show loading state, redirect based on result.

### Success (`/success?payment_intent=pi_xxx`)

Green confirmation banner with:
- Payment Intent ID
- Amount charged
- Status
- Link back to product listing
- Link to Strimulator dashboard (`http://localhost:12111/dashboard`) to inspect created objects

### Failed (`/failed?error=...`)

Red error banner showing the decline reason. "Try again" link back to checkout.

## Backend

### Stripe SDK client (`demo/src/lib/stripe.ts`)

```ts
import Stripe from "stripe";

export const stripe = new Stripe("sk_test_strimulator", {
  host: "localhost",
  port: 12111,
  protocol: "http",
} as any);
```

Same pattern used in the existing SDK test suite.

### Product bootstrap

On first request (lazy init via module-level flag), creates 3 Products and 3 Prices in Strimulator via the SDK. Stores resulting objects in a module-level array for page rendering.

### `POST /api/pay`

Receives: `{ token: string, productIndex: number }`

Flow:
1. Look up product/price by index
2. Create Customer via SDK
3. Create PaymentMethod with the magic token
4. Attach PM to customer
5. Create PaymentIntent with `amount`, `currency: "usd"`, `customer`, `payment_method`, `confirm: true`
6. If PI status is `succeeded` → return `{ success: true, paymentIntentId: pi.id }`
7. If PI status is `requires_action` (3DS) → return `{ requires_action: true, paymentIntentId: pi.id }`
8. If PI has `last_payment_error` → return `{ success: false, error: pi.last_payment_error.message }`

### `POST /api/confirm`

Receives: `{ paymentIntentId: string }`

Calls `stripe.paymentIntents.confirm(paymentIntentId)` and returns the result. Used after the simulated 3DS challenge.

## 3DS Simulation

When `tok_threeDSecureRequired` is selected:
1. `/api/pay` returns `{ requires_action: true, paymentIntentId }`
2. Frontend shows a simulated 3DS challenge UI (a styled modal with an "Authorize Payment" button)
3. Clicking "Authorize" POSTs to `/api/confirm`
4. On success, redirects to `/success`

## Test Card Scenarios

| Selector label     | Token                      | Expected result       |
|-------------------|----------------------------|-----------------------|
| Visa (success)     | `tok_visa`                 | `succeeded`           |
| Mastercard (success) | `tok_mastercard`         | `succeeded`           |
| Declined card      | `tok_chargeDeclined`       | Decline error         |
| 3DS Required       | `tok_threeDSecureRequired` | `requires_action`     |

## Orchestration

### `scripts/demo.ts`

A Bun script that:
1. Spawns `bun run start` (Strimulator on port 12111)
2. Spawns `cd demo && npx astro dev` (Astro on port 4321)
3. Prefixes stdout/stderr with `[strimulator]` and `[demo]`
4. On SIGINT/SIGTERM, kills both children and exits cleanly

### Root `package.json` addition

```json
"demo": "bun scripts/demo.ts"
```

## Styling

Minimal, clean CSS — no framework. Enough to look polished:
- System font stack
- Card-based product grid
- Stripe Elements-like input styling (rounded borders, focus states, consistent spacing)
- "Powered by Strimulator" badge in footer linking to dashboard

## Dependencies (demo/package.json)

- `astro` — framework
- `@astrojs/node` — SSR adapter
- `stripe` — Node SDK (talks to Strimulator)

No other dependencies.
