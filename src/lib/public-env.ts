import { SUPABASE_PROJECT } from "@/config/supabase-public";

/** Public env vars safe to expose in the browser. */
export type PublicEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_VAPID_PUBLIC_KEY?: string;
};

declare global {
  interface Window {
    __PUBLIC_ENV__?: PublicEnv;
  }
}

function runtimeEnv(): PublicEnv {
  if (typeof window !== "undefined" && window.__PUBLIC_ENV__) {
    return window.__PUBLIC_ENV__;
  }
  return {};
}

function processEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

/** Read a public env var (.env / SSR injection override client Supabase config). */
export function getPublicEnv(name: keyof PublicEnv): string | undefined {
  const runtime = runtimeEnv();

  switch (name) {
    case "SUPABASE_URL":
      return (
        import.meta.env.VITE_SUPABASE_URL ||
        runtime.SUPABASE_URL ||
        processEnv("SUPABASE_URL") ||
        processEnv("VITE_SUPABASE_URL") ||
        SUPABASE_PROJECT.url
      );
    case "SUPABASE_PUBLISHABLE_KEY":
      return (
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        runtime.SUPABASE_PUBLISHABLE_KEY ||
        processEnv("SUPABASE_PUBLISHABLE_KEY") ||
        processEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
        SUPABASE_PROJECT.publishableKey
      );
    case "VITE_STRIPE_PUBLISHABLE_KEY":
      return (
        import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
        runtime.VITE_STRIPE_PUBLISHABLE_KEY ||
        processEnv("VITE_STRIPE_PUBLISHABLE_KEY") ||
        processEnv("STRIPE_PUBLISHABLE_KEY")
      );
    case "VITE_VAPID_PUBLIC_KEY":
      return (
        import.meta.env.VITE_VAPID_PUBLIC_KEY ||
        runtime.VITE_VAPID_PUBLIC_KEY ||
        processEnv("VITE_VAPID_PUBLIC_KEY") ||
        processEnv("VAPID_PUBLIC_KEY")
      );
    default:
      return undefined;
  }
}

/** Injected into HTML during SSR for Stripe/VAPID overrides. Supabase uses config file by default. */
export function collectPublicEnvForInjection(): PublicEnv {
  return {
    SUPABASE_URL: getPublicEnv("SUPABASE_URL"),
    SUPABASE_PUBLISHABLE_KEY: getPublicEnv("SUPABASE_PUBLISHABLE_KEY"),
    VITE_STRIPE_PUBLISHABLE_KEY:
      processEnv("VITE_STRIPE_PUBLISHABLE_KEY") || processEnv("STRIPE_PUBLISHABLE_KEY"),
    VITE_VAPID_PUBLIC_KEY: processEnv("VITE_VAPID_PUBLIC_KEY") || processEnv("VAPID_PUBLIC_KEY"),
  };
}
