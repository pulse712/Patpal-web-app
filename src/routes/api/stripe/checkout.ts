// POST /api/stripe/checkout
// Creates a Stripe Checkout session for a credit package or custom amount.
// Body: { packageId?: string; customCents?: number }
// Returns: { url: string }
import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const Route = createFileRoute("/api/stripe/checkout")({
  server: {
    handlers: {
      POST: requireSupabaseAuth.middleware(async ({ context }) => {
        const { stripe, CREDIT_PACKAGES } = await import("@/lib/stripe.server");
        const { userId } = context;

        const request = (await import("@tanstack/react-start/server")).getRequest();
        const body = await request.json().catch(() => ({}));

        // Resolve which package / custom amount to charge
        let seconds: number;
        let amountCents: number;
        let label: string;

        if (body.packageId) {
          const pkg = CREDIT_PACKAGES.find((p) => p.id === body.packageId);
          if (!pkg) {
            return new Response(JSON.stringify({ error: "Invalid package" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          seconds = pkg.seconds;
          amountCents = pkg.amount;
          label = pkg.label;
        } else if (body.customCents && Number(body.customCents) >= 500) {
          // Custom top-up: minimum $5, rate = $10 per 15 min ($0.667/min)
          amountCents = Math.round(Number(body.customCents));
          const ratePerMinCents = 1000 / 15; // same as the 15-min pack
          seconds = Math.round((amountCents / ratePerMinCents) * 60);
          label = `Custom top-up (${Math.round(seconds / 60)} min)`;
        } else {
          return new Response(JSON.stringify({ error: "Provide packageId or customCents (min 500)" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const origin = request.headers.get("origin") ?? "http://localhost:3000";

        const session = await (stripe as import("stripe").default).checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amountCents,
                product_data: {
                  name: `Pat My Back — ${label}`,
                  description: `${Math.round(seconds / 60)} minutes of talk time`,
                },
              },
              quantity: 1,
            },
          ],
          metadata: {
            user_id: userId,
            seconds: String(seconds),
            label,
          },
          success_url: `${origin}/wallet?payment=success`,
          cancel_url: `${origin}/wallet?payment=cancelled`,
          customer_email: undefined, // Stripe will ask on the form
        });

        return new Response(JSON.stringify({ url: session.url }), {
          headers: { "content-type": "application/json" },
        });
      }),
    },
  },
});
