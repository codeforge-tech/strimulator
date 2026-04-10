# Fumadocs Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a beautiful, auto-generated documentation site to Strimulator using Fumadocs with OpenAPI-powered API reference.

**Architecture:** A Next.js app in `docs/` using Fumadocs UI for the documentation framework. An OpenAPI 3.1 spec is hand-maintained in `docs/openapi.json`, and `fumadocs-openapi` generates interactive API reference MDX pages from it. Hand-written MDX pages cover Getting Started, Guides, and Architecture sections.

**Tech Stack:** Next.js, Fumadocs (fumadocs-ui, fumadocs-core, fumadocs-mdx, fumadocs-openapi), Tailwind CSS, Bun

---

### Task 1: Scaffold Fumadocs Next.js app

**Files:**
- Create: `docs/package.json`
- Create: `docs/next.config.mjs`
- Create: `docs/source.config.ts`
- Create: `docs/tsconfig.json`
- Create: `docs/postcss.config.mjs`
- Create: `docs/tailwind.config.ts` (if needed by fumadocs-ui)

- [ ] **Step 1: Create `docs/package.json`**

```json
{
  "name": "strimulator-docs",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "generate": "bun ./scripts/generate-docs.ts"
  },
  "dependencies": {
    "fumadocs-core": "latest",
    "fumadocs-mdx": "latest",
    "fumadocs-openapi": "latest",
    "fumadocs-ui": "latest",
    "next": "^15",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4"
  }
}
```

- [ ] **Step 2: Create `docs/next.config.mjs`**

```js
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {};

export default withMDX(config);
```

- [ ] **Step 3: Create `docs/source.config.ts`**

```ts
import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig();
```

- [ ] **Step 4: Create `docs/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".source/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create `docs/postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Install dependencies**

Run: `cd docs && bun install`
Expected: `node_modules/` created, lock file generated

- [ ] **Step 7: Commit**

```bash
git add docs/package.json docs/next.config.mjs docs/source.config.ts docs/tsconfig.json docs/postcss.config.mjs docs/bun.lock
git commit -m "Scaffold Fumadocs Next.js app in docs/"
```

---

### Task 2: Set up Next.js app directory with Fumadocs UI

**Files:**
- Create: `docs/app/layout.tsx`
- Create: `docs/app/global.css`
- Create: `docs/app/docs/layout.tsx`
- Create: `docs/app/docs/[[...slug]]/page.tsx`
- Create: `docs/lib/source.ts`
- Create: `docs/lib/layout.shared.tsx`
- Create: `docs/components/mdx.tsx`

- [ ] **Step 1: Create `docs/app/global.css`**

```css
@import "tailwindcss";
@import "fumadocs-ui/css/ui.css";
```

- [ ] **Step 2: Create `docs/lib/source.ts`**

```ts
import { docs, meta } from '@/.source';
import { createMDXSource } from 'fumadocs-mdx/runtime/next';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: createMDXSource(docs, meta),
});
```

- [ ] **Step 3: Create `docs/lib/layout.shared.tsx`**

```tsx
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Strimulator',
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs',
        active: 'nested-url',
      },
    ],
    githubUrl: 'https://github.com/codeforge-tech/strimulator',
  };
}
```

- [ ] **Step 4: Create `docs/app/layout.tsx`**

```tsx
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './global.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create `docs/app/docs/layout.tsx`**

```tsx
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      {children}
    </DocsLayout>
  );
}
```

- [ ] **Step 6: Create `docs/components/mdx.tsx`**

```tsx
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(): MDXComponents {
  return {
    ...defaultMdxComponents,
  };
}
```

- [ ] **Step 7: Create `docs/app/docs/[[...slug]]/page.tsx`**

```tsx
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from 'fumadocs-ui/layouts/docs/page';
import { getMDXComponents } from '@/components/mdx';

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) notFound();

  const Mdx = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Mdx components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
```

- [ ] **Step 8: Create `docs/app/page.tsx`** (root redirect to /docs)

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/docs');
}
```

- [ ] **Step 9: Commit**

```bash
git add docs/app/ docs/lib/ docs/components/
git commit -m "Set up Fumadocs UI app directory with layouts and page renderer"
```

