import { SUPABASE_PROJECT } from "@/config/supabase-public";

function processEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

/** Supabase URL for server routes and server functions (.env overrides config). */
export function getSupabaseUrl(): string {
  return processEnv("SUPABASE_URL") || processEnv("VITE_SUPABASE_URL") || SUPABASE_PROJECT.url;
}

/** Publishable key for auth middleware (.env overrides config). */
export function getSupabasePublishableKey(): string {
  return (
    processEnv("SUPABASE_PUBLISHABLE_KEY") ||
    processEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
    SUPABASE_PROJECT.publishableKey
  );
}

/** Service role key — server only, never in client bundle. Set in .env. */
export function getSupabaseServiceRoleKey(): string | undefined {
  return processEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function requireSupabaseServiceRoleKey(): string {
  const key = getSupabaseServiceRoleKey();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to patpal/.env (Supabase Dashboard → Project Settings → API → secret key).",
    );
  }
  return key;
}
