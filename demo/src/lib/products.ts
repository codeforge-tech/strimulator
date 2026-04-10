import { stripe } from "./stripe";

interface Product {
  name: string;
  priceInCents: number;
  description: string;
  stripeProductId?: string;
  stripePriceId?: string;
}

const catalog: Product[] = [
  { name: "Classic T-Shirt", priceInCents: 2500, description: "A comfortable cotton tee in midnight black." },
  { name: "Coffee Mug", priceInCents: 1500, description: "Ceramic mug that keeps your coffee warm." },
  { name: "Sticker Pack", priceInCents: 800, description: "10 die-cut vinyl stickers for your laptop." },
];

let bootstrapped = false;

export async function getProducts(): Promise<Product[]> {
  if (!bootstrapped) {
    for (const product of catalog) {
      const sp = await stripe.products.create({ name: product.name, description: product.description });
      const price = await stripe.prices.create({
        product: sp.id,
        unit_amount: product.priceInCents,
        currency: "usd",
      });
      product.stripeProductId = sp.id;
      product.stripePriceId = price.id;
    }
    bootstrapped = true;
  }
  return catalog;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
