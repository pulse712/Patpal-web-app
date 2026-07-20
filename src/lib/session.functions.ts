// Server functions for session lifecycle and billing.
// All wallet mutations happen server-side via the service role to bypass RLS.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  computeDebitedBalance,
  computeSessionCostCents,
  computeTopUpSeconds,
} from "@/lib/billing-utils";

// ─── Start session ────────────────────────────────────────────────────────────
// Creates a session record and returns the client's current balance.
export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      palId: z.string().uuid(),
      conversationId: z.string().uuid().optional(),
      kind: z.enum(["audio", "video", "chat"]),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // Fetch wallet balance and pal price
    const [{ data: wallet }, { data: pal }] = await Promise.all([
      supabaseAdmin.from("wallets").select("balance_seconds, unlimited_until").eq("user_id", userId).single(),
      supabaseAdmin.from("pat_pals").select("price_cents_per_minute").eq("user_id", data.palId).single(),
    ]);

    const balanceSeconds = wallet?.balance_seconds ?? 0;
    const isUnlimited = wallet?.unlimited_until
      ? new Date(wallet.unlimited_until) > new Date()
      : false;
    const priceCentsPerMin = pal?.price_cents_per_minute ?? 0;

    if (!isUnlimited && balanceSeconds < 60) {
      throw new Error("Insufficient balance. Please top up your wallet.");
    }

    // Create session record
    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .insert({
        client_id: userId,
        pal_id: data.palId,
        conversation_id: data.conversationId ?? null,
        kind: data.kind,
        status: "active",
        price_cents_per_minute: priceCentsPerMin,
        remaining_seconds_at_start: isUnlimited ? 999999 : balanceSeconds,
      })
      .select("id")
      .single();

    if (error || !session) throw new Error("Could not create session record.");

    return {
      sessionId: session.id,
      balanceSeconds: isUnlimited ? 999999 : balanceSeconds,
      isUnlimited,
      priceCentsPerMin,
    };
  });

// ─── End session ─────────────────────────────────────────────────────────────
// Debits the wallet and marks the session ended.
export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      secondsUsed: z.number().int().nonnegative(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // Fetch session to get price and verify ownership
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id, pal_id, price_cents_per_minute, status, kind")
      .eq("id", data.sessionId)
      .single();

    if (!session || session.client_id !== userId) {
      throw new Error("Session not found or access denied.");
    }
    if (session.status === "ended") return { ok: true }; // idempotent

    const costCents = computeSessionCostCents(data.secondsUsed, session.price_cents_per_minute);

    // Fetch current wallet
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until")
      .eq("user_id", userId)
      .single();

    const isUnlimited = wallet?.unlimited_until
      ? new Date(wallet.unlimited_until) > new Date()
      : false;
    const currentBalance = wallet?.balance_seconds ?? 0;
    const newBalance = computeDebitedBalance(currentBalance, data.secondsUsed, isUnlimited);

    // Update wallet, end session, insert debit tx — all in parallel
    await Promise.all([
      isUnlimited
        ? Promise.resolve()
        : supabaseAdmin
            .from("wallets")
            .update({ balance_seconds: newBalance, updated_at: new Date().toISOString() })
            .eq("user_id", userId),

      supabaseAdmin
        .from("sessions")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          seconds_used: data.secondsUsed,
          cost_cents: costCents,
        })
        .eq("id", data.sessionId),

      isUnlimited
        ? Promise.resolve()
        : supabaseAdmin.from("credit_transactions").insert({
            user_id: userId,
            kind: "debit",
            seconds_delta: -data.secondsUsed,
            cents_amount: costCents,
            session_id: data.sessionId,
            note: `Session ended — ${Math.round(data.secondsUsed / 60)}m used`,
          }),
    ]);

    // Send session summary email (best-effort, don't block the response)
    (async () => {
      try {
        const [authRes, clientProfile, palProfile] = await Promise.all([
          supabaseAdmin.auth.admin.getUserById(userId),
          supabaseAdmin.from("profiles").select("full_name").eq("id", userId).single(),
          supabaseAdmin.from("profiles").select("full_name").eq("id", session.pal_id).single(),
        ]);

        const email = authRes.data?.user?.email;
        if (!email) return;

        const { sendSessionSummary } = await import("@/lib/email.server");
        await sendSessionSummary({
          to: email,
          name: clientProfile.data?.full_name || "there",
          palName: palProfile.data?.full_name || "your Pat Pal",
          kind: session.kind ?? "audio",
          durationMinutes: Math.round(data.secondsUsed / 60),
          costDollars: (costCents / 100).toFixed(2),
          remainingMinutes: Math.round(newBalance / 60),
          date: new Date().toLocaleDateString("en-US", { dateStyle: "long" }),
        });
      } catch (err) {
        console.error("[endSession] Session summary email failed:", err);
      }
    })();

    return { ok: true, newBalance, costCents };
  });

// ─── Mid-call top-up (Stripe Payment Intent) ─────────────────────────────────
// Creates a PaymentIntent and returns client_secret for in-call top-up.
// On confirmation the webhook credits the wallet (same as checkout webhook).
export const createTopUpIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      cents: z.number().int().min(500), // min $5
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { stripe } = await import("@/lib/stripe.server");
    const { userId } = context;

    const ratePerMinCents = 1000 / 15; // $10 per 15 min
    const seconds = computeTopUpSeconds(data.cents, ratePerMinCents);

    const intent = await (stripe as import("stripe").default).paymentIntents.create({
      amount: data.cents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        user_id: userId,
        seconds: String(seconds),
        label: `Top-up (${Math.round(seconds / 60)} min)`,
        source: "mid_call_topup",
      },
    });

    return {
      clientSecret: intent.client_secret!,
      seconds,
      amountCents: data.cents,
    };
  });

// ─── Fetch wallet balance ──────────────────────────────────────────────────────
export const getWalletBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data } = await supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until")
      .eq("user_id", userId)
      .single();

    const isUnlimited = data?.unlimited_until
      ? new Date(data.unlimited_until) > new Date()
      : false;

    return {
      balanceSeconds: isUnlimited ? 999999 : (data?.balance_seconds ?? 0),
      isUnlimited,
    };
  });

// ─── Decline incoming call (Pat Pal) ─────────────────────────────────────────
export const declineIncomingCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("pal_id, status")
      .eq("id", data.sessionId)
      .single();

    if (!session || session.pal_id !== userId) {
      throw new Error("Session not found or access denied.");
    }
    if (session.status !== "active") return { ok: true };

    await supabaseAdmin
      .from("sessions")
      .update({
        status: "cancelled",
        ended_at: new Date().toISOString(),
        seconds_used: 0,
        cost_cents: 0,
      })
      .eq("id", data.sessionId);

    return { ok: true };
  });
