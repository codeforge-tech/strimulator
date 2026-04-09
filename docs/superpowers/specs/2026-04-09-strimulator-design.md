# Strimulator Design Spec

**Date:** 2026-04-09
**Status:** Approved

## Overview

Strimulator is a local-development Stripe emulator API. It 1:1 mirrors the Stripe API so that teams can test their payment integrations entirely offline. It ships as a single Docker image meant to sit alongside dev Postgres, Firebase emulator, etc. in a docker-compose stack.

## Goals

- Drop-in replacement for Stripe's API in local/test environments
- Compatible with the official `stripe` Node SDK (import types, point SDK at Strimulator)
- Strict fidelity: validate params, enforce state machines, return correct error shapes
- Interactive debug dashboard for inspecting state and triggering scenarios
- Well-covered with unit, integration, and SDK compatibility tests
- Single Dockerfile, zero external dependencies beyond SQLite

## Non-Goals

- Production use / multi-tenancy
- Connect (Accounts, Transfers, Payouts)
- Multi-version API support (single version: 2024-12-18)
- Stripe.js / client-side Elements emulation

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Framework | ElysiaJS |
| ORM | Drizzle ORM with bun:sqlite |
| Types | Imported from `stripe` npm package |
| Dashboard | Preact + HTM (vendored, no build pipeline) |
| Testing | bun:test |
| Container | oven/bun:alpine (multi-stage) |

## API Scope

### Resources

| Resource | Prefix | CRUD + Actions |
|----------|--------|---------------|
| Customers | `cus_` | create, retrieve, update, delete, list |
| PaymentMethods | `pm_` | create, retrieve, update, list, attach, detach |
| PaymentIntents | `pi_` | create, retrieve, update, list, confirm, capture, cancel |
| SetupIntents | `seti_` | create, retrieve, update, list, confirm, cancel |
| Charges | `ch_` | create, retrieve, update, list |
| Refunds | `re_` | create, retrieve, update, list |
| Products | `prod_` | create, retrieve, update, delete, list |
| Prices | `price_` | create, retrieve, update, list |
| Subscriptions | `sub_` | create, retrieve, update, list, cancel, resume |
| Subscription Items | `si_` | create, retrieve, update, delete, list |
| Invoices | `in_` | create, retrieve, update, list, finalize, pay, void |
| Invoice Line Items | `il_` | list |
| Webhook Endpoints | `we_` | create, retrieve, update, delete, list |
| Events | `evt_` | retrieve, list |
| Test Clocks | `clock_` | create, retrieve, advance, delete, list |

### Webhook Event Types

| Resource | Events |
|----------|--------|
| Customer | `customer.created`, `customer.updated`, `customer.deleted` |
| PaymentIntent | `payment_intent.created`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.requires_action` |
| PaymentMethod | `payment_method.attached`, `payment_method.detached` |
| Charge | `charge.succeeded`, `charge.failed`, `charge.refunded` |
| Refund | `refund.created`, `refund.updated` |
| SetupIntent | `setup_intent.created`, `setup_intent.succeeded`, `setup_intent.setup_failed` |
| Product | `product.created`, `product.updated`, `product.deleted` |
| Price | `price.created`, `price.updated`, `price.deleted` |
| Subscription | `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end` |
| Invoice | `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.upcoming` |

## Architecture

### Layered Design

```
Routes (ElysiaJS plugins)
  → param validation, response shaping, auth
  → imports Stripe SDK types for request/response contracts

Services (plain classes)
  → state machines, business logic, cross-service orchestration
  → event emission on every mutation

Data (Drizzle ORM)
  → SQLite tables with indexed columns + full JSON blob
  → migrations via Drizzle Kit
```

### Project Structure

```
src/
  index.ts                    # Entry point
  config.ts                   # Env var parsing
  app.ts                      # Elysia app factory

  routes/                     # One ElysiaJS plugin per resource
    customers.ts
    payment-intents.ts
    payment-methods.ts
    charges.ts
    refunds.ts
    setup-intents.ts
    products.ts
    prices.ts
    subscriptions.ts
    invoices.ts
    webhook-endpoints.ts
    test-clocks.ts
    events.ts

  services/                   # Business logic & state machines
    customers.ts
    payment-intents.ts
    payment-methods.ts
    charges.ts
    refunds.ts
    setup-intents.ts
    products.ts
    prices.ts
    subscriptions.ts
    invoices.ts
    webhook-endpoints.ts
    test-clocks.ts
    events.ts
    webhook-delivery.ts

  db/
    index.ts                  # Drizzle + bun:sqlite connection
    schema/                   # One file per table
    migrations/               # Drizzle Kit generated

  types/
    index.ts                  # Re-exported Stripe SDK types

  errors/
    index.ts                  # Stripe-compatible error factory

  middleware/
    api-key-auth.ts           # Validate sk_test_* bearer token
    idempotency.ts            # Idempotency-Key header support
    request-logger.ts         # Log requests for dashboard

  dashboard/
    server.ts                 # Elysia plugin for dashboard routes + static
    public/                   # Built Preact SPA assets
    src/                      # Dashboard source

  lib/
    id-generator.ts           # Stripe-style prefixed IDs
    pagination.ts             # Cursor-based pagination (starting_after, ending_after, limit)
    expand.ts                 # ?expand[] parameter support
    timestamps.ts             # Unix timestamp helpers

