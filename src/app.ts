import { Elysia } from "elysia";

export function createApp() {
  return new Elysia().get("/", () => ({
    object: "api",
    has_more: false,
    url: "/v1",
    livemode: false,
  }));
}
