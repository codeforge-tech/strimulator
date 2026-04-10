# Webhook Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Webhooks tab to the Strimulator dashboard with endpoint management (CRUD, enable/disable), delivery history (unified + per-endpoint), one-click retry, and send-test-event, preceded by a modular refactor of the dashboard HTML.

**Architecture:** The inline SPA in `server.ts` gets split into modular files under `src/dashboard/html/` — each tab exports a JS string constant that the shell assembles. New backend methods (`WebhookEndpointService.update`, `WebhookDeliveryService.deliverToEndpoint`) support the dashboard API, which gets new endpoints for webhook CRUD, delivery listing, test events, and retry. The Webhooks tab is a new Preact component rendered client-side.

**Tech Stack:** Elysia, Drizzle ORM (bun:sqlite), Preact + HTM (inline, via ESM CDN), Pico CSS, bun:test

---

## File Structure

**New files:**
- `src/dashboard/html/shell.ts` — HTML skeleton + App component assembly
- `src/dashboard/html/styles.ts` — All CSS (extracted + webhook additions)
- `src/dashboard/html/helpers.ts` — Shared JS helpers (statusClass, formatTime, formatDate)
- `src/dashboard/html/tabs/activity.ts` — StatCard + ActivityTab components
- `src/dashboard/html/tabs/resources.ts` — Config constants + ResourcesTab component
- `src/dashboard/html/tabs/actions.ts` — ActionCard + useAction + ActionsTab components
- `src/dashboard/html/tabs/webhooks.ts` — WebhooksTab + sub-components
- `tests/unit/services/webhook-endpoints.test.ts` — Tests for update method
- `tests/integration/webhook-dashboard.test.ts` — Dashboard API integration tests

**Modified files:**
- `src/dashboard/server.ts` — Replace inline HTML with import from shell.ts
- `src/dashboard/api.ts` — Add webhook CRUD, delivery listing, test event, retry endpoints
- `src/services/webhook-endpoints.ts` — Add `update()` method + `UpdateWebhookEndpointParams` interface
- `src/services/webhook-delivery.ts` — Extract `deliverToEndpoint()` from `deliver()`

---

### Task 1: Extract dashboard HTML into modular files

**Files:**
- Create: `src/dashboard/html/styles.ts`
- Create: `src/dashboard/html/helpers.ts`
- Create: `src/dashboard/html/tabs/activity.ts`
- Create: `src/dashboard/html/tabs/resources.ts`
- Create: `src/dashboard/html/tabs/actions.ts`
- Create: `src/dashboard/html/shell.ts`
- Modify: `src/dashboard/server.ts`

- [ ] **Step 1: Create `src/dashboard/html/styles.ts`**

Extract the CSS from the `<style>` block in `server.ts`:

