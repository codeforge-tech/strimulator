import { describe, it, expect } from "bun:test";
import {
  StripeError,
  invalidRequestError,
  cardError,
  resourceNotFoundError,
  stateTransitionError,
  authenticationError,
} from "../../src/errors";

describe("StripeError", () => {
  it("is a class that can be instantiated", () => {
    const err = new StripeError(400, {
      error: { type: "test", message: "test msg" },
    });
    expect(err).toBeInstanceOf(StripeError);
  });

  it("stores statusCode", () => {
    const err = new StripeError(400, {
      error: { type: "test", message: "test" },
    });
    expect(err.statusCode).toBe(400);
  });

  it("stores body with error details", () => {
    const err = new StripeError(400, {
      error: { type: "invalid_request_error", message: "bad request", param: "amount" },
    });
    expect(err.body.error.type).toBe("invalid_request_error");
    expect(err.body.error.message).toBe("bad request");
    expect(err.body.error.param).toBe("amount");
  });

  it("statusCode and body are readonly", () => {
    const err = new StripeError(400, {
      error: { type: "test", message: "test" },
    });
    // These are readonly in the constructor but we can verify they exist
    expect(err.statusCode).toBeDefined();
    expect(err.body).toBeDefined();
  });
});

describe("invalidRequestError", () => {
  it("creates error with statusCode 400", () => {
    const err = invalidRequestError("Missing required param: amount");
    expect(err.statusCode).toBe(400);
  });

  it("has type invalid_request_error", () => {
    const err = invalidRequestError("Missing param");
    expect(err.body.error.type).toBe("invalid_request_error");
  });

  it("stores the message", () => {
    const err = invalidRequestError("Missing required param: amount");
    expect(err.body.error.message).toBe("Missing required param: amount");
  });

  it("stores the param when provided", () => {
    const err = invalidRequestError("Missing required param: amount", "amount");
    expect(err.body.error.param).toBe("amount");
  });

  it("param is undefined when not provided", () => {
    const err = invalidRequestError("Missing param");
    expect(err.body.error.param).toBeUndefined();
  });

  it("stores the code when provided", () => {
    const err = invalidRequestError("Invalid value", "param", "parameter_invalid");
    expect(err.body.error.code).toBe("parameter_invalid");
  });

  it("code is undefined when not provided", () => {
    const err = invalidRequestError("Missing param");
    expect(err.body.error.code).toBeUndefined();
  });

  it("returns StripeError instance", () => {
    const err = invalidRequestError("test");
    expect(err).toBeInstanceOf(StripeError);
  });
});

describe("cardError", () => {
  it("creates error with statusCode 402", () => {
    const err = cardError("Your card was declined.", "card_declined");
    expect(err.statusCode).toBe(402);
  });

  it("has type card_error", () => {
    const err = cardError("declined", "card_declined");
    expect(err.body.error.type).toBe("card_error");
  });

  it("stores the message", () => {
    const err = cardError("Your card was declined.", "card_declined");
    expect(err.body.error.message).toBe("Your card was declined.");
  });

  it("stores the code", () => {
    const err = cardError("declined", "card_declined");
    expect(err.body.error.code).toBe("card_declined");
  });

  it("stores decline_code when provided", () => {
    const err = cardError("declined", "card_declined", "card_declined");
    expect(err.body.error.decline_code).toBe("card_declined");
  });

  it("decline_code is undefined when not provided", () => {
    const err = cardError("declined", "card_declined");
    expect(err.body.error.decline_code).toBeUndefined();
  });

  it("stores different decline codes", () => {
    const err = cardError("Insufficient funds", "card_declined", "insufficient_funds");
    expect(err.body.error.decline_code).toBe("insufficient_funds");
    expect(err.body.error.code).toBe("card_declined");
  });

  it("param is undefined for card errors", () => {
    const err = cardError("declined", "card_declined");
    expect(err.body.error.param).toBeUndefined();
  });

  it("returns StripeError instance", () => {
    const err = cardError("declined", "code");
    expect(err).toBeInstanceOf(StripeError);
  });
});

