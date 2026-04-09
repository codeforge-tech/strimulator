import { STYLES } from "./styles";
import { HELPERS } from "./helpers";
import { ACTIVITY_TAB } from "./tabs/activity";
import { RESOURCES_TAB } from "./tabs/resources";
import { ACTIONS_TAB } from "./tabs/actions";
import { WEBHOOKS_TAB } from "./tabs/webhooks";

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Strimulator Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>${STYLES}  </style>
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
${HELPERS}
    // ── components ────────────────────────────────────────────────────────────
${ACTIVITY_TAB}
${RESOURCES_TAB}
${ACTIONS_TAB}
${WEBHOOKS_TAB}
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
        { key: 'webhooks',  label: 'Webhooks' },
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
          \${tab === 'webhooks'  ? html\`<\${WebhooksTab} />\` : null}
          \${tab === 'actions'   ? html\`<\${ActionsTab} />\` : null}
        </div>
      \`;
    }

    render(html\`<\${App} />\`, document.getElementById('app'));
  </script>
</body>
</html>`;