---

### Task 3: Create initial content pages — Getting Started

**Files:**
- Create: `docs/content/docs/index.mdx`
- Create: `docs/content/docs/meta.json`
- Create: `docs/content/docs/getting-started/meta.json`
- Create: `docs/content/docs/getting-started/installation.mdx`
- Create: `docs/content/docs/getting-started/quick-start.mdx`
- Create: `docs/content/docs/getting-started/connecting-sdk.mdx`

- [ ] **Step 1: Create `docs/content/docs/meta.json`**

This controls the top-level sidebar navigation order.

```json
{
  "title": "Strimulator",
  "pages": [
    "---Getting Started---",
    "getting-started",
    "---Guides---",
    "guides",
    "---API Reference---",
    "api",
    "---Architecture---",
    "architecture"
  ]
}
```

- [ ] **Step 2: Create `docs/content/docs/index.mdx`**

```mdx
---
title: Strimulator
description: A local Stripe emulator for development and testing
---

Strimulator is a drop-in local replacement for the Stripe API. It runs as a single process, stores everything in SQLite, and is compatible with the official `stripe` Node SDK. Use it to develop and test payment flows entirely offline — no Stripe account or network access required.

**Think of it as [LocalStack](https://github.com/localstack/localstack), but for Stripe.**

## Why Strimulator?

- **Offline development** — No internet, no Stripe test mode, no rate limits
- **Fast feedback** — Instant responses, no network latency
- **Full control** — Trigger payment failures, advance subscriptions, simulate edge cases from the dashboard
- **SDK-compatible** — Point the official `stripe` package at localhost and it just works
- **Docker-ready** — Drop it into your docker-compose alongside Postgres, Redis, Firebase emulator, etc.

## Supported Resources

| Resource | Endpoints | State Machine |
|----------|-----------|:------------:|
| Customers | CRUD + list + search | |
| Products | CRUD + list + search | |
| Prices | create, retrieve, update, list | |
| Payment Methods | create, retrieve, attach, detach, list | |
| Payment Intents | create, retrieve, confirm, capture, cancel, list, search | ✓ |
| Setup Intents | create, retrieve, confirm, cancel, list | ✓ |
| Charges | retrieve, list | |
| Refunds | create, retrieve, list | |
| Subscriptions | create, retrieve, cancel, list, search | ✓ |
| Invoices | create, retrieve, finalize, pay, void, list, search | ✓ |
| Events | retrieve, list | |
| Webhook Endpoints | CRUD + list | |
| Test Clocks | create, retrieve, advance, delete, list | |

## Additional Features

- **Webhook delivery** with `Stripe-Signature` HMAC-SHA256 headers and retry logic
- **Search API** with Stripe's query language
- **expand[]** for one-level and nested expansion
- **Idempotency-Key** support for POST requests
- **Magic test tokens** — `tok_visa`, `tok_mastercard`, `tok_amex`, `tok_visa_debit`
```

- [ ] **Step 3: Create `docs/content/docs/getting-started/meta.json`**

```json
{
  "title": "Getting Started",
  "pages": ["installation", "quick-start", "connecting-sdk"]
}
```

- [ ] **Step 4: Create `docs/content/docs/getting-started/installation.mdx`**

```mdx
---
title: Installation
description: Install and run Strimulator locally or with Docker
---

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (for local install)
- Or [Docker](https://www.docker.com/) (for containerized setup)

## Local Install

```bash
git clone https://github.com/codeforge-tech/strimulator.git
cd strimulator
bun install
bun run dev
```

Strimulator is now running:

- **API:** http://localhost:12111/v1/
- **Dashboard:** http://localhost:12111/dashboard

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
| `STRIMULATOR_DB_PATH` | `:memory:` | SQLite path. Use a file path for persistence across restarts |
| `STRIMULATOR_LOG_LEVEL` | `info` | Log verbosity |
| `STRIMULATOR_API_VERSION` | `2024-12-18` | Stripe API version in responses |
```

- [ ] **Step 5: Create `docs/content/docs/getting-started/quick-start.mdx`**

