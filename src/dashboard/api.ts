import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { getRawSqlite } from "../db";
import { globalBus } from "../lib/event-bus";

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

    .get("/stream", () => {
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
          const unsubscribeRequest = globalBus.on("request", (entry) => {
            sendEvent({ type: "request", payload: entry });
          });

          // Cleanup when stream closes
          // Note: ReadableStream cancel is called when consumer disconnects
          return () => {
            unsubscribeRequest();
          };
        },
        cancel() {
          // Cleanup handled by return value of start
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });
}