tests/
  unit/                       # Service layer tests
  integration/                # HTTP request/response tests
  fixtures/                   # Shared test data
```

## Data Model

Every table has a `data` column (JSON text) containing the full Stripe-shaped response object. Indexed columns are denormalized copies of fields needed for filtering, foreign keys, and state machine enforcement. Both are updated on every mutation.

### Tables

| Table | PK | Key Indexed Columns | Relations |
|-------|-----|-------------------|-----------|
| `customers` | `id` (cus_) | `email`, `created`, `deleted` | -> payment_methods, subscriptions, invoices |
| `payment_methods` | `id` (pm_) | `customer_id`, `type`, `created` | -> customers |
| `payment_intents` | `id` (pi_) | `customer_id`, `status`, `amount`, `currency`, `created` | -> customers, payment_methods, charges |
| `setup_intents` | `id` (seti_) | `customer_id`, `status`, `payment_method_id`, `created` | -> customers, payment_methods |
| `charges` | `id` (ch_) | `customer_id`, `payment_intent_id`, `status`, `amount`, `created` | -> customers, payment_intents |
| `refunds` | `id` (re_) | `charge_id`, `status`, `amount`, `created` | -> charges |
| `products` | `id` (prod_) | `active`, `name`, `created` | -> prices |
| `prices` | `id` (price_) | `product_id`, `active`, `type`, `currency`, `created` | -> products |
| `subscriptions` | `id` (sub_) | `customer_id`, `status`, `current_period_start`, `current_period_end`, `test_clock_id`, `created` | -> customers, prices |
| `subscription_items` | `id` (si_) | `subscription_id`, `price_id` | -> subscriptions, prices |
| `invoices` | `id` (in_) | `customer_id`, `subscription_id`, `status`, `amount_due`, `created` | -> customers, subscriptions |
| `invoice_line_items` | `id` (il_) | `invoice_id`, `price_id`, `amount` | -> invoices |
| `webhook_endpoints` | `id` (we_) | `url`, `status`, `created` | |
| `events` | `id` (evt_) | `type`, `created`, `api_version` | |
| `webhook_deliveries` | `id` | `event_id`, `endpoint_id`, `status`, `next_retry_at` | -> events, webhook_endpoints |
| `test_clocks` | `id` (clock_) | `frozen_time`, `status`, `created` | -> subscriptions |
| `idempotency_keys` | `key` | `api_path`, `response_code`, `created` | |
| `request_log` | `id` | `method`, `path`, `status_code`, `created` | |

### ID Generation

Stripe-style prefixed IDs: prefix + 14 random alphanumeric chars via `crypto.randomBytes`. Each resource type has its own prefix.

### Pagination

Cursor-based using `starting_after`, `ending_after`, `limit` (default 10, max 100). Ordered by `created` DESC with `id` as tiebreaker, matching Stripe's behavior.

### Request Body Format

Stripe's API accepts `application/x-www-form-urlencoded` for POST/PUT bodies (not JSON). The official SDK sends form-encoded data with Stripe's nested-key convention (e.g. `metadata[key]=value`, `items[0][price]=price_xxx`). Strimulator must parse this format. ElysiaJS handles this natively via `content-type` negotiation, but nested key expansion (Stripe's bracket notation) requires a custom parser.

### Metadata

Most resources support a `metadata` field — an arbitrary key-value map (string -> string, max 50 keys, max 500 chars per key/value). Stored within the `data` JSON blob. Supported on: Customers, PaymentIntents, PaymentMethods, SetupIntents, Charges, Refunds, Products, Prices, Subscriptions, Invoices.

### Expand

The `expand[]` query/body parameter allows embedding related objects inline instead of returning just their ID. Initial implementation supports one level of expansion (e.g. `expand[]=customer` on a PaymentIntent). Nested expansion (e.g. `expand[]=latest_invoice.payment_intent`) is supported for the common Subscription use case but not generalized to arbitrary depth.

## State Machines

### PaymentIntent

```
create(amount, currency)
  │
  ▼
requires_payment_method
  │ attach payment_method
  ▼
requires_confirmation
  │ confirm()
  ▼
processing
  ├── success ──► succeeded
  └── failure ──► requires_payment_method
  
succeeded (if capture_method=manual)
  │
  ▼
requires_capture
  │ capture()
  ▼
succeeded

Any non-terminal state → canceled (via cancel())
```

### Subscription

```
create(customer, price)
  │
  ├── (no trial) ──► incomplete ──► (invoice paid) ──► active
  └── (trial) ──► trialing ──► (trial ends) ──► active

active
  ├── payment fails ──► past_due ──► (recovery fails) ──► unpaid
  └── cancel() ──► canceled
