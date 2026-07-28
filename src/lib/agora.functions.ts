// Server function to generate an Agora RTC token.
// Token is only issued when the caller is a participant in an active session.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

const tokenSchema = z.object({
  channelName: z.string().uuid(),
});

/** Deterministic Agora UID from user ID — avoids client-controlled collisions. */
function agoraUidFromUserId(userId: string): number {
  const hex = userId.replace(/-/g, "").slice(0, 8);
  return (parseInt(hex, 16) % 2_147_483_646) + 1;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAgoraAppCertificate, requireAgoraAppId } from "@/lib/agora-server-env";

async function findActiveSessionForChannel(
  supabaseAdmin: SupabaseClient<Database>,
  channelName: string,
  userId: string,
) {
  const { data: byId } = await supabaseAdmin
    .from("sessions")
    .select("id, client_id, pal_id, conversation_id")
    .eq("status", "active")
    .eq("id", channelName)
    .maybeSingle();

  if (byId && (byId.client_id === userId || byId.pal_id === userId)) {
    return byId;
  }

  const { data: byConvo } = await supabaseAdmin
    .from("sessions")
    .select("id, client_id, pal_id, conversation_id")
    .eq("status", "active")
    .eq("conversation_id", channelName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byConvo && (byConvo.client_id === userId || byConvo.pal_id === userId)) {
    return byConvo;
  }

  return null;
}

export const getAgoraToken = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const session = await findActiveSessionForChannel(supabaseAdmin, data.channelName, userId);

    if (!session) {
      throw new Error("No active session found for this channel.");
    }

    const uid = agoraUidFromUserId(userId);
    const appId = requireAgoraAppId();
    const appCertificate = getAgoraAppCertificate();
    const isProd = process.env["NODE_ENV"] === "production";
    const allowUnsecure =
      process.env["AGORA_ALLOW_UNSECURE"] === "true" ||
      appCertificate === "TESTING_NO_CERT";
    const missingCert = !appCertificate || appCertificate === "TESTING_NO_CERT";

    if (isProd && missingCert && !allowUnsecure) {
      throw new Error(
        "Agora certificate is required in production. Add AGORA_APP_CERTIFICATE from console.agora.io, or set AGORA_APP_CERTIFICATE=TESTING_NO_CERT if your Agora project uses App ID only mode.",
      );
    }

    if (missingCert) {
      return { token: null, appId, channelName: data.channelName, uid };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { RtcTokenBuilder, RtcRole } = (await import("agora-token")) as any;

    const tokenTtlSeconds = 3600;
    const token = RtcTokenBuilder.buildTokenWithUidAndPrivilege(
      appId,
      appCertificate,
      data.channelName,
      uid,
      tokenTtlSeconds,
      tokenTtlSeconds,
      tokenTtlSeconds,
      tokenTtlSeconds,
      tokenTtlSeconds,
    );

    return { token, appId, channelName: data.channelName, uid };
  });
