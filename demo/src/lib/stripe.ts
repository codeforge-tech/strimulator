import Stripe from "stripe";

export const stripe = new Stripe("sk_test_strimulator", {
  host: "localhost",
  port: 12111,
  protocol: "http",
} as any);
