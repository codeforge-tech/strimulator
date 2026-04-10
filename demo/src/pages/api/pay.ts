import type { APIRoute } from "astro";
import { stripe } from "../../lib/stripe";
import { getProducts } from "../../lib/products";

export const POST: APIRoute = async ({ request }) => {
  const { token, productIndex } = await request.json();
  const products = await getProducts();
  const product = products[productIndex];

  if (!product) {
    return new Response(JSON.stringify({ success: false, error: "Invalid product." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const customer = await stripe.customers.create({
      name: "Demo Customer",
      email: "demo@strimulator.dev",
    });

    const pm = await stripe.paymentMethods.create({
      type: "card",
      card: { token } as any,
    });

    await stripe.paymentMethods.attach(pm.id, { customer: customer.id });

    const pi = await stripe.paymentIntents.create({
      amount: product.priceInCents,
      currency: "usd",
      customer: customer.id,
      payment_method: pm.id,
      confirm: true,
    });

    if (pi.status === "succeeded") {
      return new Response(
        JSON.stringify({ success: true, paymentIntentId: pi.id, amount: pi.amount }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (pi.status === "requires_action") {
      return new Response(
        JSON.stringify({ requires_action: true, paymentIntentId: pi.id, amount: pi.amount }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Declined or other failure
    const errorMsg = pi.last_payment_error?.message ?? "Payment failed.";
    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    const message = err?.message ?? "Unexpected error.";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
