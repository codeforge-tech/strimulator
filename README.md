<p align="center">
  <h1 align="center">Strimulator</h1>
  <p align="center">A local Stripe emulator for development and testing</p>
</p>

<p align="center">
  <a href="docs/">Documentation</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#supported-resources">Resources</a> &bull;
  <a href="#sdk-usage">SDK Usage</a> &bull;
  <a href="#dashboard">Dashboard</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#api-reference">API Reference</a>
</p>

---

Strimulator is a drop-in local replacement for the Stripe API. It runs as a single process, stores everything in SQLite, and is compatible with the official `stripe` Node SDK. Use it to develop and test payment flows entirely offline — no Stripe account or network access required.

**Think of it as [LocalStack](https://github.com/localstack/localstack), but for Stripe.**

## Why Strimulator?

- **Offline development** — No internet, no Stripe test mode, no rate limits
- **Fast feedback** — Instant responses, no network latency
- **Full control** — Trigger payment failures, advance subscriptions, simulate edge cases from the dashboard
- **SDK-compatible** — Point the official `stripe` package at localhost and it just works
- **Docker-ready** — Drop it into your docker-compose alongside Postgres, Redis, Firebase emulator, etc.
- **496 tests** — Strict fidelity to Stripe's API shapes, state machines, and error formats

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Install and run

```bash
git clone https://github.com/codeforge-tech/strimulator.git
cd strimulator
bun install
bun run dev
```

Strimulator is now running:

- **API:** http://localhost:12111/v1/
- **Dashboard:** http://localhost:12111/dashboard

### Quick smoke test

```bash
# Create a customer
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -d "email=hello@example.com"

# Create a product and price
curl -X POST http://localhost:12111/v1/products \
  -H "Authorization: Bearer sk_test_123" \
  -d "name=Pro Plan"

# List customers
curl http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123"
```

## SDK Usage

Point the official Stripe SDK at Strimulator — no code changes needed beyond the configuration:

```typescript
import Stripe from "stripe";

const stripe = new Stripe("sk_test_strimulator", {
  host: "localhost",
  port: 12111,
  protocol: "http",
});

// Use exactly like real Stripe
const customer = await stripe.customers.create({ email: "dev@example.com" });
const product = await stripe.products.create({ name: "Pro Plan" });
const price = await stripe.prices.create({
  product: product.id,
  unit_amount: 2000,
  currency: "usd",
  recurring: { interval: "month" },
});
const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: price.id }],
});

console.log(subscription.status); // "active"
```

### Environment variable approach

If your app reads `STRIPE_SECRET_KEY`, you can switch to Strimulator without touching code:

```bash
STRIPE_SECRET_KEY=sk_test_strimulator \
STRIPE_API_BASE=http://localhost:12111 \
  npm run dev
```

## Supported Resources

| Resource | Endpoints | State Machine |
|----------|-----------|:------------:|
| Customers | CRUD + list + search | |
| Products | CRUD + list + search | |
| Prices | create, retrieve, update, list | |
| Payment Methods | create, retrieve, attach, detach, list | |
| Payment Intents | create, retrieve, confirm, capture, cancel, list, search | requires_payment_method → requires_confirmation → succeeded |
| Setup Intents | create, retrieve, confirm, cancel, list | requires_payment_method → requires_confirmation → succeeded |
| Charges | retrieve, list | |
| Refunds | create, retrieve, list | |
| Subscriptions | create, retrieve, cancel, list, search | active / trialing / canceled / past_due |
| Invoices | create, retrieve, finalize, pay, void, list, search | draft → open → paid / void |
| Events | retrieve, list | |
| Webhook Endpoints | CRUD + list | |
| Test Clocks | create, retrieve, advance, delete, list | |

### Additional features

- **Webhook delivery** — Registers endpoints via the API, delivers events with `Stripe-Signature` HMAC-SHA256 headers (compatible with `stripe.webhooks.constructEvent()`), retries on failure
- **Search API** — `/v1/customers/search`, `/v1/payment_intents/search`, etc. with Stripe's query language (`email:"foo@bar.com"`, `status:"active"`, `metadata["key"]:"value"`)
- **expand[]** — One-level and nested expansion (`expand[]=customer`, `expand[]=latest_invoice.payment_intent`)
- **Idempotency-Key** — POST requests with the same key return cached responses
- **Magic test tokens** — `tok_visa`, `tok_mastercard`, `tok_amex`, `tok_visa_debit` produce deterministic card details

## Dashboard

Open http://localhost:12111/dashboard for a real-time debug interface:

### Activity Feed
Live stream of all API requests — method, path, status code, timing.

### Resource Explorer
Browse all stored objects by type. Click any object to view its full JSON representation.

### Actions Panel
Trigger simulated scenarios without writing code:

| Action | Description |
|--------|-------------|
| **Fail Next Payment** | Force the next PaymentIntent confirmation to fail (card_declined, insufficient_funds, expired_card) |
| **Advance Test Clock** | Move a test clock forward in time, triggering subscription transitions |
| **Retry Webhook** | Re-deliver an event to a webhook endpoint |
| **Expire Payment Intent** | Force a PaymentIntent into canceled state |
| **Cycle Subscription** | Advance a subscription to the next billing period |

## Docker

### Docker Compose (recommended)

Add to your project's `docker-compose.yml`:

```yaml
services:
  strimulator:
    image: ghcr.io/codeforge-tech/strimulator:latest
    ports:
      - "12111:12111"
    volumes:
      - strimulator-data:/data

  your-app:
    build: .
    environment:
      STRIPE_SECRET_KEY: sk_test_strimulator
      STRIPE_API_BASE: http://strimulator:12111
    depends_on:
      - strimulator

volumes:
  strimulator-data:
```

### Build locally

```bash
docker build -t strimulator .
docker run -p 12111:12111 strimulator
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `STRIMULATOR_PORT` | `12111` | Server port |
| `STRIMULATOR_DB_PATH` | `:memory:` | SQLite file path. Use `:memory:` for ephemeral storage or a file path for persistence across restarts |
| `STRIMULATOR_LOG_LEVEL` | `info` | Log verbosity |
| `STRIMULATOR_API_VERSION` | `2024-12-18` | Stripe API version returned in responses |

## API Reference

All endpoints live under `/v1/` and follow Stripe's exact URL structure:

```
POST   /v1/customers
GET    /v1/customers/:id
POST   /v1/customers/:id
DELETE /v1/customers/:id
GET    /v1/customers
GET    /v1/customers/search?query=email:"foo@bar.com"
```

### Authentication

All `/v1/` requests require a bearer token starting with `sk_test_`:

```
Authorization: Bearer sk_test_anything
```

The actual key value doesn't matter — Strimulator accepts any `sk_test_*` key.

### Request format

Like real Stripe, requests use `application/x-www-form-urlencoded` (not JSON):

```bash
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -d "email=test@example.com" \
  -d "metadata[plan]=pro"
```

### Error format

Errors match Stripe's exact shape:

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "No such customer: 'cus_nonexistent'",
    "param": "id",
    "code": "resource_missing"
  }
}
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode (auto-reload)
bun run dev

# Run tests
bun test

# Run specific test file
bun test tests/sdk/payment-flow.test.ts
```

### Project structure

```
src/
  routes/        # ElysiaJS route plugins (one per Stripe resource)
  services/      # Business logic and state machines
  db/schema/     # Drizzle ORM table definitions
  middleware/    # Auth, idempotency, form parsing, request logging
  dashboard/    # Debug dashboard (API + Preact SPA)
  lib/          # Shared utilities (IDs, pagination, expand, search)
  errors/       # Stripe-compatible error factory
tests/
  unit/         # Service-layer tests
  integration/  # HTTP request/response tests
  sdk/          # Tests using the official stripe npm package
docs/            # Fumadocs documentation site (Next.js)
```

## Documentation

Full documentation is available in the `docs/` directory. To run it locally:

```bash
cd docs
bun install
bun run dev
```

Then open http://localhost:3000 for the docs site with Getting Started guides, API reference, and architecture documentation.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [ElysiaJS](https://elysiajs.com)
- **Database:** SQLite via [Drizzle ORM](https://orm.drizzle.team) + bun:sqlite
- **Types:** Imported from the [`stripe`](https://www.npmjs.com/package/stripe) npm package
- **Dashboard:** [Preact](https://preactjs.com) + [HTM](https://github.com/developit/htm) (loaded from CDN)
- **Testing:** bun:test (496 tests)
- **Documentation:** [Fumadocs](https://fumadocs.dev) + OpenAPI

## License

MIT
