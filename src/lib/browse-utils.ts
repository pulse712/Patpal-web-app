export type PalTier = "trusted" | "premium" | "expert";

export type BrowseFilters = {
  category?: string;
  tier?: PalTier | "all";
  maxPriceCents?: number;
  query?: string;
};

export type PalBrowseRow = {
  user_id: string;
  headline: string | null;
  service_range: string | null;
  price_cents_per_minute: number;
  tier: string | null;
  availability?: string;
  category_slugs: string[] | null;
  profiles: {
    full_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    introduction: string | null;
    languages: string[] | null;
  } | null;
};

export function parseMaxPriceParam(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "free") return 0;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseTierParam(value: unknown): PalTier | "all" | undefined {
  if (value === "trusted" || value === "premium" || value === "expert" || value === "all") {
    return value;
  }
  return undefined;
}

export function filterBrowsePals(pals: PalBrowseRow[], filters: BrowseFilters): PalBrowseRow[] {
  const q = filters.query?.trim().toLowerCase();

  return pals.filter((p) => {
    const slugs = p.category_slugs ?? [];
    if (filters.category && !slugs.includes(filters.category)) return false;

    if (filters.tier && filters.tier !== "all" && p.tier !== filters.tier) return false;

    if (filters.maxPriceCents !== undefined) {
      if (filters.maxPriceCents === 0) {
        if (p.price_cents_per_minute !== 0) return false;
      } else if (p.price_cents_per_minute > filters.maxPriceCents) {
        return false;
      }
    }

    if (q) {
      const langs = (p.profiles?.languages ?? []).join(" ");
      const hay = `${p.profiles?.full_name ?? ""} ${p.headline ?? ""} ${p.profiles?.bio ?? ""} ${p.profiles?.introduction ?? ""} ${p.service_range ?? ""} ${langs}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

export const TIER_OPTIONS: { value: PalTier | "all"; label: string }[] = [
  { value: "all", label: "All tiers" },
  { value: "trusted", label: "Trusted" },
  { value: "premium", label: "Premium" },
  { value: "expert", label: "Expert" },
];

export const PRICE_OPTIONS = [
  { value: "all", label: "Any price", maxPriceCents: undefined },
  { value: "free", label: "Free", maxPriceCents: 0 },
  { value: "100", label: "Up to $1/min", maxPriceCents: 100 },
  { value: "200", label: "Up to $2/min", maxPriceCents: 200 },
  { value: "300", label: "Up to $3/min", maxPriceCents: 300 },
] as const;

export function maxPriceToParam(maxPriceCents: number | undefined): string {
  if (maxPriceCents === undefined) return "all";
  if (maxPriceCents === 0) return "free";
  return String(maxPriceCents);
}

export function paramToMaxPrice(value: string | undefined): number | undefined {
  if (!value || value === "all") return undefined;
  return parseMaxPriceParam(value);
}
