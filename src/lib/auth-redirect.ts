import { APP_CONFIG } from "@/config/app";

/** Base URL for Supabase email links (confirm signup, reset password). */
export function getAuthRedirectUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}${normalized}`;
  }

  return `${APP_CONFIG.productionUrl}${normalized}`;
}
