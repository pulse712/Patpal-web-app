// Client-safe push subscription server functions (no web-push import).
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => subscriptionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        { user_id: userId, endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth },
        { onConflict: "user_id,endpoint" },
      );

    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
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
