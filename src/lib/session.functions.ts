// Server functions for session lifecycle and billing.
// All wallet mutations happen server-side via the service role to bypass RLS.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import { computeTopUpSeconds } from "@/lib/billing-utils";
import { hasPlatformStaffRole, resolveWalletAccess } from "@/lib/billing-guard";
import type { CallDirection, CallOutcome } from "@/lib/call-history";

async function fetchWalletBalance(userId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("balance_seconds, unlimited_until, trial_code_id")
    .eq("user_id", userId)
    .maybeSingle();
  const access = await resolveWalletAccess(userId, data);
  return access.balanceSeconds;
}

const RING_TIMEOUT_MS = 45_000;
// Safety net for a session that connected and then never got a proper
// hang-up signal from either client (app killed by iOS, crash, force-quit,
// both sides closing at once mid-test). Generous enough to never interrupt
// a genuinely long real call, short enough to self-recover same-day instead
// of blocking that client from calling at all until someone fixes it by hand.
const ABANDONED_CONNECTED_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Clear abandoned ringing/connected sessions so a stuck one does not block the next call. */
async function releaseStaleClientSessions(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  clientId: string,
) {
  const { data: activeSessions } = await supabaseAdmin
    .from("sessions")
    .select("id, connected_at, started_at")
    .eq("client_id", clientId)
    .eq("status", "active");

  for (const session of activeSessions ?? []) {
    if (session.connected_at) {
      const connectedAgeMs = Date.now() - new Date(session.connected_at).getTime();
      if (connectedAgeMs <= ABANDONED_CONNECTED_TIMEOUT_MS) {
        throw new Error("You already have an active call. End it before starting another.");
      }
      // Abandoned rather than genuinely still ongoing — release it. Doesn't
      // attempt to bill the unknown actual usage; see the RPC for why.
      await supabaseAdmin.rpc("cancel_abandoned_connected_session", {
        p_session_id: session.id,
        p_actor_id: clientId,
      });
      continue;
    }

    const ageMs = Date.now() - new Date(session.started_at).getTime();
    if (ageMs <= RING_TIMEOUT_MS) {
      throw new Error("You already have a call ringing. Wait a moment and try again.");
    }

    await supabaseAdmin.rpc("cancel_session_before_connect", {
      p_session_id: session.id,
      p_actor_id: clientId,
    });
  }
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

    const [{ data: isPatPal }, { data: pal }, { data: wallet }, isPlatformStaff] =
      await Promise.all([
        supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "pat_pal" }),
        supabaseAdmin
          .from("pat_pals")
          .select("user_id, price_cents_per_minute")
          .eq("user_id", data.palId)
          .maybeSingle(),
        supabaseAdmin
          .from("wallets")
          .select("balance_seconds, unlimited_until, trial_code_id")
          .eq("user_id", userId)
          .maybeSingle(),
        hasPlatformStaffRole(userId),
      ]);

    if (isPatPal && !isPlatformStaff) {
      throw new Error(
        "Pat Pal accounts cannot start client calls. Use a client account, or redeem your code after signing up as a client.",
      );
    }

    if (!pal) {
      throw new Error("Pat Pal not found.");
    }

    const { balanceSeconds, isUnlimited, canStartCall } = await resolveWalletAccess(userId, wallet);
    const priceCentsPerMin = pal.price_cents_per_minute ?? 0;

    if (!canStartCall) {
      throw new Error(
        "Insufficient balance. Redeem your trial code on Wallet, or top up to start a call.",
      );
    }

    await releaseStaleClientSessions(supabaseAdmin, userId);

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .insert({
        client_id: userId,
        pal_id: data.palId,
        initiated_by: userId,
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
        throw new Error(
          "You already have an active session. Wait a minute and try again, or refresh the page.",
        );
      }
      throw new Error("Could not create session record.");
    }
    if (!session) throw new Error("Could not create session record.");

    if (data.kind === "audio" || data.kind === "video") {
      const { sendIncomingCallPush } = await import("@/lib/push.functions");
      void sendIncomingCallPush({
        sessionId: session.id,
        recipientId: data.palId,
        callerId: userId,
        kind: data.kind,
        conversationId: data.conversationId ?? null,
      }).catch((err) => {
        console.error("[startSession] incoming call push failed:", err);
      });
    }

    return {
      sessionId: session.id,
      balanceSeconds: isUnlimited ? 999999 : balanceSeconds,
      isUnlimited,
      priceCentsPerMin,
    };
  });

