import Elysia from "elysia";
import { globalBus } from "../lib/event-bus";

export const requestLogger = new Elysia({ name: "request-logger" }).derive(
  { as: "global" },
  ({ request }) => {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/v1/")) {
      globalBus.emit("request", {
        method: request.method,
        path: url.pathname,
        timestamp: Date.now(),
      });
    }

    return {};
  },
);
