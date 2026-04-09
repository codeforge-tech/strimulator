import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { dashboardApi } from "./api";

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Strimulator Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    :root { --pico-font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat-card { text-align: center; padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
    .stat-card h3 { margin: 0; font-size: 2rem; }
    .stat-card small { color: var(--pico-muted-color); }
    .request-log { max-height: 60vh; overflow-y: auto; }
    .request-item { display: flex; gap: 1rem; padding: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color); font-family: monospace; font-size: 0.85rem; }
    .method { font-weight: bold; min-width: 60px; }
    .status-2xx { color: green; } .status-4xx { color: orange; } .status-5xx { color: red; }

    /* Tab navigation */
    .tab-nav { display: flex; gap: 0; border-bottom: 2px solid var(--pico-muted-border-color); margin-bottom: 1.5rem; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; padding: 0.5rem 1.25rem; cursor: pointer; font-size: 0.95rem; color: var(--pico-muted-color); }
    .tab-btn.active { color: var(--pico-primary); border-bottom-color: var(--pico-primary); font-weight: bold; }
    .tab-btn:hover:not(.active) { color: var(--pico-color); }

    /* Resource Explorer */
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

    // ── static config ─────────────────────────────────────────────────────────

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

    // Key field shown as last column per resource type
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

    // ── components ────────────────────────────────────────────────────────────

    function StatCard({ label, value }) {
      return html\`
        <div class="stat-card">
          <h3>\${value}</h3>
          <small>\${label}</small>
        </div>
      \`;
    }

    // ── Activity Tab ──────────────────────────────────────────────────────────

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

    // ── Resources Tab ─────────────────────────────────────────────────────────

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
          const res = await fetch(\`/dashboard/api/resources/\${type}?limit=\${limit}&offset=\${off}\`);
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

    // ── Actions Tab ───────────────────────────────────────────────────────────

    function ActionCard({ title, children }) {
      return html\`
        <article style="margin-bottom:1.5rem">
          <header><strong>\${title}</strong></header>
          \${children}
        </article>
      \`;
    }

    function useAction(url) {
      const [status, setStatus] = useState(null); // null | 'ok' | 'error'
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
      // Fail Next Payment state
      const [errorCode, setErrorCode] = useState('card_declined');
      const failAction = useAction('/dashboard/api/actions/fail-next-payment');

      // Advance Clock state
      const [clockId, setClockId] = useState('');
      const [frozenTime, setFrozenTime] = useState('');
      const clockAction = useAction('/dashboard/api/actions/advance-clock');

      // Retry Webhook state
      const [eventId, setEventId] = useState('');
      const [endpointId, setEndpointId] = useState('');
      const retryAction = useAction('/dashboard/api/actions/retry-webhook');

      // Expire PI state
      const [piId, setPiId] = useState('');
      const expireAction = useAction('/dashboard/api/actions/expire-payment-intent');

      // Cycle Subscription state
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

    // ── App ───────────────────────────────────────────────────────────────────

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

export function dashboardServer(db: StrimulatorDB) {
  return new Elysia()
    .use(dashboardApi(db))
    .get("/dashboard", () => {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    })
    .get("/dashboard/*", () => {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
}
