import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createDB } from "../../src/db";
import { customerRoutes } from "../../src/routes/customers";
import { paymentMethodRoutes } from "../../src/routes/payment-methods";
import { paymentIntentRoutes } from "../../src/routes/payment-intents";
import { chargeRoutes } from "../../src/routes/charges";
import { subscriptionRoutes } from "../../src/routes/subscriptions";
import { invoiceRoutes } from "../../src/routes/invoices";
import { priceRoutes } from "../../src/routes/prices";
import { productRoutes } from "../../src/routes/products";
import { apiKeyAuth } from "../../src/middleware/api-key-auth";

function createTestApp() {
  const db = createDB(":memory:");
  return new Elysia()
    .use(apiKeyAuth)
    .use(customerRoutes(db))
    .use(productRoutes(db))
    .use(priceRoutes(db))
    .use(paymentMethodRoutes(db))
    .use(paymentIntentRoutes(db))
    .use(chargeRoutes(db))
    .use(subscriptionRoutes(db))
    .use(invoiceRoutes(db));
}

const AUTH_HEADER = { Authorization: "Bearer sk_test_testkey123" };
const FORM_HEADER = {
  ...AUTH_HEADER,
  "Content-Type": "application/x-www-form-urlencoded",
};

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createCustomer(app: Elysia, email = "test@example.com") {
  const res = await app.handle(
    new Request("http://localhost/v1/customers", {
      method: "POST",
      headers: FORM_HEADER,
      body: `email=${encodeURIComponent(email)}`,
    }),
  );
  return json(res);
}

async function createPaymentMethod(app: Elysia, token = "tok_visa") {
  const res = await app.handle(
    new Request("http://localhost/v1/payment_methods", {
      method: "POST",
      headers: FORM_HEADER,
      body: `type=card&card%5Btoken%5D=${token}`,
    }),
  );
  return json(res);
}

async function createProduct(app: Elysia) {
  const res = await app.handle(
    new Request("http://localhost/v1/products", {
      method: "POST",
      headers: FORM_HEADER,
      body: "name=Test+Product",
    }),
  );
  return json(res);
}

async function createPrice(app: Elysia, productId: string) {
  const res = await app.handle(
    new Request("http://localhost/v1/prices", {
      method: "POST",
      headers: FORM_HEADER,
      body: `product=${productId}&currency=usd&unit_amount=2000&recurring%5Binterval%5D=month`,
    }),
  );
  return json(res);
}

describe("expand[] — PaymentIntent", () => {
  it("GET /:id without expand returns customer as string ID", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const pm = await createPaymentMethod(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&customer=${customer.id}&payment_method=${pm.id}`,
      }),
    );
    const pi = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/payment_intents/${pi.id}`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.customer).toBe(customer.id);
  });

  it("GET /:id?expand[]=customer returns full customer object", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const pm = await createPaymentMethod(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&customer=${customer.id}&payment_method=${pm.id}`,
      }),
    );
    const pi = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/payment_intents/${pi.id}?expand%5B%5D=customer`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.customer).toBe("object");
    expect(body.customer.id).toBe(customer.id);
    expect(body.customer.object).toBe("customer");
    expect(body.customer.email).toBe("test@example.com");
  });

  it("GET /:id?expand[]=payment_method returns full payment_method object", async () => {
    const app = createTestApp();
    const pm = await createPaymentMethod(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&payment_method=${pm.id}`,
      }),
    );
    const pi = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/payment_intents/${pi.id}?expand%5B%5D=payment_method`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.payment_method).toBe("object");
    expect(body.payment_method.id).toBe(pm.id);
    expect(body.payment_method.object).toBe("payment_method");
  });

  it("GET /:id?expand[]=latest_charge returns full charge object after confirm", async () => {
    const app = createTestApp();
    const pm = await createPaymentMethod(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&payment_method=${pm.id}&confirm=true`,
      }),
    );
    const pi = await json(createRes);
    expect(pi.status).toBe("succeeded");

    const res = await app.handle(
      new Request(`http://localhost/v1/payment_intents/${pi.id}?expand%5B%5D=latest_charge`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.latest_charge).toBe("object");
    expect(body.latest_charge.object).toBe("charge");
    expect(body.latest_charge.amount).toBe(1000);
  });

  it("expand[] with non-string ID (null) leaves field as null", async () => {
    const app = createTestApp();

    // Create PI without customer
    const createRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: "amount=500&currency=usd",
      }),
    );
    const pi = await json(createRes);
    expect(pi.customer).toBeNull();

    const res = await app.handle(
      new Request(`http://localhost/v1/payment_intents/${pi.id}?expand%5B%5D=customer`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.customer).toBeNull();
  });
});

