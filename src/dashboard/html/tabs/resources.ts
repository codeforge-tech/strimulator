export const RESOURCES_TAB = `
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
`;