```mdx
---
title: Quick Start
description: Make your first API calls to Strimulator
---

With Strimulator running (`bun run dev`), try these requests:

## Create a Customer

```bash
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -d "email=hello@example.com" \
  -d "name=Jane Doe"
```

## Create a Product and Price

```bash
curl -X POST http://localhost:12111/v1/products \
  -H "Authorization: Bearer sk_test_123" \
  -d "name=Pro Plan"

# Use the product ID from the response
curl -X POST http://localhost:12111/v1/prices \
  -H "Authorization: Bearer sk_test_123" \
  -d "product=prod_xxxxx" \
  -d "unit_amount=2000" \
  -d "currency=usd" \
  -d "recurring[interval]=month"
```

## Create a Payment Intent

```bash
curl -X POST http://localhost:12111/v1/payment_intents \
  -H "Authorization: Bearer sk_test_123" \
  -d "amount=2000" \
  -d "currency=usd" \
  -d "payment_method=tok_visa" \
  -d "confirm=true"
```

## List Resources

```bash
curl http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123"
```

## Authentication

All `/v1/` requests require a bearer token starting with `sk_test_`:

```
Authorization: Bearer sk_test_anything
```

The actual key value doesn't matter — Strimulator accepts any `sk_test_*` key.

## Request Format

Like real Stripe, requests use `application/x-www-form-urlencoded` (not JSON):

```bash
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -d "email=test@example.com" \
  -d "metadata[plan]=pro"
```
```

- [ ] **Step 6: Create `docs/content/docs/getting-started/connecting-sdk.mdx`**

```mdx
---
title: Connecting the Stripe SDK
description: Use the official Stripe SDK with Strimulator
---

Point the official Stripe SDK at Strimulator — no code changes needed beyond the configuration.

## Node.js / TypeScript

```typescript
import Stripe from "stripe";

const stripe = new Stripe("sk_test_strimulator", {
  host: "localhost",
  port: 12111,
  protocol: "http",
});

// Use exactly like real Stripe
const customer = await stripe.customers.create({
  email: "dev@example.com",
});

const product = await stripe.products.create({
  name: "Pro Plan",
});

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

## Environment Variable Approach

If your app reads `STRIPE_SECRET_KEY`, you can switch to Strimulator without touching code:

```bash
STRIPE_SECRET_KEY=sk_test_strimulator \
STRIPE_API_BASE=http://localhost:12111 \
  npm run dev
```

## Docker Compose

When using Docker Compose, point your app at the service name:

```yaml
services:
  strimulator:
    image: ghcr.io/codeforge-tech/strimulator:latest
    ports:
      - "12111:12111"

  your-app:
    build: .
    environment:
      STRIPE_SECRET_KEY: sk_test_strimulator
      STRIPE_API_BASE: http://strimulator:12111
    depends_on:
      - strimulator
```
```

- [ ] **Step 7: Verify the docs build**

Run: `cd docs && bun run build`
Expected: Build succeeds with the index page and three getting-started pages

- [ ] **Step 8: Commit**

```bash
git add docs/content/docs/
git commit -m "Add Getting Started documentation pages"
```

---

### Task 4: Create Guide pages

**Files:**
- Create: `docs/content/docs/guides/meta.json`
- Create: `docs/content/docs/guides/webhooks.mdx`
- Create: `docs/content/docs/guides/test-clocks.mdx`
- Create: `docs/content/docs/guides/3ds-simulation.mdx`
- Create: `docs/content/docs/guides/dashboard.mdx`
- Create: `docs/content/docs/guides/idempotency.mdx`

- [ ] **Step 1: Create `docs/content/docs/guides/meta.json`**

```json
{
  "title": "Guides",
  "pages": ["webhooks", "test-clocks", "3ds-simulation", "dashboard", "idempotency"]
}
```

- [ ] **Step 2: Create `docs/content/docs/guides/webhooks.mdx`**

```mdx
---
title: Webhooks
description: Register webhook endpoints and receive event notifications
---

Strimulator delivers webhook events just like Stripe — with HMAC-SHA256 signatures, retry logic, and the same event shapes.

## Registering a Webhook Endpoint

