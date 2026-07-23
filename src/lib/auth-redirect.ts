import { getAppUrl } from "@/lib/app-url";

/** Base URL for Supabase email links (confirm signup, reset password). */
export function getAuthRedirectUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}${normalized}`;
  }

  return `${getAppUrl()}${normalized}`;
}
