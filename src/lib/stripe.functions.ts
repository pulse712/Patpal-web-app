// Client-callable server functions for Stripe operations.
// These run on the server — no secret keys are exposed to the browser.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const checkoutSchema = z.union([
  z.object({ packageId: z.string(), customCents: z.undefined().optional() }),
  z.object({ customCents: z.number().min(500), packageId: z.undefined().optional() }),
]);

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => checkoutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { stripe, CREDIT_PACKAGES } = await import("@/lib/stripe.server");
    const { userId } = context;

    let seconds: number;
    let amountCents: number;
    let label: string;

    if (data.packageId) {
      const pkg = CREDIT_PACKAGES.find((p) => p.id === data.packageId);
      if (!pkg) throw new Error("Invalid package ID");
      seconds = pkg.seconds;
      amountCents = pkg.amount;
      label = pkg.label;
    } else {
      amountCents = Math.round(data.customCents!);
      const ratePerMinCents = 1000 / 15;
      seconds = Math.round((amountCents / ratePerMinCents) * 60);
      label = `Custom top-up (${Math.round(seconds / 60)} min)`;
    }

    // Derive origin from env or fall back to production URL
    const origin =
      process.env.VITE_APP_URL ??
      process.env.APP_URL ??
      "https://patmyback.com";

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
    });

    return { url: session.url! };
  });
