// Server functions that trigger push notifications for specific events.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

// ─── Notify on new message ─────────────────────────────────────────────────
export const notifyNewMessage = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        preview: z.string().max(100),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUser } = await import("@/lib/push.functions");
    const { userId } = context;

    const { data: convo } = await supabaseAdmin
      .from("conversations")
      .select("client_id, pal_id")
      .eq("id", data.conversationId)
      .single();

    if (!convo) return { ok: false };

    if (userId !== convo.client_id && userId !== convo.pal_id) {
      throw new Error("Unauthorized: not a conversation participant.");
    }

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();

    const senderName = senderProfile?.full_name?.trim() || "Someone";
    const recipientId = userId === convo.client_id ? convo.pal_id : convo.client_id;

    await sendPushToUser(recipientId, {
      title: `New message from ${senderName}`,
      body: data.preview,
      url: `/chat/${data.conversationId}`,
      tag: `msg-${data.conversationId}`,
    });

    return { ok: true };
  });

// ─── Notify on incoming call ───────────────────────────────────────────────
export const notifyIncomingCall = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        recipientId: z.string().uuid(),
        callerName: z.string().max(100).optional(),
        kind: z.enum(["audio", "video"]),
        channelName: z.string().uuid(),
        conversationId: z.string().uuid().optional(),
        sessionId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUser } = await import("@/lib/push.functions");
    const { userId } = context;

    let sessionQuery = supabaseAdmin
      .from("sessions")
      .select("id, client_id, pal_id, status")
      .eq("status", "active");

    if (data.sessionId) {
      sessionQuery = sessionQuery.eq("id", data.sessionId);
    } else if (data.conversationId) {
      sessionQuery = sessionQuery.eq("conversation_id", data.conversationId);
    } else {
      const { data: byId } = await supabaseAdmin
        .from("sessions")
        .select("id, client_id, pal_id, status")
        .eq("status", "active")
        .eq("id", data.channelName)
        .maybeSingle();

      const { data: byConvo } = byId
        ? { data: null }
        : await supabaseAdmin
            .from("sessions")
            .select("id, client_id, pal_id, status")
            .eq("status", "active")
            .eq("conversation_id", data.channelName)
            .maybeSingle();

      const session = byId ?? byConvo;
      if (!session || session.client_id !== userId || session.pal_id !== data.recipientId) {
        throw new Error("Unauthorized: no active call session for this recipient.");
      }

      const { data: callerProfile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .single();

      const callerName = data.callerName?.trim() || callerProfile?.full_name?.trim() || "Someone";
      const url = data.conversationId ? `/chat/${data.conversationId}?call=${data.kind}` : "/";

      await sendPushToUser(data.recipientId, {
        title: `Incoming ${data.kind} call`,
        body: `${callerName} is calling you`,
        url,
        tag: `call-${data.channelName}`,
      });

      return { ok: true };
    }

    const { data: session } = await sessionQuery.maybeSingle();

    if (!session || session.client_id !== userId || session.pal_id !== data.recipientId) {
      throw new Error("Unauthorized: no active call session for this recipient.");
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();

    const callerName = data.callerName?.trim() || callerProfile?.full_name?.trim() || "Someone";
    const url = data.conversationId ? `/chat/${data.conversationId}?call=${data.kind}` : "/";

    await sendPushToUser(data.recipientId, {
      title: `Incoming ${data.kind} call`,
      body: `${callerName} is calling you`,
      url,
      tag: `call-${data.channelName}`,
    });

    return { ok: true };
  });