```bash
curl -X POST http://localhost:12111/v1/webhook_endpoints \
  -H "Authorization: Bearer sk_test_123" \
  -d "url=http://localhost:3000/webhooks/stripe" \
  -d "enabled_events[]=customer.created" \
  -d "enabled_events[]=payment_intent.succeeded"
```

Or using the SDK:

```typescript
const endpoint = await stripe.webhookEndpoints.create({
  url: "http://localhost:3000/webhooks/stripe",
  enabled_events: [
    "customer.created",
    "payment_intent.succeeded",
  ],
});
```

Use `enabled_events: ["*"]` to receive all event types.

## Signature Verification

Strimulator signs webhook payloads with HMAC-SHA256, compatible with `stripe.webhooks.constructEvent()`:

```typescript
import Stripe from "stripe";

const stripe = new Stripe("sk_test_strimulator", {
  host: "localhost",
  port: 12111,
  protocol: "http",
});

// In your webhook handler
const event = stripe.webhooks.constructEvent(
  body,
  request.headers["stripe-signature"],
  endpoint.secret, // from the webhook endpoint's `secret` field
);
```

## Retry Behavior

When your endpoint returns a non-2xx status, Strimulator retries delivery. Failed deliveries and their status are visible in the dashboard.

## Managing Webhooks from the Dashboard

Open http://localhost:12111/dashboard and go to the **Webhooks** tab to:

- View registered webhook endpoints
- See delivery history and status
- Retry failed deliveries
```

- [ ] **Step 3: Create `docs/content/docs/guides/test-clocks.mdx`**

```mdx
---
title: Test Clocks
description: Simulate time advancement for subscription billing
---

Test clocks let you simulate the passage of time to test subscription lifecycle events — billing cycles, trial expirations, and period transitions.

## Creating a Test Clock

```typescript
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: Math.floor(Date.now() / 1000),
  name: "Billing test",
});
```

## Linking a Subscription to a Clock

Create a customer with `test_clock`, then create subscriptions on that customer:

```typescript
const customer = await stripe.customers.create({
  email: "test@example.com",
  test_clock: clock.id,
});

const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: priceId }],
});
```

## Advancing Time

Move the clock forward to trigger billing events:

```typescript
await stripe.testHelpers.testClocks.advance(clock.id, {
  frozen_time: clock.frozen_time + 30 * 24 * 60 * 60, // +30 days
});
```

When advanced, Strimulator processes billing cycles for linked subscriptions:

- Rolls subscription periods forward
- Creates and finalizes invoices
- Processes payments (creates charges)
- Handles trial-to-active transitions

## Dashboard

You can also advance test clocks from the dashboard's **Actions** panel without writing code.
```

- [ ] **Step 4: Create `docs/content/docs/guides/3ds-simulation.mdx`**

```mdx
---
title: 3D Secure Simulation
description: Simulate 3DS authentication challenges in payment flows
---

Strimulator supports simulating 3D Secure (3DS) authentication challenges for testing payment flows that require additional verification.

## Triggering 3DS

Use the magic token `tok_threeDSecureRequired` (a payment method with last4 `3220`) to trigger `requires_action` status on confirm:

```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: 2000,
  currency: "usd",
  payment_method: "tok_threeDSecureRequired",
  confirm: true,
});

console.log(paymentIntent.status); // "requires_action"
console.log(paymentIntent.next_action?.type); // "use_stripe_sdk"
```

## Completing the 3DS Challenge

Re-confirm the payment intent to simulate the user completing the 3DS challenge:

```typescript
const completed = await stripe.paymentIntents.confirm(paymentIntent.id);
console.log(completed.status); // "succeeded"
```

## Flow Summary

```
Create PI with tok_threeDSecureRequired + confirm: true
  → status: "requires_action"
  → next_action: { type: "use_stripe_sdk" }

Re-confirm the PI
  → status: "succeeded"
  → charge created
```
```

- [ ] **Step 5: Create `docs/content/docs/guides/dashboard.mdx`**

```mdx
---
title: Dashboard
description: Real-time debug interface for monitoring and testing
---

Strimulator includes a built-in debug dashboard at http://localhost:12111/dashboard.

## Activity Feed

