// Server functions for session lifecycle and billing.
// All wallet mutations happen server-side via the service role to bypass RLS.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import { computeTopUpSeconds } from "@/lib/billing-utils";
import { hasPlatformStaffRole, walletHasUnlimitedAccess } from "@/lib/billing-guard";

async function fetchWalletBalance(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data }, isPlatformStaff] = await Promise.all([
    supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until")
      .eq("user_id", userId)
      .single(),
    hasPlatformStaffRole(userId),
  ]);
  const isUnlimited = walletHasUnlimitedAccess(data?.unlimited_until, isPlatformStaff);
  return isUnlimited ? 999999 : (data?.balance_seconds ?? 0);
}

// ─── Start session ────────────────────────────────────────────────────────────
// Only clients may start paid sessions.
export const startSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        palId: z.string().uuid(),
        conversationId: z.string().uuid().optional(),
        kind: z.enum(["audio", "video", "chat"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    if (userId === data.palId) {
      throw new Error("You cannot start a session with yourself.");
    }

    const [{ data: isPatPal }, { data: pal }, { data: wallet }, isPlatformStaff] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "pat_pal" }),
      supabaseAdmin
        .from("pat_pals")
        .select("user_id, price_cents_per_minute, availability, is_team")
        .eq("user_id", data.palId)
        .maybeSingle(),
      supabaseAdmin
        .from("wallets")
        .select("balance_seconds, unlimited_until")
        .eq("user_id", userId)
        .single(),
      hasPlatformStaffRole(userId),
    ]);

    if (isPatPal) {
      throw new Error("Only clients can initiate paid sessions.");
    }

    if (!pal) {
      throw new Error("Pat Pal not found.");
    }

    if (pal.availability !== "available" && !pal.is_team) {
      throw new Error("This Pat Pal is not available right now. Try again later.");
    }

    const balanceSeconds = wallet?.balance_seconds ?? 0;
    const isUnlimited = walletHasUnlimitedAccess(wallet?.unlimited_until, isPlatformStaff);
    const priceCentsPerMin = pal.price_cents_per_minute ?? 0;

    if (isPlatformStaff && balanceSeconds < 60) {
      throw new Error("Insufficient balance. Admin accounts must top up the wallet to place calls.");
    }

    if (!isUnlimited && balanceSeconds < 60) {
      throw new Error("Insufficient balance. Please top up your wallet.");
    }

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

    if (error) {
      if (error.code === "23505") {
        throw new Error("You already have an active session. End it before starting another.");
      }
      throw new Error("Could not create session record.");
    }
    if (!session) throw new Error("Could not create session record.");

    return {
      sessionId: session.id,
      balanceSeconds: isUnlimited ? 999999 : balanceSeconds,
      isUnlimited,
      priceCentsPerMin,
    };
  });

// ─── Mark session connected (billing clock starts) ───────────────────────────
export const markSessionConnected = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("mark_session_connected", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── End session (client or pal may finalize billing) ────────────────────────
export const endSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id, pal_id, status, kind, seconds_used, cost_cents")
      .eq("id", data.sessionId)
      .single();

    if (!session || (session.client_id !== userId && session.pal_id !== userId)) {
      throw new Error("Session not found or access denied.");
    }

    if (session.status === "ended" || session.status === "cancelled") {
      const newBalance = await fetchWalletBalance(session.client_id);
      return {
        ok: true,
        secondsUsed: session.seconds_used ?? 0,
        costCents: session.cost_cents ?? 0,
        newBalance,
      };
    }

    const clientId = session.client_id;
    const note = "Session ended";

    const { data: billingRows, error: billingError } = await supabaseAdmin.rpc(
      "end_session_billing",
      {
        p_session_id: data.sessionId,
        p_actor_id: userId,
        p_seconds: 0,
        p_cost_cents: 0,
        p_note: note,
      },
    );

    if (billingError) throw new Error(billingError.message);

    const newBalance = billingRows?.[0]?.new_balance ?? 0;

    const { data: endedSession } = await supabaseAdmin
      .from("sessions")
      .select("seconds_used, cost_cents")
      .eq("id", data.sessionId)
      .single();

    const secondsUsed = endedSession?.seconds_used ?? 0;
    const costCents = endedSession?.cost_cents ?? 0;

    (async () => {
      try {
        const [authRes, clientProfile, palProfile] = await Promise.all([
          supabaseAdmin.auth.admin.getUserById(clientId),
          supabaseAdmin.from("profiles").select("full_name").eq("id", clientId).single(),
          supabaseAdmin.from("profiles").select("full_name").eq("id", session.pal_id).single(),
        ]);

        const email = authRes.data?.user?.email;
        if (!email || secondsUsed <= 0) return;

        const { sendSessionSummary } = await import("@/lib/email.server");
        await sendSessionSummary({
          to: email,
          name: clientProfile.data?.full_name || "there",
          palName: palProfile.data?.full_name || "your Pat Pal",
          kind: session.kind ?? "audio",
          durationMinutes: Math.round(secondsUsed / 60),
          costDollars: (costCents / 100).toFixed(2),
          remainingMinutes: Math.round(newBalance / 60),
          date: new Date().toLocaleDateString("en-US", { dateStyle: "long" }),
        });
      } catch (err) {
        console.error("[endSession] Session summary email failed:", err);
      }
    })();

    return { ok: true, newBalance, costCents, secondsUsed };
  });

