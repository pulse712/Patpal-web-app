export type CreditPackage = {
  id: string;
  label: string;
  seconds: number;
  amount: number;
};

export const DEFAULT_CREDIT_PACKAGES: CreditPackage[] = [
  { id: "pack_15min", label: "15 minutes", seconds: 15 * 60, amount: 1000 },
  { id: "pack_30min", label: "30 minutes", seconds: 30 * 60, amount: 1800 },
  { id: "pack_60min", label: "60 minutes", seconds: 60 * 60, amount: 3000 },
];

export const DEFAULT_PRICE_CENTS_PER_MINUTE = 100;

type SettingsClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

function parsePackages(value: unknown): CreditPackage[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: CreditPackage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const label = typeof r.label === "string" ? r.label : null;
    const seconds = typeof r.seconds === "number" ? r.seconds : null;
    const amount = typeof r.amount === "number" ? r.amount : null;
    if (!id || !label || !seconds || seconds <= 0 || amount == null || amount < 0) continue;
    parsed.push({ id, label, seconds, amount });
  }
  return parsed.length > 0 ? parsed : null;
}

export async function loadCreditPackages(client: SettingsClient): Promise<CreditPackage[]> {
  try {
    const { data, error } = await client
      .from("app_settings")
      .select("value")
      .eq("key", "credit_packages")
      .maybeSingle();
    if (error || !data) return DEFAULT_CREDIT_PACKAGES;
    return parsePackages(data.value) ?? DEFAULT_CREDIT_PACKAGES;
  } catch {
    return DEFAULT_CREDIT_PACKAGES;
  }
}

export async function loadDefaultPriceCents(client: SettingsClient): Promise<number> {
  try {
    const { data, error } = await client
      .from("app_settings")
      .select("value")
      .eq("key", "default_price_cents_per_minute")
      .maybeSingle();
    if (error || data?.value == null) return DEFAULT_PRICE_CENTS_PER_MINUTE;
    const n = typeof data.value === "number" ? data.value : Number(data.value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_PRICE_CENTS_PER_MINUTE;
  } catch {
    return DEFAULT_PRICE_CENTS_PER_MINUTE;
  }
}

/** True when a scheduled banner should show right now. Null dates = always (if visible). */
export function isBannerInSchedule(
  banner: { starts_at?: string | null; ends_at?: string | null },
  now: Date = new Date(),
): boolean {
  if (banner.starts_at && new Date(banner.starts_at) > now) return false;
  if (banner.ends_at && new Date(banner.ends_at) < now) return false;
  return true;
}