Live stream of all API requests showing method, path, status code, and timing. Uses Server-Sent Events (SSE) for real-time updates.

## Resource Explorer

Browse all stored objects by type. Click any object to view its full JSON representation.

## Actions Panel

Trigger simulated scenarios without writing code:

| Action | Description |
|--------|-------------|
| **Fail Next Payment** | Force the next PaymentIntent confirmation to fail (`card_declined`, `insufficient_funds`, `expired_card`) |
| **Advance Test Clock** | Move a test clock forward in time, triggering subscription transitions |
| **Retry Webhook** | Re-deliver an event to a webhook endpoint |
| **Expire Payment Intent** | Force a PaymentIntent into canceled state |
| **Cycle Subscription** | Advance a subscription to the next billing period |

## Webhooks Tab

View registered webhook endpoints, delivery history, and retry failed deliveries.

## Access

The dashboard is not auth-protected — it's designed for local development use only.
```

- [ ] **Step 6: Create `docs/content/docs/guides/idempotency.mdx`**

```mdx
---
title: Idempotency
description: How Idempotency-Key works in Strimulator
---

Strimulator supports the `Idempotency-Key` header on POST requests, matching Stripe's behavior.

## How It Works

Send an `Idempotency-Key` header with any POST request. If the same key is sent again, Strimulator returns the cached response instead of creating a duplicate resource.

```bash
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -H "Idempotency-Key: unique-key-123" \
  -d "email=test@example.com"

# Same key → same response, no duplicate customer
curl -X POST http://localhost:12111/v1/customers \
  -H "Authorization: Bearer sk_test_123" \
  -H "Idempotency-Key: unique-key-123" \
  -d "email=test@example.com"
```

## SDK Usage

The Stripe SDK automatically generates idempotency keys for most create operations. You can also specify one explicitly:

```typescript
const customer = await stripe.customers.create(
  { email: "test@example.com" },
  { idempotencyKey: "unique-key-123" },
);
```

## Behavior

- Keys are scoped to the API key and endpoint
- Cached responses are returned with the same status code and body
- Only POST requests support idempotency keys
- Keys are stored in-memory (or SQLite depending on `STRIMULATOR_DB_PATH`)
```

- [ ] **Step 7: Verify the docs build**

Run: `cd docs && bun run build`
Expected: Build succeeds with all guide pages in the sidebar

- [ ] **Step 8: Commit**

```bash
git add docs/content/docs/guides/
git commit -m "Add documentation guide pages"
```

---

### Task 5: Create Architecture / Contributing pages

**Files:**
- Create: `docs/content/docs/architecture/meta.json`
- Create: `docs/content/docs/architecture/overview.mdx`
- Create: `docs/content/docs/architecture/request-lifecycle.mdx`
- Create: `docs/content/docs/architecture/services.mdx`
- Create: `docs/content/docs/architecture/contributing.mdx`

- [ ] **Step 1: Create `docs/content/docs/architecture/meta.json`**

```json
{
  "title": "Architecture",
  "pages": ["overview", "request-lifecycle", "services", "contributing"]
}
```

- [ ] **Step 2: Create `docs/content/docs/architecture/overview.mdx`**

```mdx
---
title: Architecture Overview
description: How Strimulator is built
---

