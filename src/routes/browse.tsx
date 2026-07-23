import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { fetchPublicProfiles } from "@/lib/public-profiles";
import {
  filterBrowsePals,
  paramToMaxPrice,
  PRICE_OPTIONS,
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
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from("categories").select("id, name, slug, emoji").order("sort_order"),
        supabase
          .from("pat_pals")
          .select("user_id, headline, price_cents_per_minute, availability, category_slugs, tier")
          .order("rating_avg", { ascending: false }),
      ]);
      const rows = p ?? [];
      const nameMap = await fetchPublicProfiles(rows.map((r) => r.user_id));
      const merged: PalBrowseRow[] = rows.map((r) => ({
        user_id: r.user_id,
        headline: r.headline,
        price_cents_per_minute: r.price_cents_per_minute,
        tier: r.tier,
        category_slugs: r.category_slugs,
        profiles: nameMap.get(r.user_id) ?? { full_name: null, avatar_url: null },
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
      <header className="sticky top-0 z-10 bg-background/95 px-5 pt-8 pb-3 backdrop-blur">
        <h1 className="text-2xl font-extrabold tracking-tight">Browse</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Pals…"
            className="h-10 pl-9"
          />
        </div>
      </header>

      <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-5 py-3">
        <Chip
          label="All"
          active={!activeCategory}
          onClick={() => updateSearch({ category: undefined })}
        />
        {cats.map((c) => (
          <Chip
            key={c.id}
            label={`${c.emoji ?? ""} ${c.name}`.trim()}
            active={activeCategory === c.slug}
            onClick={() =>
              updateSearch({
                category: activeCategory === c.slug ? undefined : c.slug,
              })
            }
          />
        ))}
      </div>

      <div className="flex gap-2 px-5 pb-3">
        <Select
          value={activeTier}
          onValueChange={(v) => updateSearch({ tier: v as PalTier | "all" })}
        >
          <SelectTrigger className="h-9 flex-1">
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

        <Select value={activePrice} onValueChange={(v) => updateSearch({ price: v })}>
          <SelectTrigger className="h-9 flex-1">
            <SelectValue placeholder="Price" />
          </SelectTrigger>
          <SelectContent>
            {PRICE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(activeCategory || activeTier !== "all" || activePrice !== "all" || q) && (
        <div className="px-5 pb-2">
          <p className="text-xs text-muted-foreground">
            {filtered.length} Pal{filtered.length === 1 ? "" : "s"} match
            {activeCategory
              ? ` · ${cats.find((c) => c.slug === activeCategory)?.name ?? activeCategory}`
              : ""}
            {activeTier !== "all" ? ` · ${activeTier}` : ""}
            {activePrice !== "all"
              ? ` · ${PRICE_OPTIONS.find((o) => o.value === activePrice)?.label ?? activePrice}`
              : ""}
          </p>
        </div>
      )}

      <section className="space-y-3 px-5 pb-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No Pals match your filters.
          </p>
        ) : (
          filtered.map((p) => <PalCard key={p.user_id} pal={p as unknown as PalCardData} />)
        )}
      </section>
    </AppShell>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}
