import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { paymentIntentRoutes } from "../../src/routes/payment-intents";
import { paymentMethodRoutes } from "../../src/routes/payment-methods";
import { chargeRoutes } from "../../src/routes/charges";
import { apiKeyAuth } from "../../src/middleware/api-key-auth";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia()
    .use(apiKeyAuth)
    .use(paymentIntentRoutes(db))
    .use(paymentMethodRoutes(db))
    .use(chargeRoutes(db));
}

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };
const FORM_HEADER = {
  ...AUTH_HEADER,
  "Content-Type": "application/x-www-form-urlencoded",
};

async function jsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createPaymentMethod(app: Elysia, token = "tok_visa") {
  const res = await app.handle(
    new Request("http://localhost/v1/payment_methods", {
      method: "POST",
      headers: FORM_HEADER,
      body: `type=card&card%5Btoken%5D=${token}`,
    }),
  );
  return jsonResponse(res);
}

async function createPaymentIntent(app: Elysia, extraBody = "") {
  const res = await app.handle(
    new Request("http://localhost/v1/payment_intents", {
      method: "POST",
      headers: FORM_HEADER,
      body: `amount=1000&currency=usd${extraBody ? "&" + extraBody : ""}`,
    }),
  );
  return { res, body: await jsonResponse(res) };
}

describe("Payment Intent Routes Integration", () => {
  describe("POST /v1/payment_intents", () => {
    it("creates a payment intent and returns correct shape", async () => {
      const app = createTestApp();
      const { res, body } = await createPaymentIntent(app);

      expect(res.status).toBe(200);
      expect(body.id).toMatch(/^pi_/);
      expect(body.object).toBe("payment_intent");
      expect(body.amount).toBe(1000);
      expect(body.currency).toBe("usd");
      expect(body.status).toBe("requires_payment_method");
      expect(body.client_secret).toMatch(/^pi_.*_secret_/);
    });

    it("creates PI with payment_method → status requires_confirmation", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const { res, body } = await createPaymentIntent(app, `payment_method=${pm.id}`);

      expect(res.status).toBe(200);
      expect(body.status).toBe("requires_confirmation");
      expect(body.payment_method).toBe(pm.id);
    });

    it("creates PI with confirm=true → directly succeeded", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const { res, body } = await createPaymentIntent(
        app,
        `payment_method=${pm.id}&confirm=true`,
      );

      expect(res.status).toBe(200);
      expect(body.status).toBe("succeeded");
      expect(body.amount_received).toBe(1000);
      expect(body.latest_charge).toMatch(/^ch_/);
    });

    it("returns 400 for missing amount", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents", {
          method: "POST",
          headers: FORM_HEADER,
          body: "currency=usd",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 401 without auth", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "amount=1000&currency=usd",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET /v1/payment_intents/:id", () => {
    it("retrieves a payment intent by id", async () => {
      const app = createTestApp();
      const { body: created } = await createPaymentIntent(app);

      const res = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${created.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.id).toBe(created.id);
      expect(body.object).toBe("payment_intent");
    });

    it("returns 404 for nonexistent PI", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents/pi_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
      const body = await jsonResponse(res);
      expect(body.error.code).toBe("resource_missing");
    });
  });

  describe("POST /v1/payment_intents/:id/confirm", () => {
    it("confirms a PI with a payment method → succeeded", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);
      const { body: pi } = await createPaymentIntent(app);

      const res = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/confirm`, {
          method: "POST",
          headers: FORM_HEADER,
          body: `payment_method=${pm.id}`,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.status).toBe("succeeded");
      expect(body.payment_method).toBe(pm.id);
      expect(body.latest_charge).toMatch(/^ch_/);
    });

    it("full flow: create PM → create PI → confirm → check succeeded", async () => {
      const app = createTestApp();

      // Step 1: Create payment method
      const pm = await createPaymentMethod(app, "tok_visa");
      expect(pm.id).toMatch(/^pm_/);

      // Step 2: Create PI
      const { body: pi } = await createPaymentIntent(app, `payment_method=${pm.id}`);
      expect(pi.status).toBe("requires_confirmation");

      // Step 3: Confirm
      const confirmRes = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/confirm`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "",
        }),
      );
      expect(confirmRes.status).toBe(200);
      const confirmed = await jsonResponse(confirmRes);
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.amount_received).toBe(1000);
    });
  });

  describe("Manual capture flow", () => {
    it("capture_method=manual → requires_capture → capture → succeeded", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      // Create with manual capture and confirm immediately
      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents", {
          method: "POST",
          headers: FORM_HEADER,
          body: `amount=2000&currency=usd&payment_method=${pm.id}&capture_method=manual&confirm=true`,
        }),
      );
      expect(res.status).toBe(200);
      const pi = await jsonResponse(res);
      expect(pi.status).toBe("requires_capture");
      expect(pi.amount_capturable).toBe(2000);

      // Capture
      const captureRes = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/capture`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "",
        }),
      );
      expect(captureRes.status).toBe(200);
      const captured = await jsonResponse(captureRes);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(2000);
    });

    it("capture with amount_to_capture", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const createRes = await app.handle(
        new Request("http://localhost/v1/payment_intents", {
          method: "POST",
          headers: FORM_HEADER,
          body: `amount=5000&currency=usd&payment_method=${pm.id}&capture_method=manual&confirm=true`,
        }),
      );
      const pi = await jsonResponse(createRes);

      const captureRes = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/capture`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "amount_to_capture=3000",
        }),
      );
      expect(captureRes.status).toBe(200);
      const captured = await jsonResponse(captureRes);
      expect(captured.status).toBe("succeeded");
      expect(captured.amount_received).toBe(3000);
    });
  });

  describe("POST /v1/payment_intents/:id/cancel", () => {
    it("cancels a PI", async () => {
      const app = createTestApp();
      const { body: pi } = await createPaymentIntent(app);

      const cancelRes = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/cancel`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "cancellation_reason=requested_by_customer",
        }),
      );

      expect(cancelRes.status).toBe(200);
      const canceled = await jsonResponse(cancelRes);
      expect(canceled.status).toBe("canceled");
      expect(canceled.cancellation_reason).toBe("requested_by_customer");
      expect(canceled.canceled_at).toBeGreaterThan(0);
    });

    it("cannot cancel a succeeded PI", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);
      const { body: pi } = await createPaymentIntent(
        app,
        `payment_method=${pm.id}&confirm=true`,
      );
      expect(pi.status).toBe("succeeded");

      const cancelRes = await app.handle(
        new Request(`http://localhost/v1/payment_intents/${pi.id}/cancel`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "",
        }),
      );
      expect(cancelRes.status).toBe(400);
    });
  });

  describe("GET /v1/payment_intents", () => {
    it("lists payment intents", async () => {
      const app = createTestApp();

      for (let i = 0; i < 3; i++) {
        await createPaymentIntent(app);
      }

      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(3);
      expect(body.has_more).toBe(false);
    });

    it("paginates with limit", async () => {
      const app = createTestApp();

      for (let i = 0; i < 5; i++) {
        await createPaymentIntent(app);
      }

      const res = await app.handle(
        new Request("http://localhost/v1/payment_intents?limit=2", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.data.length).toBe(2);
      expect(body.has_more).toBe(true);
    });
  });
});

