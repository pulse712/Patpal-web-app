// Server-only push delivery — never import from client code.
export async function sendPushToUser(
  targetUserId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL ?? "mailto:admin@patmyback.com";

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
