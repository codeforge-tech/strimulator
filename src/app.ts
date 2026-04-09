import { Elysia } from "elysia";
import { createDB, type StrimulatorDB } from "./db";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { requestLogger } from "./middleware/request-logger";
import { idempotencyMiddleware } from "./middleware/idempotency";
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
import { eventRoutes } from "./routes/events";
import { webhookEndpointRoutes } from "./routes/webhook-endpoints";
import { testClockRoutes } from "./routes/test-clocks";
import { dashboardServer } from "./dashboard/server";
import { EventService } from "./services/events";
import { WebhookEndpointService } from "./services/webhook-endpoints";
import { WebhookDeliveryService } from "./services/webhook-delivery";

export function createApp(db?: StrimulatorDB) {
  const database = db ?? createDB();

  // Shared service container
  const eventService = new EventService(database);
  const endpointService = new WebhookEndpointService(database);
  const deliveryService = new WebhookDeliveryService(database, endpointService);

  // Wire event delivery
  eventService.onEvent((event) => deliveryService.deliver(event));

  return new Elysia()
    .use(apiKeyAuth)
    .use(idempotencyMiddleware(database))
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
    .use(customerRoutes(database, eventService))
    .use(productRoutes(database, eventService))
    .use(priceRoutes(database, eventService))
    .use(paymentIntentRoutes(database, eventService))
    .use(paymentMethodRoutes(database, eventService))
    .use(chargeRoutes(database))
    .use(refundRoutes(database, eventService))
    .use(setupIntentRoutes(database, eventService))
    .use(subscriptionRoutes(database, eventService))
    .use(invoiceRoutes(database, eventService))
    .use(eventRoutes(database))
    .use(webhookEndpointRoutes(database))
    .use(testClockRoutes(database, eventService))
    .use(dashboardServer(database))
    .decorate("db", database);
}