// ─── Mid-call top-up (Stripe Payment Intent) ─────────────────────────────────
export const createTopUpIntent = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        cents: z.number().int().min(500).max(50000),
        sessionId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { stripe } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    if (data.sessionId) {
      const { data: session } = await supabaseAdmin
        .from("sessions")
        .select("client_id, status")
        .eq("id", data.sessionId)
        .single();

      if (!session || session.client_id !== userId || session.status !== "active") {
        throw new Error("Invalid or inactive session for top-up.");
      }
    }

    const ratePerMinCents = 1000 / 15;
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
        ...(data.sessionId ? { session_id: data.sessionId } : {}),
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
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const balanceSeconds = await fetchWalletBalance(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [isPlatformStaff, { data }] = await Promise.all([
      hasPlatformStaffRole(context.userId),
      supabaseAdmin
        .from("wallets")
        .select("unlimited_until")
        .eq("user_id", context.userId)
        .single(),
    ]);

    const isUnlimited = walletHasUnlimitedAccess(data?.unlimited_until, isPlatformStaff);

    return { balanceSeconds, isUnlimited };
  });

// ─── Decline incoming call (Pat Pal — before connecting) ─────────────────────
export const declineIncomingCall = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("pal_id")
      .eq("id", data.sessionId)
      .single();

    if (!session || session.pal_id !== context.userId) {
      throw new Error("Session not found or access denied.");
    }

    const { error } = await supabaseAdmin.rpc("cancel_session_before_connect", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Active session billing snapshot (for mid-call top-up polling) ─────────────
export const getActiveSessionBilling = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id, pal_id, status, remaining_seconds_at_start, connected_at")
      .eq("id", data.sessionId)
      .single();

    if (!session || (session.client_id !== userId && session.pal_id !== userId)) {
      throw new Error("Session not found or access denied.");
    }

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until")
      .eq("user_id", session.client_id)
      .single();

    const isPlatformStaff = await hasPlatformStaffRole(session.client_id);
    const isUnlimited = walletHasUnlimitedAccess(wallet?.unlimited_until, isPlatformStaff);
    const balanceSeconds = isUnlimited ? 999999 : (wallet?.balance_seconds ?? 0);

    let billableSecondsRemaining = session.remaining_seconds_at_start ?? 0;
    if (session.connected_at) {
      const used = Math.floor((Date.now() - new Date(session.connected_at).getTime()) / 1000);
      billableSecondsRemaining = Math.max(0, billableSecondsRemaining - used);
    }

    return {
      balanceSeconds,
      isUnlimited,
      billableSecondsRemaining,
      isConnected: !!session.connected_at,
      status: session.status,
    };
  });

// ─── Cancel session without billing (caller hang-up before connect) ──────────
export const cancelSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id")
      .eq("id", data.sessionId)
      .single();

    if (!session || session.client_id !== context.userId) {
      throw new Error("Session not found or access denied.");
    }

    const { error } = await supabaseAdmin.rpc("cancel_session_before_connect", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });
