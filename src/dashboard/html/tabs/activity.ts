export const ACTIVITY_TAB = `
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
`;
