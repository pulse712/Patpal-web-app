// POST /api/stripe/webhook
// Receives Stripe webhook events and credits the user's wallet on successful payment.
// Configure in Stripe Dashboard: Endpoint URL = https://yourdomain.com/api/stripe/webhook
// Events to listen for: checkout.session.completed
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async () => {
        const { getRequest } = await import("@tanstack/react-start/server");
        const { stripe } = await import("@/lib/stripe.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const request = getRequest();
        const sig = request.headers.get("stripe-signature");
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!sig || !webhookSecret) {
          return new Response("Missing signature or webhook secret", { status: 400 });
        }

        let event: import("stripe").Stripe.Event;
        const rawBody = await request.text();

        try {
          event = (stripe as import("stripe").default).webhooks.constructEvent(
            rawBody,
            sig,
            webhookSecret,
          );
        } catch (err) {
          console.error("[Stripe webhook] Signature verification failed:", err);
          return new Response("Invalid signature", { status: 400 });
        }

        // Helper: credit wallet atomically from metadata
        async function creditWallet(
          userId: string,
          seconds: number,
          amountCents: number,
          stripeRef: string,
          label: string,
        ) {
          const { error } = await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: userId,
            p_seconds: seconds,
            p_cents_amount: amountCents,
            p_stripe_ref: stripeRef,
            p_note: label,
          });

          if (error) throw new Error(`Wallet credit failed: ${error.message}`);

          console.log(`[Stripe webhook] Credited ${seconds}s to user ${userId}`);
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object as import("stripe").Stripe.Checkout.Session;
          const userId = session.metadata?.user_id;
          const seconds = parseInt(session.metadata?.seconds ?? "0", 10);
          const label = session.metadata?.label ?? "Credit purchase";
          const amountCents = session.amount_total ?? 0;

          if (!userId || !seconds) {
            console.error("[Stripe webhook] Missing metadata:", session.metadata);
            return new Response("Missing metadata", { status: 400 });
          }

          try {
            await creditWallet(
              userId,
              seconds,
              amountCents,
              (session.payment_intent as string) ?? session.id,
              label,
            );

            // Send payment receipt email (best-effort)
            try {
              const { data: profile } = await supabaseAdmin
                .from("profiles")
                .select("full_name")
                .eq("id", userId)
                .single();
              const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
              const email = authUser?.user?.email;

              if (email) {
                const { sendPaymentReceipt } = await import("@/lib/email.server");
                const { data: wallet } = await supabaseAdmin
                  .from("wallets")
                  .select("balance_seconds")
                  .eq("user_id", userId)
                  .single();

                await sendPaymentReceipt({
                  to: email,
                  name: profile?.full_name || "there",
                  amountDollars: (amountCents / 100).toFixed(2),
                  minutes: Math.round(seconds / 60),
                  newBalanceMinutes: Math.round((wallet?.balance_seconds ?? 0) / 60),
                  receiptUrl: undefined,
                  date: new Date().toLocaleDateString("en-US", { dateStyle: "long" }),
                });
              }
            } catch (emailErr) {
              console.error("[Stripe webhook] Payment receipt email failed:", emailErr);
            }
          } catch (err) {
            console.error("[Stripe webhook] creditWallet error:", err);
            return new Response("Wallet update failed", { status: 500 });
          }
        }

        // Mid-call top-up via PaymentIntent
        if (event.type === "payment_intent.succeeded") {
          const intent = event.data.object as import("stripe").Stripe.PaymentIntent;
          if (intent.metadata?.source === "mid_call_topup") {
            const userId = intent.metadata?.user_id;
            const seconds = parseInt(intent.metadata?.seconds ?? "0", 10);
            const label = intent.metadata?.label ?? "Top-up";
            const amountCents = intent.amount_received ?? 0;
            const sessionId = intent.metadata?.session_id;

            if (!userId || !seconds) {
              console.error("[Stripe webhook] Top-up missing metadata:", intent.metadata);
              return new Response("Top-up missing metadata", { status: 500 });
            }

            try {
              await creditWallet(userId, seconds, amountCents, intent.id, label);

              if (sessionId) {
                const { error: capErr } = await supabaseAdmin.rpc("extend_session_billing_cap", {
                  p_session_id: sessionId,
                  p_seconds: seconds,
                });
                if (capErr) {
                  console.error("[Stripe webhook] extend_session_billing_cap error:", capErr);
                  return new Response("Session cap extension failed", { status: 500 });
                }
              }
            } catch (err) {
              console.error("[Stripe webhook] Top-up creditWallet error:", err);
              return new Response("Top-up wallet update failed", { status: 500 });
            }
          }
        }

        return new Response(JSON.stringify({ received: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