Strimulator emulates Stripe's REST API over HTTP using Elysia (Bun's web framework) + SQLite via Drizzle ORM. It returns real `Stripe.*` types from the official `stripe` npm package.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Framework | [ElysiaJS](https://elysiajs.com) |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team) + bun:sqlite |
| Types | Imported from [`stripe`](https://www.npmjs.com/package/stripe) npm package |
| Dashboard | [Preact](https://preactjs.com) + [HTM](https://github.com/developit/htm) |
| Testing | bun:test |

## Project Structure

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
```

## Key Design Decisions

- **Stripe type fidelity:** Services return `Stripe.*` types directly from the official package, ensuring response shapes always match real Stripe.
- **Synchronous DB:** bun:sqlite is synchronous, so services are synchronous. Routes are async only for body parsing and expansion.
- **In-memory by default:** Using `:memory:` SQLite for ephemeral storage makes tests fast and isolated. File-backed persistence is opt-in.
- **Single process:** No external dependencies — one binary, one port, everything included.
```

- [ ] **Step 3: Create `docs/content/docs/architecture/request-lifecycle.mdx`**

```mdx
---
title: Request Lifecycle
description: How an HTTP request flows through Strimulator
---

Every API request passes through a middleware chain before reaching the route handler:

```
HTTP request
  → apiKeyAuth (validates Bearer sk_test_*)
  → idempotencyMiddleware (caches POST responses by Idempotency-Key header)
  → requestLogger (emits to globalBus for dashboard SSE)
  → route handler
    → parseStripeBody() (decodes x-www-form-urlencoded with bracket notation)
    → service method (DB read/write, state validation)
    → eventService.emit() (triggers webhook delivery)
  → response
```

## Middleware

### API Key Auth

Validates the `Authorization: Bearer sk_test_*` header. Any key starting with `sk_test_` is accepted — Strimulator doesn't verify specific keys.

Source: `src/middleware/api-key-auth.ts`

### Idempotency

Caches POST responses keyed by the `Idempotency-Key` header. Replay requests return the cached response without re-executing the handler.

Source: `src/middleware/idempotency.ts`

### Request Logger

Emits every request to the global event bus for the dashboard's live activity feed via SSE.

Source: `src/middleware/request-logger.ts`

### Form Parser

Decodes `application/x-www-form-urlencoded` bodies with Stripe's bracket notation (`metadata[key]=value`, `items[0][price]=...`).

Source: `src/middleware/form-parser.ts`

## Route → Service → Response

Routes are Elysia plugin factories that:

1. Parse the form-encoded body with `parseStripeBody()`
2. Call the appropriate service method
3. Emit events via `eventService.emit()` (triggers webhook delivery)
4. Return the Stripe-typed response

## Expansion

Routes that support `?expand[]=field` use `applyExpand()` with a config mapping field names to resolver functions. Supports nested expansion via dot notation (`expand[]=latest_invoice.payment_intent`).

Source: `src/lib/expand.ts`

## Pagination

All list endpoints use cursor-based pagination via `created` timestamp and `starting_after` parameter. Returns `{ object: "list", data: [...], has_more: boolean }`.

Source: `src/lib/pagination.ts`
```

- [ ] **Step 4: Create `docs/content/docs/architecture/services.mdx`**

```mdx
---
title: Services
description: Business logic layer and state machines
---

Services are classes in `src/services/` that encapsulate all business logic. Each service takes `StrimulatorDB` in the constructor and returns `Stripe.*` types.

## Pattern

```typescript
class CustomerService {
  constructor(private db: StrimulatorDB) {}

  create(params: CreateParams): Stripe.Customer {
    // Validate, insert to DB, build shape, return
  }

  retrieve(id: string): Stripe.Customer {
    // Query DB, build shape, return (or throw 404)
  }
}
```

Each resource has a `build*Shape()` function that constructs the full Stripe object. The full JSON is stored in a `data` text column; key fields are indexed separately for queries.

## State Machines

Resources with lifecycle states validate transitions with `stateTransitionError()`:

### Payment Intents

```
requires_payment_method → requires_confirmation → requires_action → succeeded
                                                                   → canceled
```

### Setup Intents

```
requires_payment_method → requires_confirmation → succeeded
                                                → canceled
```

### Subscriptions

```
trialing → active → past_due → canceled
                   → canceled
```

### Invoices

```
draft → open → paid
             → void
```

## Event Emission

Services with state changes emit events via an optional `EventService` dependency:

```typescript
this.eventService?.emit("payment_intent.succeeded", paymentIntent);
```

`EventService.emit()` persists the event to DB and synchronously notifies listeners. `WebhookDeliveryService` is registered as a listener and delivers to matching webhook endpoints with HMAC-SHA256 signatures.

## Search

Search endpoints load all rows and filter in-memory via `parseSearchQuery()` / `matchesCondition()`. Supports Stripe's query language:

- `email:"foo@bar.com"` — exact match
- `status~"act"` — contains
- `metadata["key"]:"value"` — metadata search
- Combine with `AND`
```

- [ ] **Step 5: Create `docs/content/docs/architecture/contributing.mdx`**

```mdx
---
title: Contributing
description: Development setup and guidelines for contributors
---

## Development Setup

```bash
git clone https://github.com/codeforge-tech/strimulator.git
cd strimulator
bun install
bun run dev   # Start with watch mode
```

## Running Tests

```bash
bun test                 # Run all tests (unit + integration + SDK)
bun test tests/unit/     # Run unit tests only
bun test tests/sdk/      # Run SDK tests only
bun test tests/integration/customers.test.ts  # Single file
bun x tsc --noEmit       # Type check
```

## Adding a New Resource

1. **Schema:** Create `src/db/schema/<resource>.ts` with the Drizzle table definition
2. **Service:** Create `src/services/<resource>.ts` with a class that takes `StrimulatorDB`
3. **Routes:** Create `src/routes/<resource>.ts` as an Elysia plugin factory
4. **Wire up:** Register routes in `src/app.ts`
5. **Tests:** Add unit tests in `tests/unit/` and SDK tests in `tests/sdk/`

## Conventions

- **IDs:** Generated via `generateId(type)` with crypto.randomBytes. Each type has a prefix (`cus_`, `pi_`, `sub_`, etc.) defined in `src/lib/id-generator.ts`.
- **Body format:** Always `application/x-www-form-urlencoded` with bracket notation. Use `parseStripeBody()`.
- **Soft deletes:** Use a `deleted` integer flag (0/1), never hard-delete.
- **No conventional commits:** Write clear descriptions, don't prefix with `feat:`, `fix:`, etc.

## Database Migrations

```bash
bun run db:generate  # Generate migration from schema changes
bun run db:migrate   # Apply migrations
```
```

- [ ] **Step 6: Verify the docs build**

Run: `cd docs && bun run build`
Expected: Build succeeds with all architecture pages in the sidebar

- [ ] **Step 7: Commit**

```bash
git add docs/content/docs/architecture/
git commit -m "Add architecture and contributing documentation"
```

---

### Task 6: Create OpenAPI spec

**Files:**
- Create: `docs/openapi.json`

- [ ] **Step 1: Create `docs/openapi.json`**

Write a complete OpenAPI 3.1 spec covering all 13 resources with their endpoints. The spec must include:

- `info` with title "Strimulator API", version "1.0.0"
- `servers` pointing to `http://localhost:12111`
- `security` with bearer auth (`sk_test_*`)
- All paths from the route analysis:
  - **Customers:** POST/GET/DELETE `/v1/customers`, GET `/v1/customers/search`, GET/POST/DELETE `/v1/customers/{id}`
  - **Products:** POST/GET `/v1/products`, GET/POST/DELETE `/v1/products/{id}`
  - **Prices:** POST/GET `/v1/prices`, GET/POST `/v1/prices/{id}`
  - **Payment Methods:** POST/GET `/v1/payment_methods`, GET `/v1/payment_methods/{id}`, POST attach/detach
  - **Payment Intents:** POST/GET `/v1/payment_intents`, GET search, GET/POST `/{id}`, POST confirm/capture/cancel
  - **Setup Intents:** POST/GET `/v1/setup_intents`, GET `/{id}`, POST confirm/cancel
  - **Charges:** GET `/v1/charges`, GET `/{id}`
  - **Refunds:** POST/GET `/v1/refunds`, GET `/{id}`
  - **Subscriptions:** POST/GET `/v1/subscriptions`, GET search, GET/POST `/{id}`, DELETE `/{id}`
  - **Invoices:** POST/GET `/v1/invoices`, GET search, GET `/{id}`, POST finalize/pay/void
  - **Events:** GET `/v1/events`, GET `/{id}`
  - **Webhook Endpoints:** POST/GET `/v1/webhook_endpoints`, GET/DELETE `/{id}`
  - **Test Clocks:** POST/GET `/v1/test_helpers/test_clocks`, GET/DELETE `/{id}`, POST advance
- Request bodies using `application/x-www-form-urlencoded`
- Response schemas matching Stripe object shapes
- Pagination query parameters (`limit`, `starting_after`, `ending_before`)
- Search query parameters (`query`, `limit`)
- Expand query parameter (`expand[]`)
- Error response schema
- Tags grouping endpoints by resource

The spec file will be large (~2000+ lines). Write the complete spec with all endpoints, parameters, and schemas. Each path operation needs: summary, tags, parameters, requestBody (for POST), responses (200 with schema, 400/401/404 error shapes).

Use `$ref` for shared components: pagination params, list response wrapper, search response wrapper, error response, and common Stripe object schemas.

- [ ] **Step 2: Validate the spec**

Run: `cd docs && bunx @redocly/cli lint openapi.json`
Expected: No errors (warnings are acceptable)

- [ ] **Step 3: Commit**

```bash
git add docs/openapi.json
git commit -m "Add OpenAPI 3.1 spec for all Strimulator endpoints"
```

---

### Task 7: Set up Fumadocs OpenAPI integration and generate API docs

**Files:**
- Create: `docs/lib/openapi.ts`
- Create: `docs/components/api-page.tsx`
- Create: `docs/components/api-page.client.tsx`
- Create: `docs/scripts/generate-docs.ts`
- Create: `docs/content/docs/api/meta.json`
- Modify: `docs/components/mdx.tsx` (add APIPage component)

- [ ] **Step 1: Create `docs/lib/openapi.ts`**

```ts
import { createOpenAPI } from 'fumadocs-openapi/server';

export const openapi = createOpenAPI({
  input: ['./openapi.json'],
});
```

- [ ] **Step 2: Create `docs/components/api-page.tsx`**

```tsx
import { openapi } from '@/lib/openapi';
import { createAPIPage } from 'fumadocs-openapi/ui';
import client from './api-page.client';

export const APIPage = createAPIPage(openapi, {
  client,
});
```

- [ ] **Step 3: Create `docs/components/api-page.client.tsx`**

```tsx
'use client';
import { defineClientConfig } from 'fumadocs-openapi/ui/client';

export default defineClientConfig({});
```

- [ ] **Step 4: Modify `docs/components/mdx.tsx` to include APIPage**

```tsx
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { APIPage } from '@/components/api-page';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(): MDXComponents {
  return {
    ...defaultMdxComponents,
    APIPage,
  };
}
```

- [ ] **Step 5: Create `docs/content/docs/api/meta.json`**

```json
{
  "title": "API Reference"
}
```

- [ ] **Step 6: Create `docs/scripts/generate-docs.ts`**

```ts
import { generateFiles } from 'fumadocs-openapi';
import { openapi } from '@/lib/openapi';

void generateFiles({
  input: openapi,
  output: './content/docs/api',
  includeDescription: true,
});
```

- [ ] **Step 7: Generate the API docs**

Run: `cd docs && bun run generate`
Expected: MDX files created in `docs/content/docs/api/` for each resource group

- [ ] **Step 8: Verify the full docs build**

Run: `cd docs && bun run build`
Expected: Build succeeds with all pages — getting started, guides, API reference, architecture

- [ ] **Step 9: Commit**

```bash
git add docs/lib/openapi.ts docs/components/ docs/scripts/ docs/content/docs/api/
git commit -m "Add OpenAPI integration and auto-generated API reference"
```

---

### Task 8: Final verification and dev experience

**Files:**
- Modify: root `README.md` (add link to docs)

- [ ] **Step 1: Start the docs dev server and verify**

Run: `cd docs && bun run dev`
Expected: Dev server starts, visit http://localhost:3000 — verify:
- Landing page renders
- Sidebar shows all sections (Getting Started, Guides, API Reference, Architecture)
- Navigation works between pages
- API reference pages render with interactive parameter tables
- Dark mode toggle works
- Search works

- [ ] **Step 2: Add docs link to root README.md**

Add a "Documentation" link to the header section of the root README.md pointing to the docs.

- [ ] **Step 3: Add `.gitignore` for docs**

Create `docs/.gitignore`:

```
.next/
node_modules/
.source/
```

- [ ] **Step 4: Final commit**

```bash
git add docs/.gitignore README.md
git commit -m "Add docs gitignore and link documentation from README"
```
