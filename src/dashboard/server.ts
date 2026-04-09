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

    function statusClass(status) {
      if (!status) return '';
      if (status >= 500) return 'status-5xx';
      if (status >= 400) return 'status-4xx';
      return 'status-2xx';
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString();
    }

    function StatCard({ label, value }) {
      return html\`
        <div class="stat-card">
          <h3>\${value}</h3>
          <small>\${label}</small>
        </div>
      \`;
    }

    function App() {
      const [stats, setStats] = useState(null);
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
        es.onerror = () => {
          // Reconnect automatically handled by EventSource
        };
        return () => es.close();
      }, []);

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
