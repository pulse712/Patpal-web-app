// Server functions that trigger push notifications for specific events.
// Import sendPushToUser directly — it's not a server fn itself (internal only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ─── Notify on new message ─────────────────────────────────────────────────
export const notifyNewMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      conversationId: z.string().uuid(),
      senderName: z.string(),
      preview: z.string().max(100),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUser } = await import("@/lib/push.functions");
    const { userId } = context;

    // Find the other party in this conversation
    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("client_id, pal_id")
      .eq("id", data.conversationId)
      .single();

    if (!convo) return { ok: false };

    const recipientId = convo.client_id === userId ? convo.pal_id : convo.client_id;

    await sendPushToUser(recipientId, {
      title: `New message from ${data.senderName}`,
      body: data.preview,
      url: `/chat/${data.conversationId}`,
      tag: `msg-${data.conversationId}`,
    });

    return { ok: true };
  });

// ─── Notify on incoming call ───────────────────────────────────────────────
export const notifyIncomingCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      recipientId: z.string().uuid(),
      callerName: z.string(),
      kind: z.enum(["audio", "video"]),
      channelName: z.string(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { sendPushToUser } = await import("@/lib/push.functions");

    await sendPushToUser(data.recipientId, {
      title: `Incoming ${data.kind} call`,
      body: `${data.callerName} is calling you`,
      url: `/`,
      tag: `call-${data.channelName}`,
    });

    return { ok: true };
  });
