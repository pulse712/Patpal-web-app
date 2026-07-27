// Server-only Stripe client — never import this from client code.
// Import pattern: const { stripe } = await import("@/lib/stripe.server");
import Stripe from "stripe";
import { resolveCheckoutReturnOrigin } from "@/lib/app-url";

function createStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY environment variable.");
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

let _stripe: Stripe | undefined;

export const stripe = new Proxy({} as Stripe, {
  get(_, prop, receiver) {
    if (!_stripe) _stripe = createStripeClient();
    return Reflect.get(_stripe, prop, receiver);
  },
});

// Credit packages available for purchase.
// seconds: how many seconds are added to the wallet.
// amount: price in cents (USD).
export const CREDIT_PACKAGES = [
  { id: "pack_15min", label: "15 minutes", seconds: 15 * 60, amount: 1000 }, // $10
  { id: "pack_30min", label: "30 minutes", seconds: 30 * 60, amount: 1800 }, // $18
  { id: "pack_60min", label: "60 minutes", seconds: 60 * 60, amount: 3000 }, // $30
] as const;

export type PackageId = (typeof CREDIT_PACKAGES)[number]["id"];

export async function createWalletCheckoutSession(opts: {
  userId: string;
  seconds: number;
  amountCents: number;
  label: string;
  returnOrigin?: string;
  request?: Request;
}): Promise<string> {
  const origin = resolveCheckoutReturnOrigin({
    request: opts.request,
    clientOrigin: opts.returnOrigin,
  });
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: opts.amountCents,
          product_data: {
            name: `Pat My Back — ${opts.label}`,
            description: `${Math.round(opts.seconds / 60)} minutes of talk time`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      user_id: opts.userId,
      seconds: String(opts.seconds),
      label: opts.label,
    },
    success_url: `${origin}/wallet?payment=success`,
    cancel_url: `${origin}/wallet?payment=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return session.url;
}
