# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev              # Start with watch mode
bun run start            # Start once
bun test                 # Run all tests (unit + integration + SDK)
bun test tests/unit/     # Run unit tests only
bun test tests/sdk/      # Run SDK tests only
bun test tests/integration/customers.test.ts  # Run single test file
bun x tsc --noEmit       # Type check
bun run db:generate      # Generate Drizzle migration from schema changes
bun run db:migrate       # Apply migrations
```

## Git conventions

- **No conventional commits.** Do not prefix commit messages or PR titles with `feat:`, `fix:`, `chore:`, etc. Just write a clear description of what changed.

## Architecture

Strimulator emulates Stripe's REST API over HTTP using Elysia (Bun's web framework) + SQLite via Drizzle ORM. It returns real `Stripe.*` types from the official `stripe` npm package.

### Request lifecycle

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

### Service pattern

Services are classes in `src/services/` that take `StrimulatorDB` in the constructor. They own all business logic and return `Stripe.*` types. Each resource has a `build*Shape()` function that constructs the full Stripe object. The full JSON is stored in a `data` text column; key fields are indexed separately for queries.

State machine services (PaymentIntents, Subscriptions, Invoices) validate transitions with `stateTransitionError()` and emit events via an optional `EventService` dependency.

### Route pattern

Routes are Elysia plugin factories in `src/routes/` that take `(db, eventService?)`. They parse form-encoded bodies, call service methods, and emit events. Search endpoints (`GET /search`) must be registered before `GET /:id` to avoid route conflicts.

### Expansion

`src/lib/expand.ts` — Routes that support `?expand[]=field` use `applyExpand()` with a config mapping field names to resolver functions. Supports nested expansion via dot notation (`expand[]=latest_invoice.payment_intent`).

### Event system

`EventService.emit()` persists the event to DB and synchronously notifies listeners. `WebhookDeliveryService` is registered as a listener in `app.ts` and delivers to matching webhook endpoints with HMAC-SHA256 signatures and retry logic.

### Dashboard

`src/dashboard/server.ts` serves a single-page Preact app (inline HTML) at `/dashboard`. The API at `/dashboard/api/` uses raw SQLite queries (via `getRawSqlite()`) for stats and resource browsing. Not auth-protected.

### Test clock billing

`TestClockService.advance()` processes billing cycles for linked subscriptions: rolls periods, creates/finalizes/pays invoices, handles trial-to-active transitions. Subscriptions link to clocks via `test_clock_id`.

### 3DS simulation

Payment methods with last4 `3220` (`tok_threeDSecureRequired`) trigger `requires_action` status on confirm. Re-confirming completes the 3DS challenge and proceeds to charge creation.

## Key conventions

- Stripe body format is `application/x-www-form-urlencoded` with bracket notation (`metadata[key]=value`, `items[0][price]=...`), not JSON. Use `parseStripeBody()`.
- IDs are generated via `generateId(type)` which uses `crypto.randomBytes`. Each type has a prefix (`cus_`, `pi_`, `sub_`, etc.) defined in `src/lib/id-generator.ts`.
- Pagination is cursor-based using `created` timestamp and `starting_after` param.
- Search loads all rows and filters in-memory via `parseSearchQuery()` / `matchesCondition()`.
- Services are synchronous (bun:sqlite is sync). Routes are async only for body parsing and expansion.
- Soft deletes use a `deleted` integer flag (0/1).

## Environment variables

- `STRIMULATOR_PORT` — default `12111`
- `STRIMULATOR_DB_PATH` — default `:memory:`
- `STRIMULATOR_API_VERSION` — default `2024-12-18`
