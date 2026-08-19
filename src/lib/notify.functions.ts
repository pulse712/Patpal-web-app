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

    if (!recipientId || recipientId === userId) return { ok: false };

    await sendPushToUser(recipientId, {
      title: `New message from ${senderName}`,
      body: data.preview,
      url: `/chat/${data.conversationId}`,
      tag: `msg-${data.conversationId}`,
      senderId: userId,
    });

    return { ok: true };
  });

// ─── Notify on incoming call ───────────────────────────────────────────────
export const notifyIncomingCall = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        recipientId: z.string().uuid(),
        kind: z.enum(["audio", "video"]),
        conversationId: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUser } = await import("@/lib/push.functions");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, client_id, pal_id, status, kind, conversation_id")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (!session || session.status !== "active") {
      throw new Error("Unauthorized: no active call session.");
    }
    if (session.client_id !== userId) {
      throw new Error("Unauthorized: only the caller may notify.");
    }
    if (session.pal_id !== data.recipientId) {
      throw new Error("Unauthorized: recipient does not match session.");
    }
    if (session.kind !== data.kind) {
      throw new Error("Unauthorized: call kind mismatch.");
    }
    if (data.conversationId && session.conversation_id !== data.conversationId) {
      throw new Error("Unauthorized: conversation mismatch.");
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();

    const callerName = callerProfile?.full_name?.trim() || "Someone";
    const url = data.conversationId
      ? `/chat/${data.conversationId}?call=${data.kind}`
      : `/home?incomingSession=${data.sessionId}&call=${data.kind}`;

    await sendPushToUser(data.recipientId, {
      title: data.kind === "video" ? "Incoming video call" : "Incoming voice call",
      body: `${callerName} is calling you — tap to answer`,
      url,
      tag: `call-${data.sessionId}`,
      requireInteraction: true,
    });

    return { ok: true };
  });
