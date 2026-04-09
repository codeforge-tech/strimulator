import { describe, test, expect } from "bun:test";
import { invalidRequestError, cardError, resourceNotFoundError, stateTransitionError } from "../../src/errors";

describe("StripeError", () => {
  test("creates invalid_request_error", () => {
    const err = invalidRequestError("Missing required param: amount", "amount");
    expect(err.statusCode).toBe(400);
    expect(err.body.error.type).toBe("invalid_request_error");
    expect(err.body.error.message).toBe("Missing required param: amount");
    expect(err.body.error.param).toBe("amount");
  });

  test("creates card_error with decline code", () => {
    const err = cardError("Your card was declined.", "card_declined", "card_declined");
    expect(err.statusCode).toBe(402);
    expect(err.body.error.type).toBe("card_error");
    expect(err.body.error.decline_code).toBe("card_declined");
  });

  test("creates resource not found error", () => {
    const err = resourceNotFoundError("customer", "cus_nonexistent");
    expect(err.statusCode).toBe(404);
    expect(err.body.error.type).toBe("invalid_request_error");
    expect(err.body.error.message).toContain("cus_nonexistent");
  });

  test("creates state transition error", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.statusCode).toBe(400);
    expect(err.body.error.code).toBe("payment_intent_unexpected_state");
  });
});
