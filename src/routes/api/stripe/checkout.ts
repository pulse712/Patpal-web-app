// POST /api/stripe/checkout
// Creates a Stripe Checkout session for a credit package or custom amount.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase-server-env";

export const Route = createFileRoute("/api/stripe/checkout")({
  server: {
    handlers: {
      POST: async () => {
        const { resolveCreditPackages, createWalletCheckoutSession } =
          await import("@/lib/stripe.server");

        const request = getRequest();
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const token = authHeader.replace("Bearer ", "");

        const supabase = createClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
        if (authErr || !claims?.claims?.sub) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const userId = claims.claims.sub as string;

        const { data: profile } = await supabase
          .from("profiles")
          .select("is_active")
          .eq("id", userId)
          .single();
        if (profile?.is_active === false) {
          return new Response(JSON.stringify({ error: "Account deactivated" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        const body = await request.json().catch(() => ({}));

        let seconds: number;
        let amountCents: number;
        let label: string;

        if (body.packageId) {
          const packages = await resolveCreditPackages();
          const pkg = packages.find((p) => p.id === body.packageId);
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
          amountCents = Math.round(Number(body.customCents));
          const ratePerMinCents = 1000 / 15;
          seconds = Math.round((amountCents / ratePerMinCents) * 60);
          label = `Custom top-up (${Math.round(seconds / 60)} min)`;
        } else {
          return new Response(
            JSON.stringify({ error: "Provide packageId or customCents (min 500)" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        try {
          const url = await createWalletCheckoutSession({
            userId,
            seconds,
            amountCents,
            label,
            returnOrigin: typeof body.returnOrigin === "string" ? body.returnOrigin : undefined,
            request,
          });
          return new Response(JSON.stringify({ url }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Checkout failed",
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
