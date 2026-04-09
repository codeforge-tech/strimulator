import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { getRawSqlite } from "../db";
import { globalBus } from "../lib/event-bus";
import { PaymentIntentService } from "../services/payment-intents";
import { ChargeService } from "../services/charges";
import { PaymentMethodService } from "../services/payment-methods";
import { TestClockService } from "../services/test-clocks";
import { EventService } from "../services/events";
import { WebhookEndpointService } from "../services/webhook-endpoints";
import { WebhookDeliveryService } from "../services/webhook-delivery";
import { SubscriptionService } from "../services/subscriptions";
import { InvoiceService } from "../services/invoices";
import { PriceService } from "../services/prices";
import { StripeError } from "../errors";

// In-memory flag: set to an error code to make the next PaymentIntent confirm fail
export const actionFlags = {
  failNextPayment: null as string | null,
};

const RESOURCE_TYPES: Record<string, string> = {
  customers: "customers",
  products: "products",
  prices: "prices",
  payment_intents: "payment_intents",
  payment_methods: "payment_methods",
  charges: "charges",
  refunds: "refunds",
  setup_intents: "setup_intents",
  subscriptions: "subscriptions",
  invoices: "invoices",
  events: "events",
  webhook_endpoints: "webhook_endpoints",
  test_clocks: "test_clocks",
};

interface RequestLogEntry {
  method: string;
  path: string;
  status?: number;
  timestamp: number;
}

const requestLog: RequestLogEntry[] = [];
const MAX_LOG_SIZE = 100;

// Subscribe to the globalBus "request" channel to capture incoming requests
globalBus.on("request", (entry: RequestLogEntry) => {
  requestLog.unshift(entry);
  if (requestLog.length > MAX_LOG_SIZE) {
    requestLog.splice(MAX_LOG_SIZE);
  }
});

