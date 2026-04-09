import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { productRoutes } from "../../src/routes/products";
import { apiKeyAuth } from "../../src/middleware/api-key-auth";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia()
    .use(apiKeyAuth)
    .use(productRoutes(db));
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

describe("Product Routes Integration", () => {
  describe("POST /v1/products", () => {
    it("creates a product and returns correct shape", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=My+Product",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.id).toMatch(/^prod_/);
      expect(body.object).toBe("product");
      expect(body.name).toBe("My Product");
      expect(body.active).toBe(true);
      expect(body.livemode).toBe(false);
    });

    it("creates a product with metadata", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=Meta+Product&metadata%5Bcategory%5D=software",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.metadata).toEqual({ category: "software" });
    });

    it("returns 400 when name is missing", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 401 without auth header", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "name=Test",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET /v1/products/:id", () => {
    it("retrieves a product by ID", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=Retrievable+Product",
        }),
      );
      const created = await jsonResponse(createRes);

      const getRes = await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(getRes.status).toBe(200);
      const body = await jsonResponse(getRes);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe("Retrievable Product");
    });

    it("returns 404 for nonexistent product", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/products/prod_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
      const body = await jsonResponse(res);
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("POST /v1/products/:id (update)", () => {
    it("updates a product's name", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=Old+Name",
        }),
      );
      const created = await jsonResponse(createRes);

      const updateRes = await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=New+Name",
        }),
      );

      expect(updateRes.status).toBe(200);
      const body = await jsonResponse(updateRes);
      expect(body.name).toBe("New Name");
    });

    it("updates active to false via form string", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=Active+Product",
        }),
      );
      const created = await jsonResponse(createRes);

      const updateRes = await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
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
  });

  describe("DELETE /v1/products/:id", () => {
    it("deletes a product", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=To+Delete",
        }),
      );
      const created = await jsonResponse(createRes);

      const deleteRes = await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
          method: "DELETE",
          headers: AUTH_HEADER,
        }),
      );

      expect(deleteRes.status).toBe(200);
      const body = await jsonResponse(deleteRes);
      expect(body.id).toBe(created.id);
      expect(body.deleted).toBe(true);
      expect(body.object).toBe("product");
    });

    it("returns 404 after deletion on retrieve", async () => {
      const app = createTestApp();

      const createRes = await app.handle(
        new Request("http://localhost/v1/products", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "name=Gone",
        }),
      );
      const created = await jsonResponse(createRes);

      await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
          method: "DELETE",
          headers: AUTH_HEADER,
        }),
      );

      const getRes = await app.handle(
        new Request(`http://localhost/v1/products/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );
      expect(getRes.status).toBe(404);
    });
  });

  describe("GET /v1/products", () => {
    it("lists products", async () => {
      const app = createTestApp();

      for (const name of ["Prod A", "Prod B", "Prod C"]) {
        await app.handle(
          new Request("http://localhost/v1/products", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `name=${encodeURIComponent(name)}`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/products", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(3);
      expect(body.has_more).toBe(false);
      expect(body.url).toBe("/v1/products");
    });

    it("paginates with limit", async () => {
      const app = createTestApp();

      for (let i = 0; i < 5; i++) {
        await app.handle(
          new Request("http://localhost/v1/products", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `name=Product+${i}`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/products?limit=2", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.data.length).toBe(2);
      expect(body.has_more).toBe(true);
    });

    it("paginates with starting_after", async () => {
      const app = createTestApp();

      for (let i = 0; i < 3; i++) {
        await app.handle(
          new Request("http://localhost/v1/products", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `name=Page+${i}`,
          }),
        );
      }

      const page1Res = await app.handle(
        new Request("http://localhost/v1/products?limit=2", {
          headers: AUTH_HEADER,
        }),
      );
      const page1 = await jsonResponse(page1Res);
      expect(page1.data.length).toBe(2);
      const lastId = page1.data[page1.data.length - 1].id;

      const page2Res = await app.handle(
        new Request(`http://localhost/v1/products?limit=2&starting_after=${lastId}`, {
          headers: AUTH_HEADER,
        }),
      );
      const page2 = await jsonResponse(page2Res);
      expect(page2.has_more).toBe(false);
    });
  });
});
