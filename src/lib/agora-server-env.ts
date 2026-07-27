/** Server-only Agora credentials. Use bracket access so bundlers don't inline at build time. */

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getAgoraAppId(): string | undefined {
  return readEnv("AGORA_APP_ID") ?? readEnv("VITE_AGORA_APP_ID");
}

export function getAgoraAppCertificate(): string | undefined {
  return readEnv("AGORA_APP_CERTIFICATE") ?? readEnv("VITE_AGORA_APP_CERTIFICATE");
}

export function requireAgoraAppId(): string {
  const appId = getAgoraAppId();
  if (!appId) {
    throw new Error(
      "Missing AGORA_APP_ID. Add it to Vercel → Settings → Environment Variables (or patpal/.env for local dev), then redeploy.",
    );
  }
  return appId;
}
