import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PalCard, type PalCardData } from "@/components/PalCard";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/browse")({
  head: () => ({
    meta: [
      { title: "Browse Pat Pals — Pat My Back" },
      { name: "description", content: "Find a Pat Pal by topic — anxiety, relationships, work stress, and more." },
    ],
  }),
  component: Browse,
});

type Category = { id: string; name: string; slug: string; emoji: string | null };

function Browse() {
  const [cats, setCats] = useState<Category[]>([]);
  const [pals, setPals] = useState<PalCardData[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from("categories").select("id, name, slug, emoji").order("sort_order"),
        supabase
          .from("pat_pals")
          .select("user_id, headline, price_cents_per_minute, availability, category_slugs")
          .order("rating_avg", { ascending: false }),
      ]);
      const rows = p ?? [];
      const ids = rows.map((r) => r.user_id);
      let nameMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", ids);
        nameMap = new Map((profs ?? []).map((pr) => [pr.id, { full_name: pr.full_name, avatar_url: pr.avatar_url }]));
      }
      const merged = rows.map((r) => ({
        ...r,
        profiles: nameMap.get(r.user_id) ?? { full_name: null, avatar_url: null },
      }));
      setCats((c ?? []) as Category[]);
      setPals(merged as unknown as PalCardData[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return pals.filter((p) => {
      const slugs = ((p as unknown as { category_slugs: string[] | null }).category_slugs) ?? [];
      if (active && !slugs.includes(active)) return false;
      if (q) {
        const hay = ((p.profiles?.full_name ?? "") + " " + (p.headline ?? "")).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [pals, active, q]);

  return (
    <AppShell>
      <header className="sticky top-0 z-10 bg-background/95 px-5 pt-8 pb-3 backdrop-blur">
        <h1 className="text-2xl font-extrabold tracking-tight">Browse</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Pals…" className="h-10 pl-9" />
        </div>
      </header>

      <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-5 py-3">
        <Chip label="All" active={!active} onClick={() => setActive(null)} />
        {cats.map((c) => (
          <Chip
            key={c.id}
            label={`${c.emoji ?? ""} ${c.name}`.trim()}
            active={active === c.slug}
            onClick={() => setActive(c.slug)}
          />
        ))}
      </div>

      <section className="space-y-3 px-5 pb-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No Pals match your search.
          </p>
        ) : (
          filtered.map((p) => <PalCard key={p.user_id} pal={p} />)
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
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}
