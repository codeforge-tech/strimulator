import { Elysia } from "elysia";
import { createDB, type StrimulatorDB } from "./db";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { requestLogger } from "./middleware/request-logger";
import { StripeError } from "./errors";
import { customerRoutes } from "./routes/customers";
import { productRoutes } from "./routes/products";
import { priceRoutes } from "./routes/prices";
import { paymentIntentRoutes } from "./routes/payment-intents";
import { paymentMethodRoutes } from "./routes/payment-methods";
import { chargeRoutes } from "./routes/charges";
import { refundRoutes } from "./routes/refunds";
import { setupIntentRoutes } from "./routes/setup-intents";
import { subscriptionRoutes } from "./routes/subscriptions";
import { invoiceRoutes } from "./routes/invoices";

export function createApp(db?: StrimulatorDB) {
  const database = db ?? createDB();

  return new Elysia()
    .use(apiKeyAuth)
    .use(requestLogger)
    .onError(({ error, set }) => {
      if (error instanceof Response) {
        return error;
      }

      if (error instanceof StripeError) {
        set.status = error.statusCode;
        return error.body;
      }

      set.status = 500;
      return {
        error: {
          type: "api_error",
          message: "An unexpected error occurred.",
          code: undefined,
          param: undefined,
        },
      };
    })
    .get("/", () => ({
      object: "api",
      has_more: false,
      url: "/v1",
      livemode: false,
    }))
    .use(customerRoutes(database))
    .use(productRoutes(database))
    .use(priceRoutes(database))
    .use(paymentIntentRoutes(database))
    .use(paymentMethodRoutes(database))
    .use(chargeRoutes(database))
    .use(refundRoutes(database))
    .use(setupIntentRoutes(database))
    .use(subscriptionRoutes(database))
    .use(invoiceRoutes(database))
    .decorate("db", database);
}
