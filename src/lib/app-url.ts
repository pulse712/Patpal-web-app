import { APP_CONFIG } from "@/config/app";

/** Public site URL for Stripe redirects, emails, etc. */
export function getAppUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  const fromEnv = process.env.APP_URL ?? process.env.VITE_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") return APP_CONFIG.productionUrl;

  return "http://localhost:5173";
}

/** Absolute URL for Open Graph / Twitter card images (served from /public). */
export function getOgImageUrl(): string {
  return `${getAppUrl()}/icons/icon-512.png`;
}
