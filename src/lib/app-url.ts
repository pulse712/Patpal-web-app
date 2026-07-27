import { APP_CONFIG } from "@/config/app";

function getConfiguredAppUrl(): string | null {
  const fromEnv = process.env.APP_URL ?? process.env.VITE_APP_URL;
  return fromEnv ? fromEnv.replace(/\/$/, "") : null;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function isAllowedAppOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const { hostname, protocol } = new URL(normalized);

  if (hostname === "localhost") {
    return protocol === "http:" || protocol === "https:";
  }

  if (protocol !== "https:") return false;

  if (hostname.endsWith(".vercel.app")) return true;
  if (hostname === "patmyback.com" || hostname.endsWith(".patmyback.com")) return true;

  const configured = getConfiguredAppUrl();
  if (configured && hostname === new URL(configured).hostname) return true;

  if (hostname === new URL(APP_CONFIG.productionUrl).hostname) return true;

  return false;
}

/** Public site URL for emails and static links. Prefers explicit APP_URL. */
export function getAppUrl(): string {
  const configured = getConfiguredAppUrl();
  if (configured) return configured;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  if (process.env.NODE_ENV === "production") return APP_CONFIG.productionUrl;

  return "http://localhost:5173";
}

/** Origin for Stripe return/cancel URLs — matches the browser the user started from. */
export function resolveCheckoutReturnOrigin(opts?: {
  request?: Request;
  clientOrigin?: string;
}): string {
  const candidates: (string | null | undefined)[] = [];

  if (opts?.clientOrigin) {
    candidates.push(normalizeOrigin(opts.clientOrigin));
  }

  if (opts?.request) {
    const origin = opts.request.headers.get("origin");
    if (origin) candidates.push(normalizeOrigin(origin));

    const host = opts.request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const proto = opts.request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    if (host) candidates.push(normalizeOrigin(`${proto}://${host}`));

    const referer = opts.request.headers.get("referer");
    if (referer) {
      try {
        const ref = new URL(referer);
        candidates.push(normalizeOrigin(`${ref.protocol}//${ref.host}`));
      } catch {
        /* ignore bad referer */
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate && isAllowedAppOrigin(candidate)) return candidate;
  }

  return getAppUrl();
}

/** Absolute URL for Open Graph / Twitter card images (served from /public). */
export function getOgImageUrl(): string {
  return `${getAppUrl()}/icons/icon-512.png`;
}
