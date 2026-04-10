export const ACTIONS_TAB = `
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
`;