// ─── Start callback session (Pat Pal calling a client back) ──────────────────
// Lets a Pat Pal re-initiate a call within an existing conversation — e.g. to
// call the client back after a drop — while still billing the client's
// wallet, same as if the client had called. Requires an existing
// conversation between the two (a Pat Pal cannot cold-call an arbitrary
// client this way).
export const startCallbackSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        kind: z.enum(["audio", "video", "chat"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("client_id, pal_id")
      .eq("id", data.conversationId)
      .maybeSingle();

    if (!convo) throw new Error("Conversation not found.");
    if (convo.pal_id !== userId) {
      throw new Error("You are not the Pat Pal on this conversation.");
    }
    if (convo.client_id === userId) {
      throw new Error("You cannot start a session with yourself.");
    }

    const clientId = convo.client_id;

    const [{ data: pal }, { data: wallet }] = await Promise.all([
      supabaseAdmin
        .from("pat_pals")
        .select("user_id, price_cents_per_minute")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("wallets")
        .select("balance_seconds, unlimited_until, trial_code_id")
        .eq("user_id", clientId)
        .maybeSingle(),
    ]);

    if (!pal) throw new Error("Pat Pal profile not found.");

    const { balanceSeconds, isUnlimited, canStartCall } = await resolveWalletAccess(
      clientId,
      wallet,
    );
    const priceCentsPerMin = pal.price_cents_per_minute ?? 0;

    if (!canStartCall) {
      throw new Error("The client doesn't have enough balance right now for a call back.");
    }

    await releaseStaleClientSessions(supabaseAdmin, clientId);

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .insert({
        client_id: clientId,
        pal_id: userId,
        initiated_by: userId,
        conversation_id: data.conversationId,
        kind: data.kind,
        status: "active",
        price_cents_per_minute: priceCentsPerMin,
        remaining_seconds_at_start: isUnlimited ? 999999 : balanceSeconds,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error("The client already has an active session. Wait a minute and try again.");
      }
      throw new Error("Could not create session record.");
    }
    if (!session) throw new Error("Could not create session record.");

    if (data.kind === "audio" || data.kind === "video") {
      const { sendIncomingCallPush } = await import("@/lib/push.functions");
      void sendIncomingCallPush({
        sessionId: session.id,
        recipientId: clientId,
        callerId: userId,
        kind: data.kind,
        conversationId: data.conversationId,
      }).catch((err) => {
        console.error("[startCallbackSession] incoming call push failed:", err);
      });
    }

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until, trial_code_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    return resolveWalletAccess(context.userId, data);
  });

// ─── Decline incoming call (Pat Pal — before connecting) ─────────────────────
export const declineIncomingCall = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        // "declined" (explicit tap) is the default so existing callers keep
        // working; the ring-timeout path passes "no_answer" so a call
        // nobody acted on doesn't show up in history as rejected.
        reason: z.enum(["declined", "no_answer"]).optional().default("declined"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id, pal_id, initiated_by")
      .eq("id", data.sessionId)
      .single();

    // Declining is a callee action — the callee is whichever participant
    // did NOT initiate the session (either party can now be the initiator:
    // a client calling a Pat Pal, or a Pat Pal calling a client back).
    const isParticipant =
      !!session && (session.client_id === context.userId || session.pal_id === context.userId);
    if (!session || !isParticipant || session.initiated_by === context.userId) {
      throw new Error("Session not found or access denied.");
    }

    const { error } = await supabaseAdmin.rpc("cancel_session_before_connect", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
      p_end_reason: data.reason,
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
      .select("balance_seconds, unlimited_until, trial_code_id")
      .eq("user_id", session.client_id)
      .maybeSingle();

    const { balanceSeconds, isUnlimited } = await resolveWalletAccess(session.client_id, wallet);

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

/** Staff-only: add 3 or 5 free minutes to the current call, once. */
export const grantComplimentaryMinutes = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        minutes: z.union([z.literal(3), z.literal(5)]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: seconds, error } = await supabaseAdmin.rpc("grant_complimentary_minutes", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
      p_minutes: data.minutes,
    });
    if (error) throw new Error(error.message);
    return { seconds: Number(seconds ?? data.minutes * 60), minutes: data.minutes };
  });

