import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { customerRoutes } from "../../src/routes/customers";
import { apiKeyAuth } from "../../src/middleware/api-key-auth";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia()
    .use(apiKeyAuth)
    .use(customerRoutes(db));
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

describe("Customer Routes Integration", () => {
  describe("POST /v1/customers", () => {
    it("creates a customer and returns correct shape", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=test%40example.com&name=Alice",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.id).toMatch(/^cus_/);
      expect(body.object).toBe("customer");
      expect(body.email).toBe("test@example.com");
      expect(body.name).toBe("Alice");
    });

    it("creates a customer with metadata", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=meta%40example.com&metadata%5Bplan%5D=pro",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.metadata).toEqual({ plan: "pro" });
    });

    it("returns 401 without auth header", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET /v1/customers/:id", () => {
    it("retrieves a customer by ID", async () => {
      const app = createTestApp();

      // Create first
      const createRes = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=retrieve%40example.com",
        }),
      );
      const created = await jsonResponse(createRes);

      // Retrieve
      const getRes = await app.handle(
        new Request(`http://localhost/v1/customers/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(getRes.status).toBe(200);
      const body = await jsonResponse(getRes);
      expect(body.id).toBe(created.id);
      expect(body.email).toBe("retrieve@example.com");
    });

    it("returns 404 for nonexistent customer", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/customers/cus_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
      const body = await jsonResponse(res);
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("POST /v1/customers/:id (update)", () => {
    it("updates a customer's email and name", async () => {
      const app = createTestApp();

      // Create
      const createRes = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=old%40example.com&name=Old",
        }),
      );
      const created = await jsonResponse(createRes);

      // Update
      const updateRes = await app.handle(
        new Request(`http://localhost/v1/customers/${created.id}`, {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=new%40example.com&name=New",
        }),
      );

      expect(updateRes.status).toBe(200);
      const body = await jsonResponse(updateRes);
      expect(body.email).toBe("new@example.com");
      expect(body.name).toBe("New");
    });
  });

  describe("DELETE /v1/customers/:id", () => {
    it("deletes a customer", async () => {
      const app = createTestApp();

      // Create
      const createRes = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=todelete%40example.com",
        }),
      );
      const created = await jsonResponse(createRes);

      // Delete
      const deleteRes = await app.handle(
        new Request(`http://localhost/v1/customers/${created.id}`, {
          method: "DELETE",
          headers: AUTH_HEADER,
        }),
      );

      expect(deleteRes.status).toBe(200);
      const body = await jsonResponse(deleteRes);
      expect(body.id).toBe(created.id);
      expect(body.deleted).toBe(true);
      expect(body.object).toBe("customer");
    });

    it("returns 404 after deletion", async () => {
      const app = createTestApp();

      // Create and delete
      const createRes = await app.handle(
        new Request("http://localhost/v1/customers", {
          method: "POST",
          headers: {
            ...AUTH_HEADER,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "email=gone%40example.com",
        }),
      );
      const created = await jsonResponse(createRes);

      await app.handle(
        new Request(`http://localhost/v1/customers/${created.id}`, {
          method: "DELETE",
          headers: AUTH_HEADER,
        }),
      );

      // Try to retrieve
      const getRes = await app.handle(
        new Request(`http://localhost/v1/customers/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );
      expect(getRes.status).toBe(404);
    });
  });

  describe("GET /v1/customers", () => {
    it("lists customers", async () => {
      const app = createTestApp();

      // Create a few
      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        await app.handle(
          new Request("http://localhost/v1/customers", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `email=${encodeURIComponent(email)}`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/customers", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(3);
      expect(body.has_more).toBe(false);
      expect(body.url).toBe("/v1/customers");
    });

    it("paginates with limit", async () => {
      const app = createTestApp();

      // Create 5
      for (let i = 0; i < 5; i++) {
        await app.handle(
          new Request("http://localhost/v1/customers", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `email=user${i}%40example.com`,
          }),
        );
      }

      const res = await app.handle(
        new Request("http://localhost/v1/customers?limit=2", {
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

      // Create 3
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await app.handle(
          new Request("http://localhost/v1/customers", {
            method: "POST",
            headers: {
              ...AUTH_HEADER,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `email=page${i}%40example.com`,
          }),
        );
        const body = await jsonResponse(res);
        ids.push(body.id);
      }

      // First page with limit=2
      const page1Res = await app.handle(
        new Request("http://localhost/v1/customers?limit=2", {
          headers: AUTH_HEADER,
        }),
      );
      const page1 = await jsonResponse(page1Res);
      expect(page1.data.length).toBe(2);
      const lastId = page1.data[page1.data.length - 1].id;

      // Second page
      const page2Res = await app.handle(
        new Request(`http://localhost/v1/customers?limit=2&starting_after=${lastId}`, {
          headers: AUTH_HEADER,
        }),
      );
      const page2 = await jsonResponse(page2Res);
      expect(page2.has_more).toBe(false);
    });
  });
});
