// Server-only push delivery — never import from client code.

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
};

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

export async function sendPushToUser(targetUserId: string, payload: PushPayload) {
  const vapidPublic = readEnv("VAPID_PUBLIC_KEY") ?? readEnv("VITE_VAPID_PUBLIC_KEY");
  const vapidPrivate = readEnv("VAPID_PRIVATE_KEY");
  const vapidEmail = readEnv("VAPID_EMAIL") ?? "mailto:admin@patmyback.com";

  if (!vapidPublic || !vapidPrivate) {
    console.warn("[Push] VAPID keys not configured — skipping push.");
    return;
  }

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", targetUserId);

  if (!subs || subs.length === 0) return;

  const json = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        );
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "statusCode" in err &&
          (err as { statusCode: number }).statusCode === 410
        ) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error("[Push] sendNotification error:", err);
        }
      }
    }),
  );
}

/** Notify the call recipient (client or Pat Pal) on all registered browsers/devices (Web Push). */
export async function sendIncomingCallPush(opts: {
  sessionId: string;
  recipientId: string;
  callerId: string;
  kind: "audio" | "video";
  conversationId: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", opts.callerId)
    .maybeSingle();

  const callerName = profile?.full_name?.trim() || "Someone";
  const url = opts.conversationId
    ? `/chat/${opts.conversationId}?call=${opts.kind}`
    : `/home?incomingSession=${opts.sessionId}&call=${opts.kind}`;

  await sendPushToUser(opts.recipientId, {
    title: opts.kind === "video" ? "Incoming video call" : "Incoming voice call",
    body: `${callerName} is calling you — tap to answer`,
    url,
    tag: `call-${opts.sessionId}`,
    requireInteraction: true,
  });
}
