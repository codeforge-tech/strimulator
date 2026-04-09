import { Elysia } from "elysia";
import { createDB, type StrimulatorDB } from "./db";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { requestLogger } from "./middleware/request-logger";
import { StripeError } from "./errors";
import { customerRoutes } from "./routes/customers";
import { productRoutes } from "./routes/products";
import { priceRoutes } from "./routes/prices";

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
    .decorate("db", database);
}