describe("Payment Method Routes Integration", () => {
  describe("POST /v1/payment_methods", () => {
    it("creates a payment method", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      expect(pm.id).toMatch(/^pm_/);
      expect(pm.object).toBe("payment_method");
      expect(pm.type).toBe("card");
      expect(pm.card.brand).toBe("visa");
      expect(pm.card.last4).toBe("4242");
    });

    it("creates a mastercard payment method", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app, "tok_mastercard");

      expect(pm.card.brand).toBe("mastercard");
      expect(pm.card.last4).toBe("4444");
    });
  });

  describe("GET /v1/payment_methods/:id", () => {
    it("retrieves a payment method", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const res = await app.handle(
        new Request(`http://localhost/v1/payment_methods/${pm.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.id).toBe(pm.id);
    });

    it("returns 404 for nonexistent PM", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/payment_methods/pm_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /v1/payment_methods/:id/attach", () => {
    it("attaches a PM to a customer", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const res = await app.handle(
        new Request(`http://localhost/v1/payment_methods/${pm.id}/attach`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "customer=cus_test123",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.customer).toBe("cus_test123");
    });
  });

  describe("POST /v1/payment_methods/:id/detach", () => {
    it("detaches a PM from a customer", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      // Attach first
      await app.handle(
        new Request(`http://localhost/v1/payment_methods/${pm.id}/attach`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "customer=cus_test123",
        }),
      );

      // Detach
      const res = await app.handle(
        new Request(`http://localhost/v1/payment_methods/${pm.id}/detach`, {
          method: "POST",
          headers: FORM_HEADER,
          body: "",
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.customer).toBeNull();
    });
  });

  describe("GET /v1/payment_methods", () => {
    it("lists payment methods", async () => {
      const app = createTestApp();

      for (let i = 0; i < 3; i++) {
        await createPaymentMethod(app);
      }

      const res = await app.handle(
        new Request("http://localhost/v1/payment_methods", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(3);
    });
  });
});

describe("Charge Routes Integration", () => {
  describe("GET /v1/charges/:id", () => {
    it("retrieves a charge created by a PI confirmation", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const { body: pi } = await createPaymentIntent(
        app,
        `payment_method=${pm.id}&confirm=true`,
      );
      expect(pi.latest_charge).toMatch(/^ch_/);

      const res = await app.handle(
        new Request(`http://localhost/v1/charges/${pi.latest_charge}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const charge = await jsonResponse(res);
      expect(charge.id).toBe(pi.latest_charge);
      expect(charge.object).toBe("charge");
      expect(charge.amount).toBe(1000);
      expect(charge.status).toBe("succeeded");
      expect(charge.paid).toBe(true);
    });

    it("returns 404 for nonexistent charge", async () => {
      const app = createTestApp();
      const res = await app.handle(
        new Request("http://localhost/v1/charges/ch_nonexistent", {
          headers: AUTH_HEADER,
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/charges", () => {
    it("lists charges", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      // Create 2 succeeded PIs
      for (let i = 0; i < 2; i++) {
        await createPaymentIntent(app, `payment_method=${pm.id}&confirm=true`);
      }

      const res = await app.handle(
        new Request("http://localhost/v1/charges", {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.object).toBe("list");
      expect(body.data.length).toBe(2);
    });

    it("filters charges by payment_intent", async () => {
      const app = createTestApp();
      const pm = await createPaymentMethod(app);

      const { body: pi1 } = await createPaymentIntent(
        app,
        `payment_method=${pm.id}&confirm=true`,
      );
      await createPaymentIntent(app, `payment_method=${pm.id}&confirm=true`);

      const res = await app.handle(
        new Request(`http://localhost/v1/charges?payment_intent=${pi1.id}`, {
          headers: AUTH_HEADER,
        }),
      );

      expect(res.status).toBe(200);
      const body = await jsonResponse(res);
      expect(body.data.length).toBe(1);
      expect(body.data[0].payment_intent).toBe(pi1.id);
    });
  });
});