```

### Simulated Payment Outcomes

Magic payment method values control outcomes in confirm flows:

| Payment Method | Outcome |
|---------------|---------|
| `pm_card_visa` | Succeeds |
| `pm_card_declined` | Fails: `card_declined` |
| `pm_card_insufficient_funds` | Fails: `insufficient_funds` |
| `pm_card_requires_action` | Moves to `requires_action` (3DS simulation) |

### Cross-Service Interactions

- `Subscription.create` -> `Invoice.create` -> `PaymentIntent.create` -> `Charge.create`
- Subscription period advance (Test Clock) -> next Invoice cycle
- `Refund.create` -> updates parent Charge refunded amount
- Every mutation -> `EventService.emit()` -> `WebhookDeliveryService.deliver()`

## Webhook System

### Event Creation

Every service mutation calls `EventService.emit()` which:
1. Constructs a `Stripe.Event` with correct `type`, `data.object`, and `data.previous_attributes`
2. Stores in `events` table
3. Enqueues delivery to matching webhook endpoints

### Endpoint Management

Standard CRUD via `POST/GET/DELETE /v1/webhook_endpoints`. Each endpoint stores:
- `url` — delivery target
- `enabled_events` — event type filter (or `["*"]` for all)
- `secret` — auto-generated `whsec_xxx` for signature verification
- `status` — `enabled` / `disabled`

### Delivery Engine

1. Find matching endpoints (by `enabled_events` filter)
2. Create `webhook_delivery` record (status: pending)
3. POST to endpoint URL with `Stripe-Signature` header (HMAC-SHA256, `v1=<hash>`)
4. 2xx -> mark delivered; non-2xx/timeout -> mark failed, schedule retry

Retry: up to 3 attempts with exponential backoff (1s, 10s, 60s). Async but in-process via `setTimeout` scheduling.

Signature uses the same scheme as real Stripe — apps using `stripe.webhooks.constructEvent()` verify correctly.

## Debug Dashboard

Served on the same port under `/dashboard`. Preact SPA with SSE for real-time updates.

### Pages

1. **Activity Feed** — Live stream of API requests (method, path, status, duration, expandable bodies)
2. **Resource Explorer** — Browse all objects by type, detail view with full JSON, linked related resources
3. **Webhooks** — Registered endpoints, delivery log per endpoint, expandable payloads
4. **Event Log** — Chronological events with type filter
5. **Actions Panel** — Interactive scenario triggers:
   - Fail next payment (configurable error code)
   - Advance test clock
   - Trigger webhook retry
   - Expire payment intent
   - Cycle subscription to next billing period

### Real-Time Updates

Request logger middleware pushes events to an in-memory event bus. SSE endpoint (`GET /dashboard/api/stream`) subscribes and streams to connected dashboard clients.

### Frontend

Preact + HTM, vendored (~4KB). Minimal CSS framework (pico.css or similar). No npm build pipeline for the dashboard itself.

## Testing Strategy

### Three Layers

**1. Unit tests (services layer) — primary surface:**
- State machine transitions (valid and invalid)
- Cross-service interactions
- Error cases (invalid params, wrong states -> Stripe error shapes)
- Magic payment method behavior
- Pagination, expand, idempotency

Services tested against real in-memory SQLite (`:memory:`), not mocks.

**2. Integration tests (HTTP layer):**
- URL routing and method handling
- Request param validation (missing required fields -> 400)
- Response shape matches Stripe types
- Auth header enforcement
- Idempotency-Key behavior
- Webhook delivery (spin up local HTTP server, register as endpoint, assert receipt)

**3. SDK compatibility tests:**
- Use the actual `stripe` Node SDK pointed at Strimulator
- Full flows: create customer -> attach PM -> create PI -> confirm -> check charge
- Subscription lifecycle with invoicing
- Webhook registration and receipt

**Coverage target:** Services 90%+, Routes 80%+, Dashboard API happy-path.

## Docker & Distribution

### Dockerfile

Multi-stage build on `oven/bun:alpine`:
1. Builder stage: install deps, build dashboard SPA, prune dev deps
2. Runtime stage: copy production node_modules, src, dashboard dist, drizzle migrations

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STRIMULATOR_PORT` | `12111` | Server port |
| `STRIMULATOR_DB_PATH` | `:memory:` | SQLite path (`:memory:` for ephemeral) |
| `STRIMULATOR_LOG_LEVEL` | `info` | Log verbosity |
| `STRIMULATOR_API_VERSION` | `2024-12-18` | Stripe API version in responses |

### Startup Sequence

1. Run Drizzle migrations (create tables if needed)
2. Boot ElysiaJS server
3. Log: `Strimulator running on http://localhost:12111 -- Dashboard: http://localhost:12111/dashboard`

### Consumer docker-compose Example

```yaml
services:
  strimulator:
    image: strimulator:latest
    ports:
      - "12111:12111"
    volumes:
      - strimulator-data:/data

  app:
    build: .
    environment:
      STRIPE_SECRET_KEY: sk_test_strimulator
      STRIPE_API_BASE: http://strimulator:12111
    depends_on:
      - strimulator

volumes:
  strimulator-data:
```

Single port serves API (`/v1/*`) and dashboard (`/dashboard/*`). `/data` volume optional for persistence across restarts.
