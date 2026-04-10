# Webhook Management Dashboard

## Summary

Add a dedicated **Webhooks tab** to the Strimulator dashboard with full endpoint management (create, edit, delete, enable/disable), delivery history (unified log + per-endpoint), one-click retry for failed deliveries, and a "send test event" action with selectable event types. Includes a prerequisite refactor of the dashboard monolith into modular files.

## Part 1: Dashboard Refactor

The current `src/dashboard/server.ts` (~1,530 lines) contains the full SPA inline. Before adding the Webhooks tab, extract it into modular files:

```
src/dashboard/
├── server.ts              # Elysia plugin: mounts API + serves HTML shell
├── api.ts                 # Existing dashboard API endpoints (extended)
├── html/
│   ├── shell.ts           # HTML skeleton: <head>, nav, Pico CSS, script imports
│   ├── tabs/
│   │   ├── activity.ts    # Activity tab markup + Preact components
│   │   ├── resources.ts   # Resources tab markup + Preact components
│   │   ├── actions.ts     # Actions tab markup + Preact components
│   │   └── webhooks.ts    # NEW — Webhooks tab
│   └── components/
│       ├── table.ts       # Reusable table component (used across tabs)
│       └── badge.ts       # Status badge component
```

Each tab file exports a function returning an HTML string (template literal) with its inline Preact components. `shell.ts` assembles them into the full page. This is a mechanical extraction with no behavior changes to existing tabs.

## Part 2: Webhooks Tab UI

### Default View: Endpoint List + Delivery Log

**Top half — Endpoint cards:**
- Each card shows: URL, status (enabled/disabled toggle), enabled events count, delivery success rate
- Edit and Delete buttons per card
- "Create Endpoint" button at the top opens an inline form (fields: URL, enabled events multi-select)

**Bottom half — Unified delivery log:**
- Table columns: event type, endpoint URL (truncated), status (delivered/pending/failed), attempts, timestamp
- Filterable by endpoint via dropdown
- Failed deliveries get a "Retry" button inline

### Drill-Down View: Endpoint Detail

Activated by clicking an endpoint card. Shows:
- **Header:** Full URL, status toggle, secret (hidden by default, click to reveal + copy), enabled events list
- **Edit form:** Inline editing for URL and enabled_events
- **Delivery history:** Same table format as unified log, pre-filtered to this endpoint
- **Send Test Event:** Button with event type dropdown (common types: customer.created, invoice.paid, payment_intent.succeeded, charge.succeeded, subscription.created, etc.)
- **Back button** to return to default view

All navigation is client-side Preact state, no page reloads.

## Part 3: New Dashboard API Endpoints

Added to `api.ts` under `/dashboard/api/`:

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/webhooks` | Create endpoint (url, enabled_events) |
| PATCH | `/webhooks/:id` | Update endpoint (url, enabled_events, status) |
| DELETE | `/webhooks/:id` | Delete endpoint |
| GET | `/webhooks/:id/deliveries` | Delivery history for one endpoint (paginated) |
| GET | `/deliveries` | Unified delivery log (paginated, optional `endpoint_id` filter) |
| POST | `/webhooks/:id/test` | Send test event to endpoint (accepts `event_type`) |
| POST | `/deliveries/:id/retry` | Retry a specific failed delivery |

Dashboard API routes call existing services directly (WebhookEndpointService, WebhookDeliveryService, EventService). Not auth-protected, consistent with existing dashboard pattern.

## Part 4: Backend Additions

### WebhookEndpointService.update(id, params)

New method accepting partial updates: `url`, `enabled_events`, `status` (enable/disable). Updates DB columns and rebuilds the stored `data` JSON. Emits `webhook_endpoint.updated` event.

### WebhookDeliveryService new methods

- `listByEndpoint(endpointId, opts)` — paginated delivery history for one endpoint
- `listAll(opts)` — paginated delivery log with optional `endpointId` filter
- `retry(deliveryId)` — re-fetch original event and endpoint, re-attempt delivery, update delivery record

These methods query `webhook_deliveries` joined with `events` (for type) and `webhook_endpoints` (for URL). Returns enough data for the dashboard table without separate lookups.

### Test event flow

`POST /dashboard/api/webhooks/:id/test` handler:
1. Builds a minimal Stripe object for the selected event type (e.g., stub `customer` for `customer.created`)
2. Calls `EventService.emit()` — stores the event and triggers normal delivery pipeline
3. Delivery pipeline handles matching, signing, posting

No special "test" flag — flows through the same code path as real events.

## Part 5: Testing Strategy

### Unit tests

- `WebhookEndpointService.update()` — URL/events/status changes persist, data JSON rebuilt correctly, returns updated Stripe object
- `WebhookDeliveryService.listByEndpoint()` / `listAll()` — pagination, endpoint filtering, correct join data
- `WebhookDeliveryService.retry()` — re-delivery attempt, status update on success/failure

### Integration tests

- CRUD lifecycle: create endpoint via dashboard API, update, verify, delete
- Delivery log: create endpoint, trigger event, verify delivery in unified and per-endpoint logs
- Test event: send test event, verify event created and delivery attempted
- Retry: trigger delivery to dead endpoint (fails), retry after fix, verify status change

### No UI/E2E tests

Dashboard is a dev tool — Preact components are thin API wrappers. Testing the API layer provides the real confidence.
