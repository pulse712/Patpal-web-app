// Server function to generate an Agora RTC token.
// The token is scoped to a specific channel + user, expires in 1 hour.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tokenSchema = z.object({
  channelName: z.string().min(1).max(64),
  uid: z.number().int().nonnegative(),
});

export const getAgoraToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId) throw new Error("Missing AGORA_APP_ID");

    // If no certificate is set (testing mode), return a null token —
    // Agora allows this when the project has Auth Disabled in the console.
    if (!appCertificate || appCertificate === "TESTING_NO_CERT") {
      return { token: null, appId, channelName: data.channelName, uid: data.uid };
    }

    // Dynamically import to keep server-only code out of the client bundle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { RtcTokenBuilder, RtcRole } = await import("agora-token") as any;

    const expiresInSeconds = 3600; // 1 hour
    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expiresInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      data.channelName,
      data.uid,
      RtcRole.PUBLISHER,
      expiresInSeconds,
      privilegeExpireTime,
    );

    return { token, appId, channelName: data.channelName, uid: data.uid };
  });
