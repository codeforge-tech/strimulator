export class StripeError {
  constructor(
    public readonly statusCode: number,
    public readonly body: {
      error: {
        type: string;
        message: string;
        code?: string;
        param?: string;
        decline_code?: string;
      };
    },
  ) {}
}

export function invalidRequestError(message: string, param?: string, code?: string): StripeError {
  return new StripeError(400, {
    error: { type: "invalid_request_error", message, param: param ?? undefined, code: code ?? undefined },
  });
}

export function cardError(message: string, code: string, declineCode?: string): StripeError {
  return new StripeError(402, {
    error: { type: "card_error", message, code, decline_code: declineCode ?? undefined, param: undefined },
  });
}

export function resourceNotFoundError(resource: string, id: string): StripeError {
  return new StripeError(404, {
    error: { type: "invalid_request_error", message: `No such ${resource}: '${id}'`, param: "id", code: "resource_missing" },
  });
}

export function stateTransitionError(resource: string, id: string, currentStatus: string, action: string): StripeError {
  return new StripeError(400, {
    error: {
      type: "invalid_request_error",
      message: `You cannot ${action} this ${resource} because it has a status of ${currentStatus}.`,
      code: `${resource}_unexpected_state`,
      param: undefined,
    },
  });
}

export function authenticationError(): StripeError {
  return new StripeError(401, {
    error: { type: "authentication_error", message: "Invalid API Key provided: sk_test_****", code: undefined, param: undefined },
  });
}
