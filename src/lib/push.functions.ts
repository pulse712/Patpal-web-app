// Server functions for Web Push notifications.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
});

// ─── Save subscription ─────────────────────────────────────────────────────
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => subscriptionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // Upsert — same endpoint may re-subscribe with new keys
    await supabaseAdmin.from("push_subscriptions").upsert(
      { user_id: userId, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth },
      { onConflict: "user_id,endpoint" },
    );

    return { ok: true };
  });

// ─── Remove subscription ───────────────────────────────────────────────────
export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ endpoint: z.string() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint);

    return { ok: true };
  });

// ─── Send push to a user (internal — called from other server functions) ────
// Not exposed as a public endpoint; import directly in server-only code.
export async function sendPushToUser(
  targetUserId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL ?? "mailto:admin@patmyback.com";

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
        // 410 Gone = subscription expired, clean it up
        if (
          err &&
          typeof err === "object" &&
          "statusCode" in err &&
          (err as { statusCode: number }).statusCode === 410
        ) {
          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        } else {
          console.error("[Push] sendNotification error:", err);
        }
      }
    }),
  );
}
