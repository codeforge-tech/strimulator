import { Elysia } from "elysia";
import type { StrimulatorDB } from "../db";
import { dashboardApi } from "./api";
import { DASHBOARD_HTML } from "./html/shell";

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
