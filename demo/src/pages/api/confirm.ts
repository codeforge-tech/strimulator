import type { APIRoute } from "astro";
import { stripe } from "../../lib/stripe";

export const POST: APIRoute = async ({ request }) => {
  const { paymentIntentId } = await request.json();

  try {
    const pi = await stripe.paymentIntents.confirm(paymentIntentId);

    if (pi.status === "succeeded") {
      return new Response(
        JSON.stringify({ success: true, paymentIntentId: pi.id, amount: pi.amount }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const errorMsg = pi.last_payment_error?.message ?? "Payment failed after 3DS.";
    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err?.message ?? "Unexpected error." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
