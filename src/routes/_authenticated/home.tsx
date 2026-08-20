import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Clock,
  ArrowRight,
  Phone,
  Star,
  BadgeCheck,
  Users,
  CalendarDays,
  History,
} from "lucide-react";
import { useOnlineUsers, useIsOnline } from "@/lib/presence";
import { fetchPublicProfiles } from "@/lib/public-profiles";
import { getTeamMembers, type TeamMember } from "@/lib/team.functions";
import { AdminStaffBanner, AdminStaffHeaderButton } from "@/components/AdminStaffLinks";
import { isMissingColumnError } from "@/lib/postgrest-utils";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Pat My Back — Talk to someone who has your back" },
      {
        name: "description",
        content:
          "Chat, call, and video with vetted Pat Pals by the minute. Anonymous, judgment-free support whenever you need it.",
      },
      { property: "og:title", content: "Pat My Back — Talk to someone who has your back" },
      {
        property: "og:description",
        content:
          "Chat, call, and video with vetted Pat Pals by the minute. Anonymous, judgment-free support whenever you need it.",
      },
    ],
  }),
  component: Home,
});

type Profile = { full_name: string | null };
type Category = { id: string; name: string; slug: string; emoji: string | null };
type Pal = {
  user_id: string;
  headline: string | null;
  price_cents_per_minute: number;
  tier: "trusted" | "premium" | "expert" | string;
  is_team: boolean;
  rating_avg: number | null;
  rating_count: number | null;
  full_name: string | null;
  avatar_url: string | null;
  availability: string;
};

/** Approved marketplace Pat Pals (team/admin accounts have their own section). */
function isMarketplacePal(
  pal: { user_id: string; is_team: boolean },
  adminIds: Set<string>,
): boolean {
  if (adminIds.has(pal.user_id) || pal.is_team) return false;
  return true;
}

