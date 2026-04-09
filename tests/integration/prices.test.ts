import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { priceRoutes } from "../../src/routes/prices";
import { apiKeyAuth } from "../../src/middleware/api-key-auth";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia()
    .use(apiKeyAuth)
    .use(priceRoutes(db));
}

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };

async function jsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("Price Routes Integration", () => {
  describe("POST /v1/prices", () => {
    it("creates a one_time price and returns correct shape", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=1000",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.id).toMatch(/^price_/);
      expect(body.object).toBe("price");
      expect(body.currency).toBe("usd");
      expect(body.unit_amount).toBe(1000);
      expect(body.type).toBe("one_time");
      expect(body.recurring).toBeNull();
      expect(body.active).toBe(true);
      expect(body.livemode).toBe(false);
      expect(body.product).toBe("prod_test123");
    });

    it("creates a recurring price with monthly interval", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=2000&recurring%5Binterval%5D=month&recurring%5Binterval_count%5D=1",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.type).toBe("recurring");
      expect(body.recurring).not.toBeNull();
      expect(body.recurring.interval).toBe("month");
      expect(body.recurring.interval_count).toBe(1);
      expect(body.recurring.usage_type).toBe("licensed");
    });

    it("creates a recurring price with weekly interval", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test456&currency=eur&unit_amount=500&recurring%5Binterval%5D=week&recurring%5Binterval_count%5D=2",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.type).toBe("recurring");
      expect(body.recurring.interval).toBe("week");
      expect(body.recurring.interval_count).toBe(2);
    });

    it("returns 400 when product is missing", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "currency=usd&unit_amount=1000",
        }),
      );
      expect(res.status).toBe(400);
      const body = await jsonResponse(res);
      expect(body.error.param).toBe("product");
    });

    it("returns 400 when currency is missing", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&unit_amount=1000",
        }),
      );
      expect(res.status).toBe(400);
      const body = await jsonResponse(res);
      expect(body.error.param).toBe("currency");
    });

    it("creates a price with metadata", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=999&metadata%5Bplan%5D=basic",
        }),
      );
      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.metadata).toEqual({ plan: "basic" });
    });

    it("returns 401 without auth header", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "product=prod_test123&currency=usd",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET /v1/prices/:id", () => {
    it("retrieves a price by ID", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=1500",
        }),
      );
      const created = await jsonResponse(createRes);

      const getRes = await app.handle(
        new Request(`http://localhost/v1/prices/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(getRes.status).toBe(200);
      const body = await jsonResponse(getRes);
      expect(body.id).toBe(created.id);
      expect(body.unit_amount).toBe(1500);
    });

    it("returns 404 for nonexistent price", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/prices/price_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
      const body = await jsonResponse(res);
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("POST /v1/prices/:id (update)", () => {
    it("updates active to false", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=1000",
        }),
      );
      const created = await jsonResponse(createRes);

      const updateRes = await app.handle(
        new Request(`http://localhost/v1/prices/${created.id}`, {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "active=false",
        }),
      );

      expect(updateRes.status).toBe(200);
      const body = await jsonResponse(updateRes);
      expect(body.active).toBe(false);
    });

    it("updates nickname", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_test123&currency=usd&unit_amount=1000",
        }),
      );
      const created = await jsonResponse(createRes);

      const updateRes = await app.handle(
        new Request(`http://localhost/v1/prices/${created.id}`, {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "nickname=My+Plan",
        }),
      );

      expect(updateRes.status).toBe(200);
      const body = await jsonResponse(updateRes);
      expect(body.nickname).toBe("My Plan");
    });
  });

  describe("GET /v1/prices", () => {
    it("lists prices", async () => {
      const app = createTestApp();

      for (let i = 0; i < 3; i++) {
        await app.handle(
          new Request("http://localhost/v1/prices", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `product=prod_test123&currency=usd&unit_amount=${(i + 1) * 100}`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/prices", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(3);
      expect(body.has_more).toBe(false);
      expect(body.url).toBe("/v1/prices");
    });

    it("paginates with limit", async () => {
      const app = createTestApp();

      for (let i = 0; i < 5; i++) {
        await app.handle(
          new Request("http://localhost/v1/prices", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `product=prod_test123&currency=usd&unit_amount=${(i + 1) * 100}`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/prices?limit=2", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.data.length).toBe(2);
      expect(body.has_more).toBe(true);
    });

    it("filters by product", async () => {
      const app = createTestApp();

      await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_aaa&currency=usd&unit_amount=1000",
        }),
      );
      await app.handle(
        new Request("http://localhost/v1/prices", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "product=prod_bbb&currency=usd&unit_amount=2000",
        }),
      );

      const res = await app.handle(
        new Request("http://localhost/v1/prices?product=prod_aaa", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.data.length).toBe(1);
      expect(body.data[0].product).toBe("prod_aaa");
    });

    it("paginates with starting_after", async () => {
      const app = createTestApp();

      for (let i = 0; i < 3; i++) {
        await app.handle(
          new Request("http://localhost/v1/prices", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `product=prod_test123&currency=usd&unit_amount=${(i + 1) * 100}`,
          }),
        );
      }

      const page1Res = await app.handle(
        new Request("http://localhost/v1/prices?limit=2", {
          headers: AUTH_HEADER,
        }),
      );
      const page1 = await jsonResponse(page1Res);
      expect(page1.data.length).toBe(2);
      const lastId = page1.data[page1.data.length - 1].id;

      const page2Res = await app.handle(
        new Request(`http://localhost/v1/prices?limit=2&starting_after=${lastId}`, {
          headers: AUTH_HEADER,
        }),
      );
      const page2 = await jsonResponse(page2Res);
      expect(page2.has_more).toBe(false);
    });
  });
});
