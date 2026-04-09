import { describe, test, expect } from "bun:test";
import { createApp } from "../../src/app";
import { createDB } from "../../src/db";
import { StripeError } from "../../src/errors";

function buildApp() {
  const db = createDB(":memory:");
  return createApp(db);
}

describe("App integration", () => {
  test("GET / returns api object without auth", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("api");
  });

  test("unauthenticated /v1/ request returns 401", async () => {
    const app = buildApp()
      .get("/v1/customers", () => ({ ok: true }));

    const res = await app.handle(new Request("http://localhost/v1/customers"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  test("authenticated /v1/ request is not 401", async () => {
    const app = buildApp()
      .get("/v1/customers", () => ({ data: [] }));

    const res = await app.handle(
      new Request("http://localhost/v1/customers", {
        headers: { authorization: "Bearer sk_test_valid" },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  test("StripeError thrown from route returns correct shape and status", async () => {
    const app = buildApp()
      .get("/v1/boom", () => {
        throw new StripeError(422, {
          error: {
            type: "invalid_request_error",
            message: "Something is wrong",
            code: "bad_param",
          },
        });
      });

    const res = await app.handle(
      new Request("http://localhost/v1/boom", {
        headers: { authorization: "Bearer sk_test_valid" },
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toBe("Something is wrong");
    expect(body.error.code).toBe("bad_param");
  });

  test("unknown error from route returns 500 api_error shape", async () => {
    const app = buildApp()
      .get("/v1/crash", () => {
        throw new Error("Unexpected boom");
      });

    const res = await app.handle(
      new Request("http://localhost/v1/crash", {
        headers: { authorization: "Bearer sk_test_valid" },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.type).toBe("api_error");
    expect(body.error.message).toBe("An unexpected error occurred.");
  });

  test("createApp uses provided DB instance", async () => {
    const db = createDB(":memory:");
    const app = createApp(db);
    // Verify the db decorator is available on the app
    expect(app.decorator.db).toBe(db);
  });

  test("createApp creates its own DB if none provided", async () => {
    const app = createApp();
    expect(app.decorator.db).toBeDefined();
  });
});