function Home() {
  const onlineUsers = useOnlineUsers();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balanceSeconds, setBalanceSeconds] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [allPals, setAllPals] = useState<Pal[]>([]);
  const allPalsRef = useRef<Pal[]>([]);
  useEffect(() => {
    allPalsRef.current = allPals;
  }, [allPals]);
  const [topRated, setTopRated] = useState<Pal[]>([]);
  const [banners, setBanners] = useState<
    {
      id: string;
      title: string;
      body: string | null;
      image_url: string | null;
    }[]
  >([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      const uid = sess.session.user.id;
      const [pRes, wRes, catsRes, palsRes, bansRes, teamRes] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
        supabase.from("wallets").select("balance_seconds").eq("user_id", uid).maybeSingle(),
        supabase.from("categories").select("id, name, slug, emoji").order("sort_order").limit(12),
        supabase
          .from("pat_pals")
          .select(
            "user_id, headline, price_cents_per_minute, availability, tier, is_team, rating_avg, rating_count, category_slugs, is_approved",
          )
          .eq("is_approved", true),
        supabase
          .from("promo_banners")
          .select("id, title, body, image_url, starts_at, ends_at")
          .eq("is_visible", true)
          .order("sort_order")
          .limit(8),
        getTeamMembers(),
      ]);
      const loadError =
        pRes.error?.message ??
        wRes.error?.message ??
        catsRes.error?.message ??
        palsRes.error?.message ??
        bansRes.error?.message;
      if (loadError && isMissingColumnError(loadError)) {
        // Migration not applied yet — fall back without new columns
      } else if (loadError) {
        toast.error("Could not load your dashboard. Please refresh.");
        setLoading(false);
        return;
      }
      const p = pRes.data;
      const w = wRes.data;
      const cats = catsRes.data;
      let pals = palsRes.data;
      if (palsRes.error && isMissingColumnError(palsRes.error)) {
        const fallback = await supabase
          .from("pat_pals")
          .select(
            "user_id, headline, price_cents_per_minute, availability, tier, is_team, rating_avg, rating_count, category_slugs",
          );
        pals = (fallback.data ?? []).map((row) => ({ ...row, is_approved: true }));
      }
      let bans = bansRes.data;
      if (bansRes.error && isMissingColumnError(bansRes.error)) {
        const fallback = await supabase
          .from("promo_banners")
          .select("id, title, body, image_url")
          .eq("is_visible", true)
          .order("sort_order")
          .limit(3);
        bans = (fallback.data ?? []).map((b) => ({ ...b, starts_at: null, ends_at: null }));
      } else {
        const { isBannerInSchedule } = await import("@/lib/app-settings");
        bans = (bans ?? []).filter((b) => isBannerInSchedule(b)).slice(0, 3);
      }
      setProfile(p as Profile | null);
      setBalanceSeconds(w?.balance_seconds ?? 0);

      const rows = pals ?? [];
      const usedSlugs = new Set<string>();
      for (const r of rows) {
        for (const slug of r.category_slugs ?? []) usedSlugs.add(slug);
      }
      const filteredCats = ((cats ?? []) as Category[]).filter((c) => usedSlugs.has(c.slug));
      setCategories(filteredCats.length > 0 ? filteredCats : ((cats ?? []) as Category[]));
      setBanners(bans ?? []);

      const nameMap = await fetchPublicProfiles(rows.map((r) => r.user_id));
      const merged: Pal[] = rows.map((r) => ({
        user_id: r.user_id,
        headline: r.headline,
        price_cents_per_minute: r.price_cents_per_minute,
        tier: r.tier,
        is_team: r.is_team,
        rating_avg: r.rating_avg,
        rating_count: r.rating_count,
        full_name: nameMap.get(r.user_id)?.full_name ?? null,
        avatar_url: nameMap.get(r.user_id)?.avatar_url ?? null,
        availability: r.availability,
      }));
      setAllPals(merged);
      setTeam(teamRes.members);
      setTopRated(
        [...merged]
          .filter((m) => !teamRes.members.some((t) => t.user_id === m.user_id))
          .sort((a, b) => Number(b.rating_avg ?? 0) - Number(a.rating_avg ?? 0))
          .slice(0, 5),
      );
      setLoading(false);
    })();
  }, []);

  // Keep the marketplace list in sync while this page stays open: pick up
  // Pals approved (or de-listed) after the initial fetch, not just
  // availability toggles on ones we already loaded.
  useEffect(() => {
    const channel = supabase
      .channel("home-pat-pals-availability")
      .on("postgres_changes", { event: "*", schema: "public", table: "pat_pals" }, (payload) => {
        const row = payload.new as {
          user_id: string;
          availability: string;
          is_approved?: boolean;
          headline?: string | null;
          price_cents_per_minute?: number;
          tier?: string;
          is_team?: boolean;
          rating_avg?: number | null;
          rating_count?: number | null;
        };
        if (!row?.user_id) return;

        if (row.is_approved === false) {
          setAllPals((prev) => prev.filter((p) => p.user_id !== row.user_id));
          setTeam((prev) => prev.filter((t) => t.user_id !== row.user_id));
          return;
        }

        setTeam((prev) =>
          prev.map((t) =>
            t.user_id === row.user_id ? { ...t, availability: row.availability } : t,
          ),
        );

        setAllPals((prev) => {
          if (!prev.some((p) => p.user_id === row.user_id)) return prev;
          return prev.map((p) =>
            p.user_id === row.user_id
              ? {
                  ...p,
                  availability: row.availability,
                  headline: row.headline ?? p.headline,
                  price_cents_per_minute: row.price_cents_per_minute ?? p.price_cents_per_minute,
                  tier: row.tier ?? p.tier,
                  is_team: row.is_team ?? p.is_team,
                  rating_avg: row.rating_avg ?? p.rating_avg,
                  rating_count: row.rating_count ?? p.rating_count,
                }
              : p,
          );
        });

        // Newly approved (or newly created, already-approved) Pal we
        // haven't loaded yet — fetch their profile and add them in.
        if (row.is_approved && !allPalsRef.current.some((p) => p.user_id === row.user_id)) {
          void fetchPublicProfiles([row.user_id]).then((names) => {
            const info = names.get(row.user_id);
            setAllPals((prev) =>
              prev.some((p) => p.user_id === row.user_id)
                ? prev
                : [
                    ...prev,
                    {
                      user_id: row.user_id,
                      headline: row.headline ?? null,
                      price_cents_per_minute: row.price_cents_per_minute ?? 0,
                      tier: row.tier ?? "trusted",
                      is_team: row.is_team ?? false,
                      rating_avg: row.rating_avg ?? null,
                      rating_count: row.rating_count ?? null,
                      full_name: info?.full_name ?? null,
                      avatar_url: info?.avatar_url ?? null,
                      availability: row.availability,
                    },
                  ],
            );
          });
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const adminIds = useMemo(() => new Set(team.map((t) => t.user_id)), [team]);

  const available = useMemo(
    () =>
      allPals
        .filter((pal) => isMarketplacePal(pal, adminIds) && onlineUsers.has(pal.user_id))
        .slice(0, 5),
    [allPals, adminIds, onlineUsers],
  );

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const balanceMinutes = Math.floor(balanceSeconds / 60);
  const welcomeName = profile?.full_name?.trim() || "Friend";

  return (
    <AppShell>
      {/* Header */}
      <header className="space-y-3 px-5 pt-5 lg:px-8">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Welcome back</p>
          <h1 className="mt-1 text-xl font-extrabold leading-tight tracking-tight break-words sm:text-2xl">
            {welcomeName}{" "}
            <span className="inline-block" aria-hidden="true">
              👋
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminStaffHeaderButton />
          <Link
            to="/calls"
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-foreground"
          >
            <History className="h-4 w-4 shrink-0" />
            Calls
          </Link>
          <Link
            to="/calendar"
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-foreground"
          >
            <CalendarDays className="h-4 w-4 shrink-0" />
            Calendar
          </Link>
          <Link
            to="/wallet"
            search={{ payment: undefined }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary"
          >
            <Clock className="h-4 w-4 shrink-0" />
            {balanceMinutes} min
          </Link>
        </div>
      </header>

      <AdminStaffBanner />

      {/* Gradient banner */}
      <section className="px-5 pt-4 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-hero-gradient p-5 text-white shadow-hero lg:p-8">
          <h2 className="text-lg font-extrabold leading-tight lg:text-2xl">
            Talk to a real person who has your back
          </h2>
          <p className="mt-1 text-sm/relaxed opacity-95">
            Encouragement when you need it most. Pay only for the time you use.
          </p>
          <Link
            to="/browse"
            className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-primary shadow"
          >
            Find support now <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Promo banners */}
      {banners.length > 0 && (
        <section className="space-y-2 px-5 pt-4 lg:px-8">
          {banners.map((b) => (
            <div
              key={b.id}
              className="overflow-hidden rounded-2xl border border-primary/20 bg-primary-soft"
            >
              {b.image_url && (
                <div className="aspect-[12/5] w-full overflow-hidden">
                  <img src={b.image_url} alt="" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="px-4 py-3">
                <p className="text-sm font-bold text-primary">{b.title}</p>
                {b.body && <p className="mt-0.5 text-xs text-muted-foreground">{b.body}</p>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Talk to the Team */}
      <section className="px-5 pt-6">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
          <BadgeCheck className="h-4 w-4 text-primary" /> Talk to the Team
        </h3>
        {team.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            No team members available.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {team.map((p) => (
              <TeamRow key={p.user_id} pal={p} />
            ))}
          </div>
        )}
      </section>

      {/* Categories */}
      <section className="px-5 pt-6">
        <h3 className="mb-3 text-sm font-bold">Browse by category</h3>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
          {categories.map((c, i) => (
            <Link
              key={c.id}
              to="/browse"
              search={{ category: c.slug }}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-card p-2.5 text-center shadow-card"
            >
              <span
                className="grid h-11 w-11 place-items-center rounded-full text-xl"
                style={{ backgroundColor: categoryColor(c.slug, i) }}
              >
                {c.emoji ?? "💬"}
              </span>
              <span className="text-[10px] font-medium leading-tight">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Online now + Top rated — side by side on large screens */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:px-5">
        {/* Available now */}
        <section className="px-5 pt-6 lg:px-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <span className="inline-block h-2 w-2 rounded-full bg-success" /> Available now
            </h3>
            <Link to="/browse" className="text-xs font-semibold text-primary">
              See all
            </Link>
          </div>
          {available.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              <Users className="mx-auto mb-1 h-5 w-5 opacity-60" />
              No approved Pat Pals are online right now.
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-card">
              {available.map((p) => (
                <PalRow key={p.user_id} pal={p} />
              ))}
            </div>
          )}
        </section>

        {/* Top rated */}
        <section className="px-5 pt-6 lg:px-0">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Star className="h-4 w-4 fill-accent text-accent" /> Top rated
          </h3>
          {topRated.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
              No ratings yet.
            </p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-card">
              {topRated.map((p) => (
                <PalRow key={p.user_id} pal={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    trusted: "Trusted Supporter",
    premium: "Premium Supporter",
    expert: "Expert",
  };
  return map[tier] ?? tier;
}

const CATEGORY_COLORS: Record<string, string> = {
  mentorship: "#FFE4B5",
  training: "#D4F1D4",
  motivation: "#FFD9C7",
  accountability: "#FFE0EC",
  "business-coaching": "#DCE7FF",
  "friendly-chat": "#FFF3B0",
  "emotional-support": "#FFD6E8",
  consulting: "#FFF1B8",
  "career-advice": "#E0D4FF",
  encouragement: "#FFDDA8",
  "spiritual-encouragement": "#D6EAFF",
  "music-lessons": "#F5D0FF",
};
const FALLBACK_COLORS = [
  "#FFE4B5",
  "#D4F1D4",
  "#FFD9C7",
  "#FFE0EC",
  "#DCE7FF",
  "#FFF3B0",
  "#FFD6E8",
  "#E0D4FF",
];
function categoryColor(slug: string, i: number) {
  return CATEGORY_COLORS[slug] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return <img src={url} alt={name} className="h-11 w-11 rounded-full object-cover" />;
  }
  return (
    <div className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function TeamRow({ pal }: { pal: TeamMember }) {
  const name = pal.full_name?.trim() || "Team member";
  const isOnline = useIsOnline(pal.user_id);
  const roleLabel = pal.role === "super_admin" ? "Super Admin" : "Admin";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary-soft/40 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="relative shrink-0">
          <Avatar name={name} url={pal.avatar_url} />
          <PresenceDot online={isOnline} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug break-words">{name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              {roleLabel}
            </span>
            <span
              className={`text-[11px] font-medium ${isOnline ? "text-success" : "text-muted-foreground"}`}
            >
              {isOnline ? "● Online" : "○ Offline"}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
            {pal.headline ?? "Pat My Back team"}
          </p>
        </div>
      </div>
      <Link to="/pal/$palId" params={{ palId: pal.user_id }} className="shrink-0 sm:pl-1">
        <Button size="sm" className="h-10 w-full rounded-xl px-5 text-sm font-bold sm:w-auto">
          <Phone className="mr-1.5 h-4 w-4" /> Call
        </Button>
      </Link>
    </div>
  );
}

function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${
        online ? "bg-success" : "bg-muted-foreground/50"
      }`}
      aria-label={online ? "Online" : "Offline"}
    />
  );
}

function PalRow({ pal }: { pal: Pal }) {
  const name = pal.full_name ?? "Pat Pal";
  const isOnline = useIsOnline(pal.user_id);
  return (
    <Link
      to="/pal/$palId"
      params={{ palId: pal.user_id }}
      className="flex items-center gap-3 px-3 py-3"
    >
      <div className="relative">
        <Avatar name={name} url={pal.avatar_url} />
        <PresenceDot online={isOnline} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{name}</p>
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {pal.headline ?? "Here to listen."}
        </p>
        <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
          {tierBadge(pal.tier)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-primary">
          ${(pal.price_cents_per_minute / 100).toFixed(0)}/min
        </p>
        {isOnline ? (
          <p className="text-[10px] font-medium text-success">Online</p>
        ) : pal.rating_avg ? (
          <p className="flex items-center justify-end gap-0.5 text-[10px] text-muted-foreground">
            <Star className="h-2.5 w-2.5 fill-accent text-accent" />
            {Number(pal.rating_avg).toFixed(1)}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