function countTable(sqlite: import("bun:sqlite").Database, tableName: string): number {
  try {
    const row = sqlite.query(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number } | null;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export function dashboardApi(db: StrimulatorDB) {
  const sqlite = getRawSqlite(db);

  return new Elysia({ prefix: "/dashboard/api" })
    .get("/stats", () => {
      return {
        customers: countTable(sqlite, "customers"),
        payment_intents: countTable(sqlite, "payment_intents"),
        subscriptions: countTable(sqlite, "subscriptions"),
        invoices: countTable(sqlite, "invoices"),
        events: countTable(sqlite, "events"),
        webhook_endpoints: countTable(sqlite, "webhook_endpoints"),
      };
    })

    .get("/requests", () => {
      return requestLog;
    })

    .get("/resources/:type", ({ params, query }) => {
      const tableName = RESOURCE_TYPES[params.type];
      if (!tableName) {
        return new Response(JSON.stringify({ error: "Unknown resource type" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const limit = Math.min(parseInt(String(query.limit ?? "20"), 10) || 20, 200);
      const offset = parseInt(String(query.offset ?? "0"), 10) || 0;
      try {
        const rows = sqlite
          .query(`SELECT data FROM ${tableName} ORDER BY created DESC LIMIT ? OFFSET ?`)
          .all(limit, offset) as { data: string }[];
        const totalRow = sqlite
          .query(`SELECT COUNT(*) as count FROM ${tableName}`)
          .get() as { count: number } | null;
        const total = totalRow?.count ?? 0;
        return {
          data: rows.map((r) => JSON.parse(r.data)),
          total,
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

    .get("/resources/:type/:id", ({ params }) => {
      const tableName = RESOURCE_TYPES[params.type];
      if (!tableName) {
        return new Response(JSON.stringify({ error: "Unknown resource type" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const row = sqlite
          .query(`SELECT data FROM ${tableName} WHERE id = ?`)
          .get(params.id) as { data: string } | null;
        if (!row) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return JSON.parse(row.data);
      } catch {
        return new Response(JSON.stringify({ error: "Query failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    })

    .get("/stream", () => {
      let unsubscribeRequest: (() => void) | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const sendEvent = (data: unknown) => {
            const payload = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          };

          // Send initial ping
          sendEvent({ type: "connected" });

          // Subscribe to globalBus for live updates
          unsubscribeRequest = globalBus.on("request", (entry) => {
            sendEvent({ type: "request", payload: entry });
          });
        },
        cancel() {
          unsubscribeRequest?.();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    })

    // --- Action endpoints ---

    .post("/actions/fail-next-payment", async ({ request }) => {
      let body: { error_code?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        // ignore parse errors — use defaults
      }
      actionFlags.failNextPayment = body.error_code ?? "card_declined";
      return { ok: true, error_code: actionFlags.failNextPayment };
    })

    .post("/actions/advance-clock", async ({ request }) => {
      let body: { clock_id?: string; frozen_time?: number } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.clock_id || body.frozen_time === undefined) {
        return new Response(JSON.stringify({ error: "clock_id and frozen_time are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const testClockService = new TestClockService(db);
        const updated = testClockService.advance(body.clock_id, body.frozen_time);
        return { ok: true, test_clock: updated };
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

    .post("/actions/retry-webhook", async ({ request }) => {
      let body: { event_id?: string; endpoint_id?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.event_id || !body.endpoint_id) {
        return new Response(JSON.stringify({ error: "event_id and endpoint_id are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const eventService = new EventService(db);
        const endpointService = new WebhookEndpointService(db);
        const deliveryService = new WebhookDeliveryService(db, endpointService);

        const event = eventService.retrieve(body.event_id);
        // Verify endpoint exists
        endpointService.retrieve(body.endpoint_id);

        const endpoint = endpointService.listAll().find((ep) => ep.id === body.endpoint_id);
        if (!endpoint) {
          return new Response(JSON.stringify({ error: "Endpoint not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Re-deliver
        await deliveryService.deliver(event);
        return { ok: true };
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

    .post("/actions/expire-payment-intent", async ({ request }) => {
      let body: { payment_intent_id?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.payment_intent_id) {
        return new Response(JSON.stringify({ error: "payment_intent_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const chargeService = new ChargeService(db);
        const paymentMethodService = new PaymentMethodService(db);
        const piService = new PaymentIntentService(db, chargeService, paymentMethodService);
        const canceled = piService.cancel(body.payment_intent_id, {
          cancellation_reason: "expired",
        });
        return { ok: true, payment_intent: canceled };
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

    .post("/actions/cycle-subscription", async ({ request }) => {
      let body: { subscription_id?: string } = {};
      try {
        const text = await request.text();
        if (text) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.subscription_id) {
        return new Response(JSON.stringify({ error: "subscription_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const invoiceService = new InvoiceService(db);
        const priceService = new PriceService(db);
        const subService = new SubscriptionService(db, invoiceService, priceService);

        const sub = subService.retrieve(body.subscription_id);
        if (!sub) {
          return new Response(JSON.stringify({ error: "Subscription not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Advance the billing period by the current period length
        const subAny = sub as any;
        const periodLength = subAny.current_period_end - subAny.current_period_start;
        const newPeriodStart = subAny.current_period_end;
        const newPeriodEnd = newPeriodStart + periodLength;

        // Update the subscription data in the DB
        const updated = {
          ...sub,
          current_period_start: newPeriodStart,
          current_period_end: newPeriodEnd,
        };

        sqlite.query(
          `UPDATE subscriptions SET data = ?, currentPeriodStart = ?, currentPeriodEnd = ? WHERE id = ?`
        ).run(JSON.stringify(updated), newPeriodStart, newPeriodEnd, body.subscription_id);

        // Create a new invoice for this billing cycle
        const invoice = invoiceService.create({
          customer: sub.customer as string,
          subscription: body.subscription_id,
          currency: sub.currency,
          amount_due: 0, // no amounts tracked yet; billing_reason signals cycle
        });

        return { ok: true, subscription: updated, invoice };
      } catch (err) {
        if (err instanceof StripeError) {
          return new Response(JSON.stringify(err.body), {
            status: err.statusCode,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw err;
      }
    });
}
