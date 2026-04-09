import { randomBytes } from "crypto";

export const ID_PREFIXES = {
  customer: "cus",
  payment_intent: "pi",
  payment_method: "pm",
  setup_intent: "seti",
  charge: "ch",
  refund: "re",
  product: "prod",
  price: "price",
  subscription: "sub",
  subscription_item: "si",
  invoice: "in",
  invoice_line_item: "il",
  webhook_endpoint: "we",
  event: "evt",
  test_clock: "clock",
  webhook_delivery: "whdel",
  idempotency_key: "idk",
} as const;

export type ResourceType = keyof typeof ID_PREFIXES;

export function generateId(type: ResourceType): string {
  const prefix = ID_PREFIXES[type];
  const random = randomBytes(10).toString("base64url").slice(0, 14);
  return `${prefix}_${random}`;
}

export function generateSecret(prefix: string): string {
  const random = randomBytes(24).toString("base64url");
  return `${prefix}_${random}`;
}