```typescript
export const dashboardStyles = `
    :root { --pico-font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat-card { text-align: center; padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
    .stat-card h3 { margin: 0; font-size: 2rem; }
    .stat-card small { color: var(--pico-muted-color); }
    .request-log { max-height: 60vh; overflow-y: auto; }
    .request-item { display: flex; gap: 1rem; padding: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color); font-family: monospace; font-size: 0.85rem; }
    .method { font-weight: bold; min-width: 60px; }
    .status-2xx { color: green; } .status-4xx { color: orange; } .status-5xx { color: red; }
    .tab-nav { display: flex; gap: 0; border-bottom: 2px solid var(--pico-muted-border-color); margin-bottom: 1.5rem; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; padding: 0.5rem 1.25rem; cursor: pointer; font-size: 0.95rem; color: var(--pico-muted-color); }
    .tab-btn.active { color: var(--pico-primary); border-bottom-color: var(--pico-primary); font-weight: bold; }
    .tab-btn:hover:not(.active) { color: var(--pico-color); }
    .resource-layout { display: flex; gap: 1.5rem; align-items: flex-start; }
    .resource-sidebar { min-width: 200px; max-width: 220px; flex-shrink: 0; }
    .resource-sidebar ul { list-style: none; padding: 0; margin: 0; }
    .resource-sidebar li { padding: 0.4rem 0.75rem; cursor: pointer; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
    .resource-sidebar li:hover { background: var(--pico-muted-background); }
    .resource-sidebar li.active { background: var(--pico-primary-background); color: var(--pico-primary); font-weight: bold; }
    .resource-sidebar .badge { font-size: 0.75rem; color: var(--pico-muted-color); }
    .resource-sidebar li.active .badge { color: var(--pico-primary-hover); }
    .resource-main { flex: 1; min-width: 0; }
    .resource-table-wrap { overflow-x: auto; }
    .resource-table-wrap table { width: 100%; }
    .resource-table-wrap td, .resource-table-wrap th { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
    .row-clickable { cursor: pointer; }
    .row-clickable:hover td { background: var(--pico-muted-background); }
    .detail-panel { margin-top: 1rem; }
    .detail-panel pre { background: var(--pico-code-background, #1e1e2e); color: var(--pico-code-color, #cdd6f4); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; max-height: 60vh; }
    .pagination { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
    .no-data { color: var(--pico-muted-color); font-style: italic; padding: 1rem 0; }
`;
```

- [ ] **Step 2: Create `src/dashboard/html/helpers.ts`**

Extract the shared JS helper functions:

```typescript
export const dashboardHelpers = `
    function statusClass(status) {
      if (!status) return '';
      if (status >= 500) return 'status-5xx';
      if (status >= 400) return 'status-4xx';
      return 'status-2xx';
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString();
    }

    function formatDate(ts) {
      if (!ts) return '—';
      return new Date(ts * 1000).toLocaleString();
    }
`;
```

- [ ] **Step 3: Create `src/dashboard/html/tabs/activity.ts`**

Extract StatCard and ActivityTab components:

```typescript
export const activityTabJs = `
    function StatCard({ label, value }) {
      return html\`
        <div class="stat-card">
          <h3>\${value}</h3>
          <small>\${label}</small>
        </div>
      \`;
    }

    function ActivityTab({ stats, requests }) {
      const statLabels = [
        ['customers', 'Customers'],
        ['payment_intents', 'Payment Intents'],
        ['subscriptions', 'Subscriptions'],
        ['invoices', 'Invoices'],
        ['events', 'Events'],
        ['webhook_endpoints', 'Webhook Endpoints'],
      ];

      return html\`
        <div>
          <h2>Stats</h2>
          <div class="stats">
            \${stats
              ? statLabels.map(([key, label]) => html\`<\${StatCard} key=\${key} label=\${label} value=\${stats[key]} />\`)
              : html\`<p>Loading stats...</p>\`
            }
          </div>

          <h2>Recent Requests</h2>
          <div class="request-log">
            \${requests.length === 0
              ? html\`<p><em>No requests yet.</em></p>\`
              : requests.map((req, i) => html\`
                <div class="request-item" key=\${i}>
                  <span class="method">\${req.method}</span>
                  <span class="path">\${req.path}</span>
                  \${req.status ? html\`<span class=\${statusClass(req.status)}>\${req.status}</span>\` : null}
                  <span class="time">\${formatTime(req.timestamp)}</span>
                </div>
              \`)
            }
          </div>
        </div>
      \`;
    }
`;
```

- [ ] **Step 4: Create `src/dashboard/html/tabs/resources.ts`**

Extract RESOURCE_TYPES config, KEY_FIELD mappings, and ResourcesTab component:

```typescript
export const resourcesTabJs = `
    const RESOURCE_TYPES = [
      { key: 'customers',        label: 'Customers' },
      { key: 'products',         label: 'Products' },
      { key: 'prices',           label: 'Prices' },
      { key: 'payment_intents',  label: 'Payment Intents' },
      { key: 'payment_methods',  label: 'Payment Methods' },
      { key: 'charges',          label: 'Charges' },
      { key: 'refunds',          label: 'Refunds' },
      { key: 'setup_intents',    label: 'Setup Intents' },
      { key: 'subscriptions',    label: 'Subscriptions' },
      { key: 'invoices',         label: 'Invoices' },
      { key: 'events',           label: 'Events' },
      { key: 'webhook_endpoints',label: 'Webhook Endpoints' },
      { key: 'test_clocks',      label: 'Test Clocks' },
    ];

    const KEY_FIELD = {
      customers:        (r) => r.email ?? '—',
      products:         (r) => r.name ?? '—',
      prices:           (r) => r.unit_amount != null ? (r.unit_amount / 100).toFixed(2) + ' ' + (r.currency ?? '').toUpperCase() : '—',
      payment_intents:  (r) => r.amount != null ? (r.amount / 100).toFixed(2) + ' ' + (r.currency ?? '').toUpperCase() : '—',
      payment_methods:  (r) => r.type ?? '—',
      charges:          (r) => r.amount != null ? (r.amount / 100).toFixed(2) + ' ' + (r.currency ?? '').toUpperCase() : '—',
      refunds:          (r) => r.amount != null ? (r.amount / 100).toFixed(2) + ' ' + (r.currency ?? '').toUpperCase() : '—',
      setup_intents:    (r) => r.payment_method ?? '—',
      subscriptions:    (r) => r.customer ?? '—',
      invoices:         (r) => r.amount_due != null ? (r.amount_due / 100).toFixed(2) + ' ' + (r.currency ?? '').toUpperCase() : '—',
      events:           (r) => r.type ?? '—',
      webhook_endpoints:(r) => r.url ?? '—',
      test_clocks:      (r) => r.name ?? '—',
    };

    const KEY_FIELD_LABEL = {
      customers:        'Email',
      products:         'Name',
      prices:           'Amount',
      payment_intents:  'Amount',
      payment_methods:  'Type',
      charges:          'Amount',
      refunds:          'Amount',
      setup_intents:    'Payment Method',
      subscriptions:    'Customer',
      invoices:         'Amount Due',
      events:           'Event Type',
      webhook_endpoints:'URL',
      test_clocks:      'Name',
    };

    function ResourcesTab({ stats }) {
      const [selectedType, setSelectedType] = useState('customers');
      const [resources, setResources] = useState(null);
      const [total, setTotal]     = useState(0);
      const [offset, setOffset]   = useState(0);
      const [selectedRow, setSelectedRow] = useState(null);
      const limit = 20;

      async function loadResources(type, off) {
        setResources(null);
        setSelectedRow(null);
        try {
          const res = await fetch(\\\`/dashboard/api/resources/\\\${type}?limit=\\\${limit}&offset=\\\${off}\\\`);
          const data = await res.json();
          setResources(data.data ?? []);
          setTotal(data.total ?? 0);
        } catch (e) {
          console.error('Failed to fetch resources', e);
          setResources([]);
        }
      }

      useEffect(() => {
        setOffset(0);
        loadResources(selectedType, 0);
      }, [selectedType]);

      function selectType(key) {
        setSelectedType(key);
      }

      function goPage(newOffset) {
        setOffset(newOffset);
        loadResources(selectedType, newOffset);
      }

      const keyFn    = KEY_FIELD[selectedType] ?? (() => '—');
      const keyLabel = KEY_FIELD_LABEL[selectedType] ?? 'Key';

      const hasStatus = resources && resources.length > 0 && resources.some(r => r.status != null);

      return html\`
        <div class="resource-layout">
          <aside class="resource-sidebar">
            <ul>
              \${RESOURCE_TYPES.map(({ key, label }) => html\`
                <li
                  key=\${key}
                  class=\${selectedType === key ? 'active' : ''}
                  onClick=\${() => selectType(key)}
                >
                  <span>\${label}</span>
                  <span class="badge">\${stats ? (stats[key] ?? 0) : '…'}</span>
                </li>
              \`)}
            </ul>
          </aside>

          <div class="resource-main">
            <h3 style="margin-top:0">\${RESOURCE_TYPES.find(t => t.key === selectedType)?.label ?? ''}</h3>

            \${resources === null
              ? html\`<p>Loading...</p>\`
              : resources.length === 0
                ? html\`<p class="no-data">No records found.</p>\`
                : html\`
                  <div class="resource-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          \${hasStatus ? html\`<th>Status</th>\` : null}
                          <th>Created</th>
                          <th>\${keyLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        \${resources.map((r, i) => html\`
                          <tr
                            key=\${r.id ?? i}
                            class="row-clickable"
                            onClick=\${() => setSelectedRow(selectedRow?.id === r.id ? null : r)}
                          >
                            <td>\${r.id ?? '—'}</td>
                            \${hasStatus ? html\`<td>\${r.status ?? '—'}</td>\` : null}
                            <td>\${formatDate(r.created)}</td>
                            <td>\${keyFn(r)}</td>
                          </tr>
                        \`)}
                      </tbody>
                    </table>
                  </div>

                  <div class="pagination">
                    <button
                      disabled=\${offset === 0}
                      onClick=\${() => goPage(Math.max(0, offset - limit))}
                    >← Prev</button>
                    <span>\${offset + 1}–\${Math.min(offset + limit, total)} of \${total}</span>
                    <button
                      disabled=\${offset + limit >= total}
                      onClick=\${() => goPage(offset + limit)}
                    >Next →</button>
                  </div>
                \`
            }

            \${selectedRow ? html\`
              <div class="detail-panel">
                <strong>Detail: \${selectedRow.id}</strong>
                <pre>\${JSON.stringify(selectedRow, null, 2)}</pre>
              </div>
            \` : null}
          </div>
        </div>
      \`;
    }
`;
```

**Important note on escaping:** The ResourcesTab uses template literal interpolation for `fetch()` URLs (e.g., `` `/dashboard/api/resources/${type}` ``). Since this JS lives inside a template literal string exported from TypeScript, the inner backticks need triple escaping: `\\\`` for the backtick and `\\\${` for the interpolation. The other tabs use `html\`` which only needs single escaping because `html` is a tagged template, not a string interpolation. Verify the output looks correct in the browser.

- [ ] **Step 5: Create `src/dashboard/html/tabs/actions.ts`**

Extract ActionCard, useAction, StatusMsg, and ActionsTab components:

```typescript
export const actionsTabJs = `
    function ActionCard({ title, children }) {
      return html\`
        <article style="margin-bottom:1.5rem">
          <header><strong>\${title}</strong></header>
          \${children}
        </article>
      \`;
    }

    function useAction(url) {
      const [status, setStatus] = useState(null);
      const [message, setMessage] = useState('');
      const [loading, setLoading] = useState(false);

      async function run(body) {
        setLoading(true);
        setStatus(null);
        setMessage('');
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.ok) {
            setStatus('ok');
            setMessage('Success: ' + JSON.stringify(data));
          } else {
            setStatus('error');
            setMessage('Error: ' + (data?.error?.message ?? data?.error ?? JSON.stringify(data)));
          }
        } catch (e) {
          setStatus('error');
          setMessage('Request failed: ' + e.message);
        } finally {
          setLoading(false);
        }
      }

      return { run, status, message, loading };
    }

    function ActionsTab() {
      const [errorCode, setErrorCode] = useState('card_declined');
      const failAction = useAction('/dashboard/api/actions/fail-next-payment');

      const [clockId, setClockId] = useState('');
      const [frozenTime, setFrozenTime] = useState('');
      const clockAction = useAction('/dashboard/api/actions/advance-clock');

      const [eventId, setEventId] = useState('');
      const [endpointId, setEndpointId] = useState('');
      const retryAction = useAction('/dashboard/api/actions/retry-webhook');

      const [piId, setPiId] = useState('');
      const expireAction = useAction('/dashboard/api/actions/expire-payment-intent');

      const [subId, setSubId] = useState('');
      const cycleAction = useAction('/dashboard/api/actions/cycle-subscription');

      function StatusMsg({ action }) {
        if (!action.status) return null;
        const color = action.status === 'ok' ? 'green' : 'red';
        return html\`<p style="color:\${color};word-break:break-all;font-size:0.85rem;margin-top:0.5rem">\${action.message}</p>\`;
      }

      return html\`
        <div>
          <h2>Actions</h2>
          <p style="color:var(--pico-muted-color)">Trigger simulated scenarios to test your integration.</p>

          <\${ActionCard} title="Fail Next Payment">
            <p style="color:var(--pico-muted-color);font-size:0.9rem">Sets a flag so the next PaymentIntent confirm will fail with the chosen error code.</p>
            <label>
              Error code
              <select value=\${errorCode} onChange=\${(e) => setErrorCode(e.target.value)}>
                <option value="card_declined">card_declined</option>
                <option value="insufficient_funds">insufficient_funds</option>
                <option value="expired_card">expired_card</option>
              </select>
            </label>
            <button
              aria-busy=\${failAction.loading}
              onClick=\${() => failAction.run({ error_code: errorCode })}
            >Set Fail Flag</button>
            <\${StatusMsg} action=\${failAction} />
          </\${ActionCard}>

          <\${ActionCard} title="Advance Test Clock">
            <p style="color:var(--pico-muted-color);font-size:0.9rem">Move a test clock forward to a new frozen_time (Unix timestamp).</p>
            <label>Clock ID<input type="text" placeholder="clock_..." value=\${clockId} onInput=\${(e) => setClockId(e.target.value)} /></label>
            <label>New frozen_time (Unix seconds)<input type="number" placeholder="e.g. 1750000000" value=\${frozenTime} onInput=\${(e) => setFrozenTime(e.target.value)} /></label>
            <button
              aria-busy=\${clockAction.loading}
              onClick=\${() => clockAction.run({ clock_id: clockId, frozen_time: parseInt(frozenTime, 10) })}
            >Advance Clock</button>
            <\${StatusMsg} action=\${clockAction} />
          </\${ActionCard}>

          <\${ActionCard} title="Retry Webhook">
            <p style="color:var(--pico-muted-color);font-size:0.9rem">Re-deliver an event to a webhook endpoint.</p>
            <label>Event ID<input type="text" placeholder="evt_..." value=\${eventId} onInput=\${(e) => setEventId(e.target.value)} /></label>
            <label>Endpoint ID<input type="text" placeholder="we_..." value=\${endpointId} onInput=\${(e) => setEndpointId(e.target.value)} /></label>
            <button
              aria-busy=\${retryAction.loading}
              onClick=\${() => retryAction.run({ event_id: eventId, endpoint_id: endpointId })}
            >Retry Webhook</button>
            <\${StatusMsg} action=\${retryAction} />
          </\${ActionCard}>

          <\${ActionCard} title="Expire Payment Intent">
            <p style="color:var(--pico-muted-color);font-size:0.9rem">Force a PaymentIntent into canceled status.</p>
            <label>Payment Intent ID<input type="text" placeholder="pi_..." value=\${piId} onInput=\${(e) => setPiId(e.target.value)} /></label>
            <button
              aria-busy=\${expireAction.loading}
              onClick=\${() => expireAction.run({ payment_intent_id: piId })}
            >Expire PI</button>
            <\${StatusMsg} action=\${expireAction} />
          </\${ActionCard}>

          <\${ActionCard} title="Cycle Subscription">
            <p style="color:var(--pico-muted-color);font-size:0.9rem">Advance a subscription to its next billing period and create a new invoice.</p>
            <label>Subscription ID<input type="text" placeholder="sub_..." value=\${subId} onInput=\${(e) => setSubId(e.target.value)} /></label>
            <button
              aria-busy=\${cycleAction.loading}
              onClick=\${() => cycleAction.run({ subscription_id: subId })}
            >Cycle Subscription</button>
            <\${StatusMsg} action=\${cycleAction} />
          </\${ActionCard}>
        </div>
      \`;
    }
`;
```

- [ ] **Step 6: Create `src/dashboard/html/shell.ts`**

Assemble all modules into the full HTML page, including the App component:

```typescript
import { dashboardStyles } from "./styles";
import { dashboardHelpers } from "./helpers";
import { activityTabJs } from "./tabs/activity";
import { resourcesTabJs } from "./tabs/resources";
import { actionsTabJs } from "./tabs/actions";

export function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Strimulator Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
${dashboardStyles}
  </style>
</head>
<body>
  <nav class="container"><strong>Strimulator</strong> <small>Local Stripe Emulator</small></nav>
  <main class="container" id="app">Loading...</main>
  <script type="module">
    import { h, render } from 'https://esm.sh/preact@10';
    import { useState, useEffect } from 'https://esm.sh/preact@10/hooks';
    import htm from 'https://esm.sh/htm@3';

    const html = htm.bind(h);

    // ── helpers ──────────────────────────────────────────────────────────────
${dashboardHelpers}

    // ── Activity Tab ────────────────────────────────────────────────────────
${activityTabJs}

    // ── Resources Tab ───────────────────────────────────────────────────────
${resourcesTabJs}

    // ── Actions Tab ─────────────────────────────────────────────────────────
${actionsTabJs}

    // ── App ─────────────────────────────────────────────────────────────────

    function App() {
      const [tab, setTab]           = useState('activity');
      const [stats, setStats]       = useState(null);
      const [requests, setRequests] = useState([]);

      async function fetchStats() {
        try {
          const res = await fetch('/dashboard/api/stats');
          const data = await res.json();
          setStats(data);
        } catch (e) {
          console.error('Failed to fetch stats', e);
        }
      }

      async function fetchRequests() {
        try {
          const res = await fetch('/dashboard/api/requests');
          const data = await res.json();
          setRequests(data);
        } catch (e) {
          console.error('Failed to fetch requests', e);
        }
      }

      useEffect(() => {
        fetchStats();
        fetchRequests();

        const es = new EventSource('/dashboard/api/stream');
        es.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'request') {
              setRequests(prev => [msg.payload, ...prev].slice(0, 100));
              fetchStats();
            }
          } catch (e) {}
        };
        es.onerror = () => {};
        return () => es.close();
      }, []);

      const TABS = [
        { key: 'activity',  label: 'Activity' },
        { key: 'resources', label: 'Resources' },
        { key: 'actions',   label: 'Actions' },
      ];

      return html\`
        <div>
          <nav class="tab-nav">
            \${TABS.map(({ key, label }) => html\`
              <button
                key=\${key}
                class=\${'tab-btn' + (tab === key ? ' active' : '')}
                onClick=\${() => setTab(key)}
              >\${label}</button>
            \`)}
          </nav>

          \${tab === 'activity'  ? html\`<\${ActivityTab}  stats=\${stats} requests=\${requests} />\` : null}
          \${tab === 'resources' ? html\`<\${ResourcesTab} stats=\${stats} />\` : null}
          \${tab === 'actions'   ? html\`<\${ActionsTab} />\` : null}
        </div>
      \`;
    }

    render(html\`<\${App} />\`, document.getElementById('app'));
  </script>
</body>
</html>`;
}
```

- [ ] **Step 7: Update `src/dashboard/server.ts` to use shell**

Replace the inline `DASHBOARD_HTML` with the shell function:

```typescript
import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { dashboardApi } from "./api";
import { buildDashboardHtml } from "./html/shell";

export function dashboardServer(db: StrimulatorDB) {
  const dashboardHtml = buildDashboardHtml();

  return new Elysia()
    .use(dashboardApi(db))
    .get("/dashboard", () => {
      return new Response(dashboardHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    })
    .get("/dashboard/*", () => {
      return new Response(dashboardHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
}
```

- [ ] **Step 8: Verify the refactor produces identical behavior**

Run: `bun run dev`

Open `http://localhost:12111/dashboard` and verify:
- Activity tab loads with stats and request log
- Resources tab shows sidebar with counts, table loads for each resource type
- Actions tab shows all 5 action cards
- SSE streaming still works (make an API request and see it appear in real-time)

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/html/ src/dashboard/server.ts
git commit -m "Refactor dashboard HTML into modular files"
```

---

### Task 2: Add WebhookEndpointService.update()

**Files:**
- Test: `tests/unit/services/webhook-endpoints.test.ts`
- Modify: `src/services/webhook-endpoints.ts`

- [ ] **Step 1: Write failing test for update**

Create `tests/unit/services/webhook-endpoints.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { WebhookEndpointService } from "../../../src/services/webhook-endpoints";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new WebhookEndpointService(db);
}

describe("WebhookEndpointService", () => {
  describe("update", () => {
    it("updates the url", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://old.example.com/hook", enabled_events: ["*"] });

      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });

      expect(updated.url).toBe("https://new.example.com/hook");
      expect(updated.id).toBe(ep.id);
      // Verify persistence
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.url).toBe("https://new.example.com/hook");
    });

    it("updates enabled_events", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });

      const updated = svc.update(ep.id, { enabled_events: ["customer.created", "invoice.paid"] });

      expect(updated.enabled_events).toEqual(["customer.created", "invoice.paid"]);
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.enabled_events).toEqual(["customer.created", "invoice.paid"]);
    });

    it("updates status to disabled", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["*"] });

      const updated = svc.update(ep.id, { status: "disabled" });

      expect(updated.status).toBe("disabled");
      const retrieved = svc.retrieve(ep.id);
      expect(retrieved.status).toBe("disabled");
    });

    it("preserves unchanged fields", () => {
      const svc = makeService();
      const ep = svc.create({ url: "https://example.com/hook", enabled_events: ["customer.created"] });

      const updated = svc.update(ep.id, { url: "https://new.example.com/hook" });

      expect(updated.enabled_events).toEqual(["customer.created"]);
      expect(updated.secret).toBe(ep.secret);
      expect(updated.created).toBe(ep.created);
    });

    it("throws 404 for nonexistent endpoint", () => {
      const svc = makeService();

      expect(() => svc.update("we_nonexistent", { url: "https://example.com" })).toThrow();
      try {
        svc.update("we_nonexistent", { url: "https://example.com" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/services/webhook-endpoints.test.ts`

Expected: FAIL — `svc.update is not a function`

- [ ] **Step 3: Implement update method**

Add to `src/services/webhook-endpoints.ts`:

After `CreateWebhookEndpointParams`, add the new interface:

```typescript
export interface UpdateWebhookEndpointParams {
  url?: string;
  enabled_events?: string[];
  status?: string;
}
```

Add the `update` method to `WebhookEndpointService`:

```typescript
  update(id: string, params: UpdateWebhookEndpointParams): Stripe.WebhookEndpoint {
    const existing = this.retrieve(id);

    const updated: Record<string, unknown> = { ...existing };
    const dbUpdates: Record<string, unknown> = {};

    if (params.url !== undefined) {
      updated.url = params.url;
      dbUpdates.url = params.url;
    }
    if (params.enabled_events !== undefined) {
      updated.enabled_events = params.enabled_events;
      dbUpdates.enabledEvents = JSON.stringify(params.enabled_events);
    }
    if (params.status !== undefined) {
      updated.status = params.status;
      dbUpdates.status = params.status;
    }

    dbUpdates.data = JSON.stringify(updated);

    this.db.update(webhookEndpoints)
      .set(dbUpdates)
      .where(eq(webhookEndpoints.id, id))
      .run();

    return updated as unknown as Stripe.WebhookEndpoint;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/services/webhook-endpoints.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/webhook-endpoints.ts tests/unit/services/webhook-endpoints.test.ts
git commit -m "Add WebhookEndpointService.update() with tests"
```

---

### Task 3: Extract WebhookDeliveryService.deliverToEndpoint()

**Files:**
- Modify: `tests/unit/services/webhook-delivery.test.ts`
- Modify: `src/services/webhook-delivery.ts`

- [ ] **Step 1: Write failing test for deliverToEndpoint**

Add a new `describe` block to `tests/unit/services/webhook-delivery.test.ts`:

```typescript
  describe("deliverToEndpoint", () => {
    it("creates a delivery record for the specific endpoint", async () => {
      const { db, endpointService, deliveryService } = makeServices();
      const { getRawSqlite } = await import("../../../src/db");
      const sqlite = getRawSqlite(db);

      const endpoint = endpointService.create({
        url: "https://example.com/webhook",
        enabled_events: ["*"],
      });

      const event = {
        id: "evt_test123",
        object: "event" as const,
        type: "customer.created",
        data: { object: { id: "cus_123" } },
        api_version: "2024-12-18",
        created: 1700000000,
        livemode: false,
        pending_webhooks: 0,
        request: { id: null, idempotency_key: null },
      } as any;

      const deliveryId = await deliveryService.deliverToEndpoint(event, {
        id: endpoint.id,
        url: endpoint.url,
        secret: endpoint.secret!,
      });

      expect(deliveryId).toMatch(/^whdel_/);

      // Verify delivery record was created
      const row = sqlite.query("SELECT * FROM webhook_deliveries WHERE id = ?").get(deliveryId) as any;
      expect(row).not.toBeNull();
      expect(row.event_id).toBe("evt_test123");
      expect(row.endpoint_id).toBe(endpoint.id);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/services/webhook-delivery.test.ts`

Expected: FAIL — `deliveryService.deliverToEndpoint is not a function`

- [ ] **Step 3: Extract deliverToEndpoint from deliver**

Modify `src/services/webhook-delivery.ts`. Replace the `deliver` method with a public `deliverToEndpoint` method and update `deliver` to use it:

```typescript
  async deliverToEndpoint(
    event: Stripe.Event,
    endpoint: { id: string; url: string; secret: string },
  ): Promise<string> {
    const deliveryId = generateId("webhook_delivery");
    const createdAt = now();

    this.db.insert(webhookDeliveries).values({
      id: deliveryId,
      eventId: event.id,
      endpointId: endpoint.id,
      status: "pending",
      attempts: 0,
      nextRetryAt: null,
      created: createdAt,
    }).run();

    this.attemptDelivery(deliveryId, endpoint, event, 0);
    return deliveryId;
  }

  async deliver(event: Stripe.Event): Promise<void> {
    const matchingEndpoints = this.findMatchingEndpoints(event.type);

    for (const endpoint of matchingEndpoints) {
      await this.deliverToEndpoint(event, endpoint);
    }
  }
```

Remove the old `deliver` method body entirely — it's fully replaced by the above.

- [ ] **Step 4: Run all webhook delivery tests**

Run: `bun test tests/unit/services/webhook-delivery.test.ts`

Expected: All tests PASS (existing tests still work because `deliver` delegates to `deliverToEndpoint`)

Also verify the integration tests still pass:

Run: `bun test tests/integration/webhook-delivery.test.ts`

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/webhook-delivery.ts tests/unit/services/webhook-delivery.test.ts
git commit -m "Extract deliverToEndpoint from deliver in WebhookDeliveryService"
```

---

### Task 4: Add dashboard webhook API endpoints

**Files:**
- Modify: `src/dashboard/api.ts`

- [ ] **Step 1: Add webhook CRUD endpoints to api.ts**

Add these routes to the Elysia chain in `dashboardApi`, after the existing action endpoints. Import `WebhookEndpointService` (already imported) and add the CRUD routes:

```typescript
    // --- Webhook management endpoints ---

    .post("/webhooks", async ({ request }) => {
      let body: { url?: string; enabled_events?: string[] } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.url || !body.enabled_events?.length) {
        return new Response(JSON.stringify({ error: "url and enabled_events are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const endpointService = new WebhookEndpointService(db);
        const endpoint = endpointService.create({
          url: body.url,
          enabled_events: body.enabled_events,
        });
        return endpoint;
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    })

    .patch("/webhooks/:id", async ({ params, request }) => {
      let body: { url?: string; enabled_events?: string[]; status?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const endpointService = new WebhookEndpointService(db);
        return endpointService.update(params.id, body);
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    })

    .delete("/webhooks/:id", ({ params }) => {
      try {
        const endpointService = new WebhookEndpointService(db);
        return endpointService.del(params.id);
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    })
```

- [ ] **Step 2: Add delivery listing endpoints**

Continue the Elysia chain:

```typescript
    .get("/deliveries", ({ query }) => {
      const limit = Math.min(parseInt(String(query.limit ?? "20"), 10) || 20, 200);
      const offset = parseInt(String(query.offset ?? "0"), 10) || 0;
      const endpointId = query.endpoint_id as string | undefined;

      try {
        let countSql = "SELECT COUNT(*) as count FROM webhook_deliveries";
        let dataSql = `SELECT
          wd.id, wd.event_id, wd.endpoint_id, wd.status, wd.attempts, wd.next_retry_at, wd.created,
          e.type as event_type,
          we.url as endpoint_url
        FROM webhook_deliveries wd
        LEFT JOIN events e ON e.id = wd.event_id
        LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id`;

        const params: unknown[] = [];
        if (endpointId) {
          countSql += " WHERE endpoint_id = ?";
          dataSql += " WHERE wd.endpoint_id = ?";
          params.push(endpointId);
        }

        dataSql += " ORDER BY wd.created DESC LIMIT ? OFFSET ?";

        const totalRow = sqlite.query(countSql).get(...params) as { count: number } | null;
        const rows = sqlite.query(dataSql).all(...params, limit, offset);

        return {
          data: rows,
          total: totalRow?.count ?? 0,
          limit,
          offset,
        };
      } catch {
        return new Response(JSON.stringify({ error: "Query failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    })

    .get("/webhooks/:id/deliveries", ({ params, query }) => {
      const limit = Math.min(parseInt(String(query.limit ?? "20"), 10) || 20, 200);
      const offset = parseInt(String(query.offset ?? "0"), 10) || 0;

      try {
        const totalRow = sqlite.query(
          "SELECT COUNT(*) as count FROM webhook_deliveries WHERE endpoint_id = ?"
        ).get(params.id) as { count: number } | null;

        const rows = sqlite.query(`SELECT
          wd.id, wd.event_id, wd.endpoint_id, wd.status, wd.attempts, wd.next_retry_at, wd.created,
          e.type as event_type,
          we.url as endpoint_url
        FROM webhook_deliveries wd
        LEFT JOIN events e ON e.id = wd.event_id
        LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id
        WHERE wd.endpoint_id = ?
        ORDER BY wd.created DESC
        LIMIT ? OFFSET ?`).all(params.id, limit, offset);

        return {
          data: rows,
          total: totalRow?.count ?? 0,
          limit,
          offset,
        };
      } catch {
        return new Response(JSON.stringify({ error: "Query failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    })
```

- [ ] **Step 3: Add test event endpoint**

Continue the Elysia chain:

```typescript
    .post("/webhooks/:id/test", async ({ params, request }) => {
      let body: { event_type?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const eventType = body.event_type;
      if (!eventType) {
        return new Response(JSON.stringify({ error: "event_type is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const endpointService = new WebhookEndpointService(db);
        const deliveryService = new WebhookDeliveryService(db, endpointService);
        const eventService = new EventService(db);

        // Verify endpoint exists and get its details
        const endpoint = endpointService.retrieve(params.id);
        const allEndpoints = endpointService.listAll();
        const epData = allEndpoints.find((ep) => ep.id === params.id);
        if (!epData) {
          return new Response(JSON.stringify({ error: "Endpoint not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Build a minimal stub object for the event type
        const [resource] = eventType.split(".");
        const stubObject: Record<string, unknown> = {
          id: `test_${resource}_${Date.now()}`,
          object: resource,
        };

        // Emit the event (persists to DB)
        const event = eventService.emit(eventType, stubObject);

        // Deliver to the specific endpoint
        const deliveryId = await deliveryService.deliverToEndpoint(event, {
          id: epData.id,
          url: epData.url,
          secret: epData.secret,
        });

        return { ok: true, event_id: event.id, delivery_id: deliveryId };
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    })
```

- [ ] **Step 4: Add retry delivery endpoint**

Continue the Elysia chain:

```typescript
    .post("/deliveries/:id/retry", async ({ params }) => {
      try {
        // Look up the delivery record
        const delivery = sqlite.query(
          "SELECT * FROM webhook_deliveries WHERE id = ?"
        ).get(params.id) as { event_id: string; endpoint_id: string } | null;

        if (!delivery) {
          return new Response(JSON.stringify({ error: "Delivery not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const eventService = new EventService(db);
        const endpointService = new WebhookEndpointService(db);
        const deliveryService = new WebhookDeliveryService(db, endpointService);

        const event = eventService.retrieve(delivery.event_id);
        const allEndpoints = endpointService.listAll();
        const epData = allEndpoints.find((ep) => ep.id === delivery.endpoint_id);

        if (!epData) {
          return new Response(JSON.stringify({ error: "Endpoint no longer exists" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const deliveryId = await deliveryService.deliverToEndpoint(event, {
          id: epData.id,
          url: epData.url,
          secret: epData.secret,
        });

        return { ok: true, delivery_id: deliveryId };
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    })
```

- [ ] **Step 5: Add missing imports to api.ts**

At the top of `api.ts`, ensure these imports exist (some are already there):

```typescript
import { EventService } from "../services/events";
import { WebhookEndpointService } from "../services/webhook-endpoints";
import { WebhookDeliveryService } from "../services/webhook-delivery";
```

All three are already imported. No changes needed.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/api.ts
git commit -m "Add dashboard API endpoints for webhook management"
```

---

### Task 5: Build Webhooks tab UI

**Files:**
- Create: `src/dashboard/html/tabs/webhooks.ts`
- Modify: `src/dashboard/html/styles.ts`
- Modify: `src/dashboard/html/shell.ts`

- [ ] **Step 1: Add webhook-specific styles to `src/dashboard/html/styles.ts`**

Append to the `dashboardStyles` string:

```css
    /* Webhooks tab */
    .wh-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .wh-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .wh-card { border: 1px solid var(--pico-muted-border-color); border-radius: 8px; padding: 1rem; }
    .wh-card .url { font-family: monospace; font-size: 0.9rem; word-break: break-all; margin-bottom: 0.5rem; }
    .wh-card .meta { display: flex; gap: 1rem; align-items: center; font-size: 0.8rem; color: var(--pico-muted-color); flex-wrap: wrap; }
    .wh-card .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .wh-card .actions button { padding: 0.25rem 0.75rem; font-size: 0.8rem; }
    .wh-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
    .wh-badge-enabled { background: #d4edda; color: #155724; }
    .wh-badge-disabled { background: #f8d7da; color: #721c24; }
    .wh-badge-delivered { background: #d4edda; color: #155724; }
    .wh-badge-pending { background: #fff3cd; color: #856404; }
    .wh-badge-failed { background: #f8d7da; color: #721c24; }
    .wh-detail-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    .wh-detail-header button { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .wh-secret { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }
    .wh-secret code { font-size: 0.85rem; background: var(--pico-code-background, #1e1e2e); color: var(--pico-code-color, #cdd6f4); padding: 0.2rem 0.5rem; border-radius: 4px; }
    .wh-events-list { font-size: 0.85rem; color: var(--pico-muted-color); }
    .wh-form { margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
    .wh-form label { font-size: 0.9rem; }
    .wh-form input, .wh-form select { font-size: 0.9rem; }
    .wh-delivery-table { width: 100%; }
    .wh-delivery-table td, .wh-delivery-table th { font-size: 0.85rem; padding: 0.4rem 0.5rem; }
    .wh-delivery-table td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
    .wh-retry-btn { padding: 0.15rem 0.5rem; font-size: 0.75rem; }
    .wh-test-row { display: flex; gap: 0.5rem; align-items: end; margin-bottom: 1rem; }
    .wh-test-row select { max-width: 280px; }
    .wh-test-row button { white-space: nowrap; }
    .wh-filter-row { display: flex; gap: 0.5rem; align-items: end; margin-bottom: 1rem; }
    .wh-filter-row select { max-width: 300px; }
```

- [ ] **Step 2: Create `src/dashboard/html/tabs/webhooks.ts`**

```typescript
export const webhooksTabJs = `
    const TEST_EVENT_TYPES = [
      'customer.created', 'customer.updated', 'customer.deleted',
      'invoice.created', 'invoice.paid', 'invoice.payment_failed',
      'payment_intent.succeeded', 'payment_intent.payment_failed',
      'charge.succeeded', 'charge.failed',
      'subscription.created', 'subscription.updated', 'subscription.deleted',
    ];

    function DeliveryStatusBadge({ status }) {
      const cls = 'wh-badge wh-badge-' + (status || 'pending');
      return html\`<span class=\${cls}>\${status}</span>\`;
    }

    function DeliveryTable({ deliveries, onRetry }) {
      if (!deliveries || deliveries.length === 0) {
        return html\`<p class="no-data">No deliveries yet.</p>\`;
      }
      return html\`
        <div class="resource-table-wrap">
          <table class="wh-delivery-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              \${deliveries.map((d) => html\`
                <tr key=\${d.id}>
                  <td>\${d.event_type ?? '—'}</td>
                  <td title=\${d.endpoint_url ?? ''}>\${d.endpoint_url ? d.endpoint_url.replace(/^https?:\\/\\//, '').slice(0, 30) : '—'}</td>
                  <td><\${DeliveryStatusBadge} status=\${d.status} /></td>
                  <td>\${d.attempts}</td>
                  <td>\${formatDate(d.created)}</td>
                  <td>\${d.status === 'failed' ? html\`<button class="wh-retry-btn" onClick=\${() => onRetry(d.id)}>Retry</button>\` : null}</td>
                </tr>
              \`)}
            </tbody>
          </table>
        </div>
      \`;
    }

    function EndpointDetail({ endpoint, onBack, onUpdate }) {
      const [showSecret, setShowSecret] = useState(false);
      const [editUrl, setEditUrl] = useState(endpoint.url);
      const [editEvents, setEditEvents] = useState((endpoint.enabled_events || []).join(', '));
      const [deliveries, setDeliveries] = useState([]);
      const [delTotal, setDelTotal] = useState(0);
      const [delOffset, setDelOffset] = useState(0);
      const [testType, setTestType] = useState(TEST_EVENT_TYPES[0]);
      const [saving, setSaving] = useState(false);
      const [testLoading, setTestLoading] = useState(false);
      const [msg, setMsg] = useState(null);
      const delLimit = 20;

      async function loadDeliveries(off) {
        try {
          const res = await fetch(\\\`/dashboard/api/webhooks/\\\${endpoint.id}/deliveries?limit=\\\${delLimit}&offset=\\\${off}\\\`);
          const data = await res.json();
          setDeliveries(data.data ?? []);
          setDelTotal(data.total ?? 0);
        } catch (e) {
          console.error('Failed to load deliveries', e);
        }
      }

      useEffect(() => { loadDeliveries(0); }, []);

      async function handleSave() {
        setSaving(true);
        setMsg(null);
        try {
          const res = await fetch(\\\`/dashboard/api/webhooks/\\\${endpoint.id}\\\`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: editUrl,
              enabled_events: editEvents.split(',').map(s => s.trim()).filter(Boolean),
            }),
          });
          if (res.ok) {
            const updated = await res.json();
            setMsg({ type: 'ok', text: 'Updated successfully' });
            onUpdate(updated);
          } else {
            const err = await res.json();
            setMsg({ type: 'error', text: err.error?.message ?? err.error ?? 'Update failed' });
          }
        } catch (e) {
          setMsg({ type: 'error', text: e.message });
        } finally {
          setSaving(false);
        }
      }

      async function handleToggleStatus() {
        const newStatus = endpoint.status === 'enabled' ? 'disabled' : 'enabled';
        try {
          const res = await fetch(\\\`/dashboard/api/webhooks/\\\${endpoint.id}\\\`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });
          if (res.ok) {
            const updated = await res.json();
            onUpdate(updated);
          }
        } catch (e) {
          console.error('Toggle failed', e);
        }
      }

      async function handleTestEvent() {
        setTestLoading(true);
        setMsg(null);
        try {
          const res = await fetch(\\\`/dashboard/api/webhooks/\\\${endpoint.id}/test\\\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type: testType }),
          });
          const data = await res.json();
          if (res.ok) {
            setMsg({ type: 'ok', text: 'Test event sent (event: ' + data.event_id + ')' });
            // Reload deliveries after a short delay to show the new one
            setTimeout(() => loadDeliveries(0), 500);
          } else {
            setMsg({ type: 'error', text: data.error?.message ?? data.error ?? 'Failed' });
          }
        } catch (e) {
          setMsg({ type: 'error', text: e.message });
        } finally {
          setTestLoading(false);
        }
      }

      async function handleRetry(deliveryId) {
        try {
          await fetch(\\\`/dashboard/api/deliveries/\\\${deliveryId}/retry\\\`, { method: 'POST' });
          setTimeout(() => loadDeliveries(delOffset), 500);
        } catch (e) {
          console.error('Retry failed', e);
        }
      }

      function delGoPage(newOffset) {
        setDelOffset(newOffset);
        loadDeliveries(newOffset);
      }

      return html\`
        <div>
          <div class="wh-detail-header">
            <button onClick=\${onBack}>← Back</button>
            <h3 style="margin:0">\${endpoint.url}</h3>
            <span class=\${'wh-badge wh-badge-' + (endpoint.status || 'enabled')}>\${endpoint.status}</span>
            <button onClick=\${handleToggleStatus} style="font-size:0.8rem;padding:0.2rem 0.6rem">
              \${endpoint.status === 'enabled' ? 'Disable' : 'Enable'}
            </button>
          </div>

          <div class="wh-secret">
            <strong>Secret:</strong>
            \${showSecret
              ? html\`<code>\${endpoint.secret}</code><button onClick=\${() => { navigator.clipboard.writeText(endpoint.secret); }} style="font-size:0.75rem;padding:0.1rem 0.4rem">Copy</button>\`
              : html\`<code>whsec_••••••••</code>\`
            }
            <button onClick=\${() => setShowSecret(!showSecret)} style="font-size:0.75rem;padding:0.1rem 0.4rem">
              \${showSecret ? 'Hide' : 'Reveal'}
            </button>
          </div>

          <div class="wh-events-list">
            <strong>Events:</strong> \${(endpoint.enabled_events || []).join(', ')}
          </div>

          <hr />

          <h4>Edit Endpoint</h4>
          <div class="wh-form">
            <label>URL<input type="text" value=\${editUrl} onInput=\${(e) => setEditUrl(e.target.value)} /></label>
            <label>Enabled Events (comma-separated)<input type="text" value=\${editEvents} onInput=\${(e) => setEditEvents(e.target.value)} /></label>
            <button aria-busy=\${saving} onClick=\${handleSave}>Save Changes</button>
          </div>

          \${msg ? html\`<p style="color:\${msg.type === 'ok' ? 'green' : 'red'};font-size:0.85rem">\${msg.text}</p>\` : null}

          <h4>Send Test Event</h4>
          <div class="wh-test-row">
            <label style="margin-bottom:0">
              <select value=\${testType} onChange=\${(e) => setTestType(e.target.value)}>
                \${TEST_EVENT_TYPES.map(t => html\`<option key=\${t} value=\${t}>\${t}</option>\`)}
              </select>
            </label>
            <button aria-busy=\${testLoading} onClick=\${handleTestEvent}>Send Test</button>
          </div>

          <h4>Delivery History</h4>
          <\${DeliveryTable} deliveries=\${deliveries} onRetry=\${handleRetry} />
          \${delTotal > delLimit ? html\`
            <div class="pagination">
              <button disabled=\${delOffset === 0} onClick=\${() => delGoPage(Math.max(0, delOffset - delLimit))}>← Prev</button>
              <span>\${delOffset + 1}–\${Math.min(delOffset + delLimit, delTotal)} of \${delTotal}</span>
              <button disabled=\${delOffset + delLimit >= delTotal} onClick=\${() => delGoPage(delOffset + delLimit)}>Next →</button>
            </div>
          \` : null}
        </div>
      \`;
    }

    function WebhooksTab() {
      const [view, setView] = useState('list');
      const [endpoints, setEndpoints] = useState([]);
      const [selectedEndpoint, setSelectedEndpoint] = useState(null);
      const [showCreate, setShowCreate] = useState(false);
      const [createUrl, setCreateUrl] = useState('');
      const [createEvents, setCreateEvents] = useState('*');
      const [creating, setCreating] = useState(false);
      const [deliveries, setDeliveries] = useState([]);
      const [delTotal, setDelTotal] = useState(0);
      const [delOffset, setDelOffset] = useState(0);
      const [filterEndpoint, setFilterEndpoint] = useState('');
      const [msg, setMsg] = useState(null);
      const delLimit = 20;

      async function loadEndpoints() {
        try {
          const res = await fetch('/dashboard/api/resources/webhook_endpoints?limit=200&offset=0');
          const data = await res.json();
          setEndpoints(data.data ?? []);
        } catch (e) {
          console.error('Failed to load endpoints', e);
        }
      }

      async function loadDeliveries(off, epFilter) {
        try {
          let url = \\\`/dashboard/api/deliveries?limit=\\\${delLimit}&offset=\\\${off}\\\`;
          if (epFilter) url += \\\`&endpoint_id=\\\${epFilter}\\\`;
          const res = await fetch(url);
          const data = await res.json();
          setDeliveries(data.data ?? []);
          setDelTotal(data.total ?? 0);
        } catch (e) {
          console.error('Failed to load deliveries', e);
        }
      }

      useEffect(() => {
        loadEndpoints();
        loadDeliveries(0, '');
      }, []);

      async function handleCreate() {
        setCreating(true);
        setMsg(null);
        try {
          const events = createEvents.split(',').map(s => s.trim()).filter(Boolean);
          const res = await fetch('/dashboard/api/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: createUrl, enabled_events: events }),
          });
          if (res.ok) {
            setCreateUrl('');
            setCreateEvents('*');
            setShowCreate(false);
            loadEndpoints();
          } else {
            const err = await res.json();
            setMsg({ type: 'error', text: err.error?.message ?? err.error ?? 'Create failed' });
          }
        } catch (e) {
          setMsg({ type: 'error', text: e.message });
        } finally {
          setCreating(false);
        }
      }

      async function handleDelete(id) {
        try {
          await fetch(\\\`/dashboard/api/webhooks/\\\${id}\\\`, { method: 'DELETE' });
          loadEndpoints();
        } catch (e) {
          console.error('Delete failed', e);
        }
      }

      function openDetail(ep) {
        setSelectedEndpoint(ep);
        setView('detail');
      }

      function handleDetailUpdate(updated) {
        setSelectedEndpoint(updated);
        loadEndpoints();
      }

      async function handleRetry(deliveryId) {
        try {
          await fetch(\\\`/dashboard/api/deliveries/\\\${deliveryId}/retry\\\`, { method: 'POST' });
          setTimeout(() => loadDeliveries(delOffset, filterEndpoint), 500);
        } catch (e) {
          console.error('Retry failed', e);
        }
      }

      function handleFilterChange(epId) {
        setFilterEndpoint(epId);
        setDelOffset(0);
        loadDeliveries(0, epId);
      }

      function delGoPage(newOffset) {
        setDelOffset(newOffset);
        loadDeliveries(newOffset, filterEndpoint);
      }

      if (view === 'detail' && selectedEndpoint) {
        return html\`<\${EndpointDetail}
          endpoint=\${selectedEndpoint}
          onBack=\${() => { setView('list'); loadDeliveries(0, filterEndpoint); }}
          onUpdate=\${handleDetailUpdate}
        />\`;
      }

      return html\`
        <div>
          <div class="wh-header">
            <h2 style="margin:0">Webhook Endpoints</h2>
            <button onClick=\${() => setShowCreate(!showCreate)}>
              \${showCreate ? 'Cancel' : '+ Create Endpoint'}
            </button>
          </div>

          \${showCreate ? html\`
            <div class="wh-form">
              <label>URL<input type="text" placeholder="https://your-app.com/webhook" value=\${createUrl} onInput=\${(e) => setCreateUrl(e.target.value)} /></label>
              <label>Enabled Events (comma-separated, or * for all)<input type="text" value=\${createEvents} onInput=\${(e) => setCreateEvents(e.target.value)} /></label>
              <button aria-busy=\${creating} onClick=\${handleCreate}>Create</button>
            </div>
          \` : null}

          \${msg ? html\`<p style="color:\${msg.type === 'ok' ? 'green' : 'red'};font-size:0.85rem">\${msg.text}</p>\` : null}

          \${endpoints.length === 0
            ? html\`<p class="no-data">No webhook endpoints. Create one to get started.</p>\`
            : html\`
              <div class="wh-cards">
                \${endpoints.map((ep) => html\`
                  <div class="wh-card" key=\${ep.id}>
                    <div class="url">\${ep.url}</div>
                    <div class="meta">
                      <span class=\${'wh-badge wh-badge-' + (ep.status || 'enabled')}>\${ep.status}</span>
                      <span>\${(ep.enabled_events || []).length === 1 && ep.enabled_events[0] === '*' ? 'All events' : (ep.enabled_events || []).length + ' events'}</span>
                    </div>
                    <div class="actions">
                      <button onClick=\${() => openDetail(ep)}>Manage</button>
                      <button class="secondary" onClick=\${() => handleDelete(ep.id)}>Delete</button>
                    </div>
                  </div>
                \`)}
              </div>
            \`
          }

          <hr />

          <h2>Delivery Log</h2>
          <div class="wh-filter-row">
            <label style="margin-bottom:0">
              Filter by endpoint:
              <select value=\${filterEndpoint} onChange=\${(e) => handleFilterChange(e.target.value)}>
                <option value="">All endpoints</option>
                \${endpoints.map((ep) => html\`<option key=\${ep.id} value=\${ep.id}>\${ep.url}</option>\`)}
              </select>
            </label>
          </div>

          <\${DeliveryTable} deliveries=\${deliveries} onRetry=\${handleRetry} />
          \${delTotal > delLimit ? html\`
            <div class="pagination">
              <button disabled=\${delOffset === 0} onClick=\${() => delGoPage(Math.max(0, delOffset - delLimit))}>← Prev</button>
              <span>\${delOffset + 1}–\${Math.min(delOffset + delLimit, delTotal)} of \${delTotal}</span>
              <button disabled=\${delOffset + delLimit >= delTotal} onClick=\${() => delGoPage(delOffset + delLimit)}>Next →</button>
            </div>
          \` : null}
        </div>
      \`;
    }
`;
```

- [ ] **Step 3: Update `src/dashboard/html/shell.ts` to include Webhooks tab**

Add import at the top:

```typescript
import { webhooksTabJs } from "./tabs/webhooks";
```

Add the webhooks tab JS after the actions tab section in the template:

```
    // ── Webhooks Tab ────────────────────────────────────────────────────────
${webhooksTabJs}
```

Update the `TABS` array in the App component:

```javascript
      const TABS = [
        { key: 'activity',  label: 'Activity' },
        { key: 'resources', label: 'Resources' },
        { key: 'webhooks',  label: 'Webhooks' },
        { key: 'actions',   label: 'Actions' },
      ];
```

Add the webhooks tab rendering in the App component, after the resources tab line:

```javascript
          \${tab === 'webhooks'  ? html\`<\${WebhooksTab} />\` : null}
```

- [ ] **Step 4: Verify in browser**

Run: `bun run dev`

Open `http://localhost:12111/dashboard` and verify:
- Webhooks tab appears between Resources and Actions
- Clicking Webhooks shows "No webhook endpoints" message
- Create Endpoint form opens and closes
- Creating an endpoint shows a card
- Clicking Manage opens the detail view with edit form, secret, test event dropdown
- Back button returns to list view
- Delivery log section shows at the bottom with filter dropdown
- Existing tabs still work normally

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/html/
git commit -m "Add Webhooks tab to dashboard with endpoint management and delivery history"
```

---

### Task 6: Integration tests for webhook dashboard API

**Files:**
- Create: `tests/integration/webhook-dashboard.test.ts`

- [ ] **Step 1: Write CRUD integration tests**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;
let baseUrl: string;

beforeEach(() => {
  app = createApp();
  app.listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
});

afterEach(() => {
  app.server?.stop();
});

async function dashPost(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/dashboard/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dashPatch(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/dashboard/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dashDelete(path: string) {
  return fetch(`${baseUrl}/dashboard/api${path}`, { method: "DELETE" });
}

async function dashGet(path: string) {
  return fetch(`${baseUrl}/dashboard/api${path}`);
}

describe("Dashboard Webhook API", () => {
  describe("CRUD", () => {
    test("create, update, and delete a webhook endpoint", async () => {
      // Create
      const createRes = await dashPost("/webhooks", {
        url: "https://example.com/hook",
        enabled_events: ["customer.created"],
      });
      expect(createRes.status).toBe(200);
      const endpoint = await createRes.json();
      expect(endpoint.id).toMatch(/^we_/);
      expect(endpoint.url).toBe("https://example.com/hook");
      expect(endpoint.secret).toMatch(/^whsec_/);

      // Update URL
      const updateRes = await dashPatch(`/webhooks/${endpoint.id}`, {
        url: "https://new.example.com/hook",
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.url).toBe("https://new.example.com/hook");

      // Update status
      const disableRes = await dashPatch(`/webhooks/${endpoint.id}`, {
        status: "disabled",
      });
      expect(disableRes.status).toBe(200);
      const disabled = await disableRes.json();
      expect(disabled.status).toBe("disabled");

      // Delete
      const deleteRes = await dashDelete(`/webhooks/${endpoint.id}`);
      expect(deleteRes.status).toBe(200);
      const deleted = await deleteRes.json();
      expect(deleted.deleted).toBe(true);
    });

    test("returns 400 for missing required fields on create", async () => {
      const res = await dashPost("/webhooks", { url: "https://example.com" });
      expect(res.status).toBe(400);
    });
  });

  describe("Delivery listing", () => {
    test("lists deliveries after event is triggered", async () => {
      // Set up a webhook endpoint via the Stripe API
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe("sk_test_strimulator", {
        host: "localhost",
        port: app.server!.port,
        protocol: "http",
      } as any);

      // Create endpoint (uses Stripe SDK to go through normal route)
      const endpoint = await stripe.webhookEndpoints.create({
        url: "http://localhost:1/nonexistent", // will fail delivery
        enabled_events: ["customer.created"],
      });

      // Create a customer to trigger an event
      await stripe.customers.create({ email: "delivery-test@example.com" });

      // Wait for delivery attempt
      await new Promise((r) => setTimeout(r, 500));

      // Check unified delivery log
      const res = await dashGet("/deliveries");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.length).toBeGreaterThanOrEqual(1);
      expect(data.data[0].event_type).toBe("customer.created");

      // Check per-endpoint delivery log
      const epRes = await dashGet(`/webhooks/${endpoint.id}/deliveries`);
      expect(epRes.status).toBe(200);
      const epData = await epRes.json();
      expect(epData.data.length).toBeGreaterThanOrEqual(1);
      expect(epData.data[0].endpoint_id).toBe(endpoint.id);
    });
  });

  describe("Test event", () => {
    test("sends a test event to a specific endpoint", async () => {
      // Create endpoint
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      // Send test event
      const testRes = await dashPost(`/webhooks/${endpoint.id}/test`, {
        event_type: "customer.created",
      });
      expect(testRes.status).toBe(200);
      const testData = await testRes.json();
      expect(testData.ok).toBe(true);
      expect(testData.event_id).toMatch(/^evt_/);
      expect(testData.delivery_id).toMatch(/^whdel_/);
    });

    test("returns 400 for missing event_type", async () => {
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      const res = await dashPost(`/webhooks/${endpoint.id}/test`, {});
      expect(res.status).toBe(400);
    });
  });

  describe("Retry delivery", () => {
    test("retries a failed delivery", async () => {
      // Create endpoint
      const createRes = await dashPost("/webhooks", {
        url: "http://localhost:1/nonexistent",
        enabled_events: ["*"],
      });
      const endpoint = await createRes.json();

      // Send test event to create a delivery
      const testRes = await dashPost(`/webhooks/${endpoint.id}/test`, {
        event_type: "charge.succeeded",
      });
      const testData = await testRes.json();

      // Wait for delivery to be attempted
      await new Promise((r) => setTimeout(r, 500));

      // Retry the delivery
      const retryRes = await dashPost(`/deliveries/${testData.delivery_id}/retry`);
      expect(retryRes.status).toBe(200);
      const retryData = await retryRes.json();
      expect(retryData.ok).toBe(true);
      expect(retryData.delivery_id).toMatch(/^whdel_/);
      // New delivery ID should be different from original
      expect(retryData.delivery_id).not.toBe(testData.delivery_id);
    });

    test("returns 404 for nonexistent delivery", async () => {
      const res = await dashPost("/deliveries/whdel_nonexistent/retry");
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `bun test tests/integration/webhook-dashboard.test.ts`

Expected: All tests PASS

- [ ] **Step 3: Run the full test suite**

Run: `bun test`

Expected: All tests PASS (existing tests unbroken by refactor)

- [ ] **Step 4: Run type check**

Run: `bun x tsc --noEmit`

Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add tests/integration/webhook-dashboard.test.ts
git commit -m "Add integration tests for webhook dashboard API"
```