// ─── Cancel session without billing (caller hang-up before connect) ──────────
export const cancelSession = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("initiated_by")
      .eq("id", data.sessionId)
      .single();

    // Only the initiator can cancel their own not-yet-connected outgoing
    // call — that's the client for a normal call, or the Pat Pal for a
    // callback.
    if (!session || session.initiated_by !== context.userId) {
      throw new Error("Session not found or access denied.");
    }

    const { error } = await supabaseAdmin.rpc("cancel_session_before_connect", {
      p_session_id: data.sessionId,
      p_actor_id: context.userId,
      p_end_reason: "no_answer",
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Call history ──────────────────────────────────────────────────────────
export type CallHistoryRow = {
  id: string;
  conversationId: string | null;
  otherId: string;
  otherName: string;
  otherAvatarUrl: string | null;
  otherIsPal: boolean;
  kind: "audio" | "video";
  direction: CallDirection;
  outcome: CallOutcome;
  startedAt: string;
  durationSeconds: number;
};

export const listCallHistory = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }): Promise<{ calls: CallHistoryRow[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCallDirection, getCallDurationSeconds, getCallOutcome, getOtherParticipantId } =
      await import("@/lib/call-history");

    const { data, error } = await supabaseAdmin
      .from("sessions")
      .select(
        "id, conversation_id, client_id, pal_id, initiated_by, kind, status, started_at, connected_at, ended_at, seconds_used, end_reason",
      )
      .or(`client_id.eq.${context.userId},pal_id.eq.${context.userId}`)
      .in("kind", ["audio", "video"])
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const otherIds = [
      ...new Set(rows.map((r) => (r.client_id === context.userId ? r.pal_id : r.client_id))),
    ];

    const [{ data: profiles }, { data: pals }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, avatar_url").in("id", otherIds),
      supabaseAdmin.from("pat_pals").select("user_id").in("user_id", otherIds),
    ]);
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name?.trim() || "Pat My Back user"]),
    );
    const avatarById = new Map((profiles ?? []).map((p) => [p.id, p.avatar_url]));
    const palIds = new Set((pals ?? []).map((p) => p.user_id));

    return {
      calls: rows.map((r) => {
        const session = {
          id: r.id,
          conversation_id: r.conversation_id,
          client_id: r.client_id,
          pal_id: r.pal_id,
          initiated_by: r.initiated_by,
          kind: r.kind as "audio" | "video",
          status: r.status,
          started_at: r.started_at,
          connected_at: r.connected_at,
          ended_at: r.ended_at,
          seconds_used: r.seconds_used,
          end_reason: r.end_reason,
        } as const;
        const otherId = getOtherParticipantId(session, context.userId);
        return {
          id: r.id,
          conversationId: r.conversation_id,
          otherId,
          otherName: nameById.get(otherId) || "Pat My Back user",
          otherAvatarUrl: avatarById.get(otherId) ?? null,
          otherIsPal: palIds.has(otherId),
          kind: r.kind as "audio" | "video",
          direction: getCallDirection(session, context.userId),
          outcome: getCallOutcome(session, context.userId),
          startedAt: r.started_at,
          durationSeconds: getCallDurationSeconds(session),
        };
      }),
    };
  });