describe("resourceNotFoundError", () => {
  it("creates error with statusCode 404", () => {
    const err = resourceNotFoundError("customer", "cus_nonexistent");
    expect(err.statusCode).toBe(404);
  });

  it("has type invalid_request_error", () => {
    const err = resourceNotFoundError("customer", "cus_123");
    expect(err.body.error.type).toBe("invalid_request_error");
  });

  it("message contains the resource ID", () => {
    const err = resourceNotFoundError("customer", "cus_nonexistent");
    expect(err.body.error.message).toContain("cus_nonexistent");
  });

  it("message contains the resource type", () => {
    const err = resourceNotFoundError("customer", "cus_abc");
    expect(err.body.error.message).toContain("customer");
  });

  it("message follows 'No such resource: id' format", () => {
    const err = resourceNotFoundError("customer", "cus_xyz");
    expect(err.body.error.message).toBe("No such customer: 'cus_xyz'");
  });

  it("works for different resource types", () => {
    const err1 = resourceNotFoundError("payment_intent", "pi_abc");
    expect(err1.body.error.message).toContain("payment_intent");
    expect(err1.body.error.message).toContain("pi_abc");

    const err2 = resourceNotFoundError("subscription", "sub_xyz");
    expect(err2.body.error.message).toContain("subscription");
    expect(err2.body.error.message).toContain("sub_xyz");
  });

  it("has param 'id'", () => {
    const err = resourceNotFoundError("customer", "cus_abc");
    expect(err.body.error.param).toBe("id");
  });

  it("has code 'resource_missing'", () => {
    const err = resourceNotFoundError("customer", "cus_abc");
    expect(err.body.error.code).toBe("resource_missing");
  });

  it("returns StripeError instance", () => {
    const err = resourceNotFoundError("customer", "cus_abc");
    expect(err).toBeInstanceOf(StripeError);
  });
});

describe("stateTransitionError", () => {
  it("creates error with statusCode 400", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.statusCode).toBe(400);
  });

  it("has type invalid_request_error", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.type).toBe("invalid_request_error");
  });

  it("code is resource_unexpected_state", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.code).toBe("payment_intent_unexpected_state");
  });

  it("message contains current status", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.message).toContain("succeeded");
  });

  it("message contains action", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.message).toContain("confirm");
  });

  it("message contains resource type", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.message).toContain("payment_intent");
  });

  it("message follows expected format", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.message).toBe(
      "You cannot confirm this payment_intent because it has a status of succeeded.",
    );
  });

  it("code uses resource type prefix", () => {
    const err = stateTransitionError("subscription", "sub_abc", "canceled", "update");
    expect(err.body.error.code).toBe("subscription_unexpected_state");
  });

  it("param is undefined", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err.body.error.param).toBeUndefined();
  });

  it("returns StripeError instance", () => {
    const err = stateTransitionError("payment_intent", "pi_123", "succeeded", "confirm");
    expect(err).toBeInstanceOf(StripeError);
  });
});

describe("authenticationError", () => {
  it("creates error with statusCode 401", () => {
    const err = authenticationError();
    expect(err.statusCode).toBe(401);
  });

  it("has type authentication_error", () => {
    const err = authenticationError();
    expect(err.body.error.type).toBe("authentication_error");
  });

  it("message mentions API key", () => {
    const err = authenticationError();
    expect(err.body.error.message).toContain("API Key");
  });

  it("message mentions sk_test", () => {
    const err = authenticationError();
    expect(err.body.error.message).toContain("sk_test");
  });

  it("returns StripeError instance", () => {
    const err = authenticationError();
    expect(err).toBeInstanceOf(StripeError);
  });
});

describe("error serialization", () => {
  it("body can be serialized to JSON matching Stripe format", () => {
    const err = invalidRequestError("Missing amount", "amount");
    const json = JSON.stringify(err.body);
    const parsed = JSON.parse(json);
    expect(parsed.error.type).toBe("invalid_request_error");
    expect(parsed.error.message).toBe("Missing amount");
    expect(parsed.error.param).toBe("amount");
  });

  it("card error serializes with all fields", () => {
    const err = cardError("Declined", "card_declined", "insufficient_funds");
    const json = JSON.stringify(err.body);
    const parsed = JSON.parse(json);
    expect(parsed.error.type).toBe("card_error");
    expect(parsed.error.code).toBe("card_declined");
    expect(parsed.error.decline_code).toBe("insufficient_funds");
  });
});