describe("expand[] — Subscription", () => {
  it("GET /:id without expand returns customer as string ID", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const product = await createProduct(app);
    const price = await createPrice(app, product.id);

    const createRes = await app.handle(
      new Request("http://localhost/v1/subscriptions", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&items%5B0%5D%5Bprice%5D=${price.id}`,
      }),
    );
    const sub = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/subscriptions/${sub.id}`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.customer).toBe(customer.id);
  });

  it("GET /:id?expand[]=customer returns full customer object", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const product = await createProduct(app);
    const price = await createPrice(app, product.id);

    const createRes = await app.handle(
      new Request("http://localhost/v1/subscriptions", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&items%5B0%5D%5Bprice%5D=${price.id}`,
      }),
    );
    const sub = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/subscriptions/${sub.id}?expand%5B%5D=customer`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.customer).toBe("object");
    expect(body.customer.id).toBe(customer.id);
    expect(body.customer.object).toBe("customer");
  });
});

describe("expand[] — Invoice", () => {
  it("GET /:id?expand[]=customer returns full customer object", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&currency=usd&amount_due=5000`,
      }),
    );
    const invoice = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/invoices/${invoice.id}?expand%5B%5D=customer`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.customer).toBe("object");
    expect(body.customer.id).toBe(customer.id);
    expect(body.customer.object).toBe("customer");
  });

  it("GET /:id without expand returns customer as string ID", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);

    const createRes = await app.handle(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&currency=usd`,
      }),
    );
    const invoice = await json(createRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/invoices/${invoice.id}`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.customer).toBe(customer.id);
  });

  it("GET /:id?expand[]=subscription returns full subscription object", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const product = await createProduct(app);
    const price = await createPrice(app, product.id);

    // Create subscription (which also creates an invoice internally via service)
    const subRes = await app.handle(
      new Request("http://localhost/v1/subscriptions", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&items%5B0%5D%5Bprice%5D=${price.id}`,
      }),
    );
    const sub = await json(subRes);

    // Create invoice linked to the subscription
    const createRes = await app.handle(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&currency=usd&amount_due=2000`,
      }),
    );
    // Build a fresh invoice linked to the subscription using the service directly
    // since POST /v1/invoices doesn't accept subscription in all setups
    // Instead, let's retrieve the invoice and verify subscription expand on a manually created one
    const invoice = await json(createRes);

    // The invoice has subscription=null, so expanding it should leave it null
    const res = await app.handle(
      new Request(`http://localhost/v1/invoices/${invoice.id}?expand%5B%5D=subscription`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    // subscription is null on this invoice, expansion should not change it
    expect(body.subscription).toBeNull();

    // Now let's also test with a real subscription ID: post invoice with subscription param
    const createRes2 = await app.handle(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: FORM_HEADER,
        body: `customer=${customer.id}&currency=usd&amount_due=2000&subscription=${sub.id}`,
      }),
    );
    const invoice2 = await json(createRes2);
    expect(invoice2.subscription).toBe(sub.id);

    const res2 = await app.handle(
      new Request(`http://localhost/v1/invoices/${invoice2.id}?expand%5B%5D=subscription`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = await json(res2);
    expect(typeof body2.subscription).toBe("object");
    expect(body2.subscription.id).toBe(sub.id);
    expect(body2.subscription.object).toBe("subscription");
  });
});

describe("expand[] — Charge", () => {
  it("GET /:id without expand returns payment_intent as string ID", async () => {
    const app = createTestApp();
    const pm = await createPaymentMethod(app);

    const piRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&payment_method=${pm.id}&confirm=true`,
      }),
    );
    const pi = await json(piRes);

    const res = await app.handle(
      new Request(`http://localhost/v1/charges/${pi.latest_charge}`, {
        headers: AUTH_HEADER,
      }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.payment_intent).toBe(pi.id);
  });

  it("GET /:id?expand[]=payment_intent returns full payment_intent object", async () => {
    const app = createTestApp();
    const pm = await createPaymentMethod(app);

    const piRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&payment_method=${pm.id}&confirm=true`,
      }),
    );
    const pi = await json(piRes);

    const res = await app.handle(
      new Request(
        `http://localhost/v1/charges/${pi.latest_charge}?expand%5B%5D=payment_intent`,
        { headers: AUTH_HEADER },
      ),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.payment_intent).toBe("object");
    expect(body.payment_intent.id).toBe(pi.id);
    expect(body.payment_intent.object).toBe("payment_intent");
  });

  it("GET /:id?expand[]=customer returns full customer object", async () => {
    const app = createTestApp();
    const customer = await createCustomer(app);
    const pm = await createPaymentMethod(app);

    const piRes = await app.handle(
      new Request("http://localhost/v1/payment_intents", {
        method: "POST",
        headers: FORM_HEADER,
        body: `amount=1000&currency=usd&customer=${customer.id}&payment_method=${pm.id}&confirm=true`,
      }),
    );
    const pi = await json(piRes);

    const res = await app.handle(
      new Request(
        `http://localhost/v1/charges/${pi.latest_charge}?expand%5B%5D=customer`,
        { headers: AUTH_HEADER },
      ),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(typeof body.customer).toBe("object");
    expect(body.customer.id).toBe(customer.id);
    expect(body.customer.object).toBe("customer");
  });
});
