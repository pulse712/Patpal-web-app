import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PalCard, type PalCardData } from "@/components/PalCard";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { fetchPublicProfiles } from "@/lib/public-profiles";
import { getStaffUserIds } from "@/lib/team.functions";
import {
  filterBrowsePals,
  buildPriceOptions,
  paramToMaxPrice,
  TIER_OPTIONS,
  type PalBrowseRow,
  type PalTier,
} from "@/lib/browse-utils";

type BrowseSearch = {
  category?: string;
  tier?: PalTier | "all";
  price?: string;
};

export const Route = createFileRoute("/browse")({
  validateSearch: (search: Record<string, unknown>): BrowseSearch => ({
    category: typeof search.category === "string" ? search.category : undefined,
    tier:
      search.tier === "trusted" ||
      search.tier === "premium" ||
      search.tier === "expert" ||
      search.tier === "all"
        ? search.tier
        : undefined,
    price: typeof search.price === "string" ? search.price : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Browse Pat Pals — Pat My Back" },
      {
        name: "description",
        content:
          "Find a Pat Pal by topic, tier, or price — mentorship, motivation, career advice, and more.",
      },
    ],
  }),
  component: Browse,
});

type Category = { id: string; name: string; slug: string; emoji: string | null };

function Browse() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [cats, setCats] = useState<Category[]>([]);
  const [pals, setPals] = useState<PalBrowseRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const activeCategory = search.category ?? null;
  const activeTier = search.tier ?? "all";
  const activePrice = search.price ?? "all";

  useEffect(() => {
    (async () => {
      const catsRes = await supabase
        .from("categories")
        .select("id, name, slug, emoji")
        .order("sort_order");

      let palRows:
        | {
            user_id: string;
            headline: string | null;
            service_range: string | null;
            price_cents_per_minute: number;
            availability: "available" | "busy" | "offline";
            category_slugs: string[];
            tier: "trusted" | "expert" | "premium";
          }[]
        | null = null;
      let palsError: string | undefined;

      const palsRes = await supabase
        .from("pat_pals")
        .select(
          "user_id, headline, service_range, price_cents_per_minute, availability, category_slugs, tier, is_approved",
        )
        .eq("is_approved", true)
        .order("rating_avg", { ascending: false });

      if (palsRes.error && /service_range|is_approved|column/i.test(palsRes.error.message)) {
        const basicPalsRes = await supabase
          .from("pat_pals")
          .select("user_id, headline, price_cents_per_minute, availability, category_slugs, tier")
          .order("rating_avg", { ascending: false });
        palsError = basicPalsRes.error?.message;
        palRows = (basicPalsRes.data ?? []).map((row) => ({ ...row, service_range: null }));
      } else {
        palsError = palsRes.error?.message;
        palRows = palsRes.data;
      }

      const [staffRes] = await Promise.all([getStaffUserIds()]);
      const loadError = catsRes.error?.message ?? palsError;
      if (loadError) {
        toast.error("Could not load Pat Pals. Please refresh.");
        setLoading(false);
        return;
      }
      const c = catsRes.data;
      const rows = palRows ?? [];
      const staffIds = new Set(staffRes.userIds);
      const nameMap = await fetchPublicProfiles(rows.map((r) => r.user_id));
      const merged: PalBrowseRow[] = rows
        .filter((r) => !staffIds.has(r.user_id))
        .map((r) => ({
          user_id: r.user_id,
          headline: r.headline,
          service_range: r.service_range,
          price_cents_per_minute: r.price_cents_per_minute,
          tier: r.tier,
          availability: r.availability,
          category_slugs: r.category_slugs,
          profiles: nameMap.get(r.user_id) ?? {
            full_name: null,
            avatar_url: null,
            bio: null,
            introduction: null,
            languages: null,
          },
        }));
      setCats((c ?? []) as Category[]);
      setPals(merged);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () =>
      filterBrowsePals(pals, {
        category: activeCategory ?? undefined,
        tier: activeTier,
        maxPriceCents: paramToMaxPrice(activePrice),
        query: q,
      }),
    [pals, activeCategory, activeTier, activePrice, q],
  );

  const priceOptions = useMemo(() => buildPriceOptions(pals), [pals]);

  function updateSearch(patch: Partial<BrowseSearch>) {
    navigate({
      to: "/browse",
      search: (prev) => {
        const next: BrowseSearch = { ...prev, ...patch };
        if (!next.category) delete next.category;
        if (!next.tier || next.tier === "all") delete next.tier;
        if (!next.price || next.price === "all") delete next.price;
        return next;
      },
      replace: true,
    });
  }

  return (
    <AppShell>
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-5 pt-6 pb-4 backdrop-blur lg:px-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Browse</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find a Pat Pal by topic, tier, or price
        </p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Pals…"
            className="h-10 pl-9"
          />
        </div>
      </header>

      <section className="mx-5 mb-4 rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Filters
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Category</p>
            <Select
              value={activeCategory ?? "all"}
              onValueChange={(v) => updateSearch({ category: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="h-10 w-full bg-background">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {cats.map((c) => (
                  <SelectItem key={c.id} value={c.slug}>
                    {`${c.emoji ?? ""} ${c.name}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Tier</p>
            <Select
              value={activeTier}
              onValueChange={(v) => updateSearch({ tier: v as PalTier | "all" })}
            >
              <SelectTrigger className="h-10 w-full bg-background">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Price</p>
            <Select value={activePrice} onValueChange={(v) => updateSearch({ price: v })}>
              <SelectTrigger className="h-10 w-full bg-background">
                <SelectValue placeholder="Price" />
              </SelectTrigger>
              <SelectContent>
                {priceOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {(activeCategory || activeTier !== "all" || activePrice !== "all" || q) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {filtered.length} Pal{filtered.length === 1 ? "" : "s"} match
            {activeCategory
              ? ` · ${cats.find((c) => c.slug === activeCategory)?.name ?? activeCategory}`
              : ""}
            {activeTier !== "all" ? ` · ${activeTier}` : ""}
            {activePrice !== "all"
              ? ` · ${priceOptions.find((o) => o.value === activePrice)?.label ?? activePrice}`
              : ""}
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 px-5 pb-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading ? (
          <p className="col-span-full text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="col-span-full rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No Pals match your filters.
          </p>
        ) : (
          filtered.map((p) => <PalCard key={p.user_id} pal={p as unknown as PalCardData} />)
        )}
      </section>
    </AppShell>
  );
}
