export const WEBHOOKS_TAB = `
    // ── Webhooks Tab ──────────────────────────────────────────────────────────

    const TEST_EVENT_TYPES = [
      'customer.created', 'customer.updated', 'customer.deleted',
      'invoice.created', 'invoice.paid', 'invoice.payment_failed',
      'payment_intent.succeeded', 'payment_intent.payment_failed',
      'charge.succeeded', 'charge.failed',
      'subscription.created', 'subscription.updated', 'subscription.deleted',
    ];

    function DeliveryStatusBadge({ status }) {
      return html\`<span class=\${'wh-badge wh-badge-' + status}>\${status}</span>\`;
    }

    function DeliveryTable({ deliveries, onRetry }) {
      if (!deliveries || deliveries.length === 0) {
        return html\`<p class="no-data">No deliveries yet.</p>\`;
      }
      return html\`
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
            \${deliveries.map(d => html\`
              <tr key=\${d.id}>
                <td>\${d.event_type ?? '—'}</td>
                <td title=\${d.endpoint_url ?? ''}>\${d.endpoint_url ?? d.endpoint_id ?? '—'}</td>
                <td><\${DeliveryStatusBadge} status=\${d.status ?? 'pending'} /></td>
                <td>\${d.attempts ?? 0}</td>
                <td>\${formatDate(d.created)}</td>
                <td>
                  \${d.status === 'failed' ? html\`
                    <button class="wh-retry-btn" onClick=\${() => onRetry && onRetry(d.id)}>Retry</button>
                  \` : null}
                </td>
              </tr>
            \`)}
          </tbody>
        </table>
      \`;
    }

    function EndpointDetail({ endpoint, onBack, onUpdate }) {
      const [showSecret, setShowSecret] = useState(false);
      const [editUrl, setEditUrl] = useState(endpoint.url ?? '');
      const [editEvents, setEditEvents] = useState((endpoint.enabled_events ?? []).join(', '));
      const [editing, setEditing] = useState(false);
      const [saving, setSaving] = useState(false);
      const [deliveries, setDeliveries] = useState([]);
      const [delTotal, setDelTotal] = useState(0);
      const [delOffset, setDelOffset] = useState(0);
      const [testType, setTestType] = useState(TEST_EVENT_TYPES[0]);
      const [testLoading, setTestLoading] = useState(false);
      const [testMsg, setTestMsg] = useState('');
      const delLimit = 20;

      async function loadDeliveries(off) {
        try {
          const res = await fetch(\`/dashboard/api/webhooks/\${endpoint.id}/deliveries?limit=\${delLimit}&offset=\${off}\`);
          const data = await res.json();
          setDeliveries(data.data ?? []);
          setDelTotal(data.total ?? 0);
        } catch (e) {
          console.error('Failed to load deliveries', e);
        }
      }

      useEffect(() => {
        loadDeliveries(0);
      }, [endpoint.id]);

      async function toggleStatus() {
        const newStatus = endpoint.status === 'enabled' ? 'disabled' : 'enabled';
        try {
          const res = await fetch(\`/dashboard/api/webhooks/\${endpoint.id}\`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });
          if (res.ok) {
            const updated = await res.json();
            onUpdate && onUpdate(updated);
          }
        } catch (e) {
          console.error('Failed to toggle status', e);
        }
      }

      async function saveEdit() {
        setSaving(true);
        try {
          const events = editEvents.split(',').map(s => s.trim()).filter(Boolean);
          const res = await fetch(\`/dashboard/api/webhooks/\${endpoint.id}\`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: editUrl, enabled_events: events }),
          });
          if (res.ok) {
            const updated = await res.json();
            onUpdate && onUpdate(updated);
            setEditing(false);
          }
        } catch (e) {
          console.error('Failed to save', e);
        } finally {
          setSaving(false);
        }
      }

      async function sendTest() {
        setTestLoading(true);
        setTestMsg('');
        try {
          const res = await fetch(\`/dashboard/api/webhooks/\${endpoint.id}/test\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type: testType }),
          });
          const data = await res.json();
          if (res.ok) {
            setTestMsg('Test event sent: ' + (data.event_id ?? 'ok'));
            loadDeliveries(delOffset);
          } else {
            setTestMsg('Error: ' + (data.error ?? JSON.stringify(data)));
          }
        } catch (e) {
          setTestMsg('Request failed: ' + e.message);
        } finally {
          setTestLoading(false);
        }
      }

      async function retryDelivery(deliveryId) {
        try {
          const res = await fetch(\`/dashboard/api/deliveries/\${deliveryId}/retry\`, { method: 'POST' });
          if (res.ok) {
            loadDeliveries(delOffset);
          }
        } catch (e) {
          console.error('Retry failed', e);
        }
      }

      function copySecret() {
        if (endpoint.secret) {
          navigator.clipboard.writeText(endpoint.secret);
        }
      }

      function goDelPage(off) {
        setDelOffset(off);
        loadDeliveries(off);
      }

      return html\`
        <div>
          <div class="wh-detail-header">
            <button onClick=\${onBack}>Back</button>
            <h3 style="margin:0">\${endpoint.url}</h3>
            <\${DeliveryStatusBadge} status=\${endpoint.status ?? 'enabled'} />
            <button onClick=\${toggleStatus}>
              \${endpoint.status === 'enabled' ? 'Disable' : 'Enable'}
            </button>
          </div>

          <div class="wh-secret">
            <strong>Secret:</strong>
            <code>\${showSecret ? (endpoint.secret ?? '—') : '••••••••••••'}</code>
            <button style="padding:0.2rem 0.5rem;font-size:0.8rem" onClick=\${() => setShowSecret(!showSecret)}>
              \${showSecret ? 'Hide' : 'Reveal'}
            </button>
            <button style="padding:0.2rem 0.5rem;font-size:0.8rem" onClick=\${copySecret}>Copy</button>
          </div>

          <div class="wh-events-list">
            <strong>Enabled events:</strong> \${(endpoint.enabled_events ?? []).join(', ') || '*'}
          </div>

          <div style="margin-top:1rem">
            \${!editing ? html\`
              <button onClick=\${() => setEditing(true)} style="font-size:0.85rem">Edit Endpoint</button>
            \` : html\`
              <div class="wh-form">
                <label>URL<input type="text" value=\${editUrl} onInput=\${(e) => setEditUrl(e.target.value)} /></label>
                <label>Enabled events (comma-separated)<input type="text" value=\${editEvents} onInput=\${(e) => setEditEvents(e.target.value)} /></label>
                <div style="display:flex;gap:0.5rem">
                  <button aria-busy=\${saving} onClick=\${saveEdit}>Save</button>
                  <button class="secondary" onClick=\${() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            \`}
          </div>

          <h4 style="margin-top:1.5rem">Send Test Event</h4>
          <div class="wh-test-row">
            <select value=\${testType} onChange=\${(e) => setTestType(e.target.value)}>
              \${TEST_EVENT_TYPES.map(t => html\`<option key=\${t} value=\${t}>\${t}</option>\`)}
            </select>
            <button aria-busy=\${testLoading} onClick=\${sendTest}>Send</button>
          </div>
          \${testMsg ? html\`<p style="font-size:0.85rem;color:var(--pico-muted-color)">\${testMsg}</p>\` : null}

          <h4 style="margin-top:1.5rem">Delivery History</h4>
          <\${DeliveryTable} deliveries=\${deliveries} onRetry=\${retryDelivery} />

          \${delTotal > delLimit ? html\`
            <div class="pagination">
              <button disabled=\${delOffset === 0} onClick=\${() => goDelPage(Math.max(0, delOffset - delLimit))}>Prev</button>
              <span>\${delOffset + 1}–\${Math.min(delOffset + delLimit, delTotal)} of \${delTotal}</span>
              <button disabled=\${delOffset + delLimit >= delTotal} onClick=\${() => goDelPage(delOffset + delLimit)}>Next</button>
            </div>
          \` : null}
        </div>
      \`;
    }

    function WebhooksTab() {
      const [endpoints, setEndpoints] = useState([]);
      const [loading, setLoading] = useState(true);
      const [showCreate, setShowCreate] = useState(false);
      const [newUrl, setNewUrl] = useState('');
      const [newEvents, setNewEvents] = useState('*');
      const [creating, setCreating] = useState(false);
      const [selectedEp, setSelectedEp] = useState(null);

      // Unified delivery log state
      const [deliveries, setDeliveries] = useState([]);
      const [delTotal, setDelTotal] = useState(0);
      const [delOffset, setDelOffset] = useState(0);
      const [filterEndpoint, setFilterEndpoint] = useState('');
      const delLimit = 20;

      async function loadEndpoints() {
        try {
          const res = await fetch(\`/dashboard/api/resources/webhook_endpoints?limit=200&offset=0\`);
          const data = await res.json();
          setEndpoints(data.data ?? []);
        } catch (e) {
          console.error('Failed to load endpoints', e);
        } finally {
          setLoading(false);
        }
      }

      async function loadDeliveries(off, epId) {
        try {
          let url = \`/dashboard/api/deliveries?limit=\${delLimit}&offset=\${off}\`;
          if (epId) url += \`&endpoint_id=\${epId}\`;
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

      async function createEndpoint() {
        setCreating(true);
        try {
          const events = newEvents.split(',').map(s => s.trim()).filter(Boolean);
          const res = await fetch('/dashboard/api/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: newUrl, enabled_events: events }),
          });
          if (res.ok) {
            setNewUrl('');
            setNewEvents('*');
            setShowCreate(false);
            loadEndpoints();
          }
        } catch (e) {
          console.error('Failed to create endpoint', e);
        } finally {
          setCreating(false);
        }
      }

      async function deleteEndpoint(id) {
        try {
          const res = await fetch(\`/dashboard/api/webhooks/\${id}\`, { method: 'DELETE' });
          if (res.ok) {
            loadEndpoints();
          }
        } catch (e) {
          console.error('Failed to delete endpoint', e);
        }
      }

      async function retryDelivery(deliveryId) {
        try {
          const res = await fetch(\`/dashboard/api/deliveries/\${deliveryId}/retry\`, { method: 'POST' });
          if (res.ok) {
            loadDeliveries(delOffset, filterEndpoint);
          }
        } catch (e) {
          console.error('Retry failed', e);
        }
      }

      function onFilterChange(epId) {
        setFilterEndpoint(epId);
        setDelOffset(0);
        loadDeliveries(0, epId);
      }

      function goDelPage(off) {
        setDelOffset(off);
        loadDeliveries(off, filterEndpoint);
      }

      function handleManage(ep) {
        setSelectedEp(ep);
      }

      function handleBack() {
        setSelectedEp(null);
        loadEndpoints();
        loadDeliveries(delOffset, filterEndpoint);
      }

      function handleEndpointUpdate(updated) {
        setSelectedEp(updated);
        loadEndpoints();
      }

      // Detail view
      if (selectedEp) {
        return html\`<\${EndpointDetail} endpoint=\${selectedEp} onBack=\${handleBack} onUpdate=\${handleEndpointUpdate} />\`;
      }

      return html\`
        <div>
          <div class="wh-header">
            <h2 style="margin:0">Webhooks</h2>
            <button onClick=\${() => setShowCreate(!showCreate)}>
              \${showCreate ? 'Cancel' : '+ New Endpoint'}
            </button>
          </div>

          \${showCreate ? html\`
            <div class="wh-form">
              <label>URL<input type="text" placeholder="https://example.com/webhook" value=\${newUrl} onInput=\${(e) => setNewUrl(e.target.value)} /></label>
              <label>Enabled events (comma-separated, default *)<input type="text" placeholder="*" value=\${newEvents} onInput=\${(e) => setNewEvents(e.target.value)} /></label>
              <button aria-busy=\${creating} onClick=\${createEndpoint}>Create Endpoint</button>
            </div>
          \` : null}

          \${loading ? html\`<p>Loading...</p>\` : endpoints.length === 0 ? html\`
            <p class="no-data">No webhook endpoints configured.</p>
          \` : html\`
            <div class="wh-cards">
              \${endpoints.map(ep => html\`
                <div class="wh-card" key=\${ep.id}>
                  <div class="url">\${ep.url}</div>
                  <div class="meta">
                    <\${DeliveryStatusBadge} status=\${ep.status ?? 'enabled'} />
                    <span>\${(ep.enabled_events ?? []).length} event(s)</span>
                  </div>
                  <div class="actions">
                    <button onClick=\${() => handleManage(ep)}>Manage</button>
                    <button class="secondary" onClick=\${() => deleteEndpoint(ep.id)}>Delete</button>
                  </div>
                </div>
              \`)}
            </div>
          \`}

          <h3 style="margin-top:2rem">Delivery Log</h3>
          <div class="wh-filter-row">
            <select value=\${filterEndpoint} onChange=\${(e) => onFilterChange(e.target.value)}>
              <option value="">All endpoints</option>
              \${endpoints.map(ep => html\`<option key=\${ep.id} value=\${ep.id}>\${ep.url}</option>\`)}
            </select>
          </div>

          <\${DeliveryTable} deliveries=\${deliveries} onRetry=\${retryDelivery} />

          \${delTotal > delLimit ? html\`
            <div class="pagination">
              <button disabled=\${delOffset === 0} onClick=\${() => goDelPage(Math.max(0, delOffset - delLimit))}>Prev</button>
              <span>\${delOffset + 1}–\${Math.min(delOffset + delLimit, delTotal)} of \${delTotal}</span>
              <button disabled=\${delOffset + delLimit >= delTotal} onClick=\${() => goDelPage(delOffset + delLimit)}>Next</button>
            </div>
          \` : null}
        </div>
      \`;
    }
`;
