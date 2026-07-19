import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Trash2, Users, DollarSign, PhoneCall, TrendingUp,
  BarChart2, Loader2, Star,
} from "lucide-react";
import { getAnalytics } from "@/lib/analytics.functions";

export const Route = createFileRoute("/admin")({
  component: AdminPanel,
});

type Pal = {
  user_id: string;
  headline: string | null;
  availability: string;
  price_cents_per_minute: number;
  tier: string;
  full_name: string | null;
};
type Code = {
  id: string;
  code: string;
  label: string | null;
  is_active: boolean;
  unlimited: boolean;
  expires_at: string | null;
};
type Banner = {
  id: string;
  title: string;
  body: string | null;
  cta_label: string | null;
  cta_href: string | null;
  is_visible: boolean;
  sort_order: number;
};

type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

function AdminPanel() {
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [pals, setPals] = useState<Pal[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [newCode, setNewCode] = useState({ code: "", label: "", unlimited: false });
  const [newBanner, setNewBanner] = useState({ title: "", body: "", cta_label: "", cta_href: "" });

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    (async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      setIsAdmin(!!data);
      if (data) await refresh();
    })();
  }, [user, loading, navigate]);

  async function refresh() {
    const [p, c, b] = await Promise.all([
      supabase
        .from("pat_pals")
        .select("user_id, headline, availability, price_cents_per_minute, tier")
        .order("created_at", { ascending: false }),
      supabase.from("trial_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("promo_banners").select("*").order("sort_order"),
    ]);
    const palRows = p.data ?? [];
    const ids = palRows.map((r) => r.user_id);
    let nameMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    setPals(palRows.map((r) => ({ ...r, full_name: nameMap.get(r.user_id) ?? null })) as Pal[]);
    setCodes((c.data ?? []) as Code[]);
    setBanners((b.data ?? []) as Banner[]);
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const data = await getAnalytics();
      setAnalytics(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function setAvailability(userId: string, next: "available" | "busy" | "offline") {
    const { error } = await supabase.from("pat_pals").update({ availability: next }).eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    refresh();
  }

  async function createCode() {
    if (!newCode.code) return toast.error("Code is required");
    const { error } = await supabase.from("trial_codes").insert({
      code: newCode.code.trim().toUpperCase(),
      label: newCode.label || null,
      unlimited: newCode.unlimited,
      is_active: true,
    });
    if (error) return toast.error(error.message);
    setNewCode({ code: "", label: "", unlimited: false });
    toast.success("Code created");
    refresh();
  }

  async function toggleCode(id: string, is_active: boolean) {
    await supabase.from("trial_codes").update({ is_active }).eq("id", id);
    refresh();
  }

  async function deleteCode(id: string) {
    await supabase.from("trial_codes").delete().eq("id", id);
    refresh();
  }

  async function createBanner() {
    if (!newBanner.title) return toast.error("Title required");
    const { error } = await supabase.from("promo_banners").insert({
      title: newBanner.title,
      body: newBanner.body || null,
      cta_label: newBanner.cta_label || null,
      cta_href: newBanner.cta_href || null,
      is_visible: true,
      sort_order: banners.length,
    });
    if (error) return toast.error(error.message);
    setNewBanner({ title: "", body: "", cta_label: "", cta_href: "" });
    refresh();
  }

  async function toggleBanner(id: string, is_visible: boolean) {
    await supabase.from("promo_banners").update({ is_visible }).eq("id", id);
    refresh();
  }

  async function deleteBanner(id: string) {
    await supabase.from("promo_banners").delete().eq("id", id);
    refresh();
  }

  if (loading || isAdmin === null) {
    return <AppShell><div className="p-6 text-sm text-muted-foreground">Loading...</div></AppShell>;
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="p-6 space-y-3">
          <h1 className="text-xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted-foreground">You don't have permission to view this page.</p>
          <Button asChild><Link to="/">Back home</Link></Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4 pb-24">
        <header className="rounded-2xl bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground shadow-lg">
          <p className="text-xs uppercase tracking-wide opacity-80">Admin</p>
          <h1 className="text-2xl font-bold">Control panel</h1>
        </header>

        <Tabs defaultValue="analytics">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="pals">Pals</TabsTrigger>
            <TabsTrigger value="codes">Codes</TabsTrigger>
            <TabsTrigger value="banners">Banners</TabsTrigger>
          </TabsList>

          {/* ── Analytics tab ──────────────────────────────────────── */}
          <TabsContent value="analytics" className="space-y-4 mt-4">
            {!analytics && !analyticsLoading && (
              <div className="flex flex-col items-center gap-3 py-10">
                <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Load the latest stats</p>
                <Button onClick={loadAnalytics} className="font-semibold">Load analytics</Button>
              </div>
            )}
            {analyticsLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {analytics && !analyticsLoading && (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={<Users className="h-5 w-5" />} label="Total users" value={analytics.totalUsers} sub={`+${analytics.newUsers7d} this week`} />
                  <StatCard icon={<PhoneCall className="h-5 w-5" />} label="Total sessions" value={analytics.totalSessions} sub={`${analytics.sessions7d} this week`} />
                  <StatCard icon={<DollarSign className="h-5 w-5" />} label="Total revenue" value={`$${analytics.totalRevDollars}`} sub={`$${analytics.rev7dDollars} this week`} />
                  <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Active Pals" value={analytics.activePals} sub={`of ${analytics.totalPals} total`} />
                </div>

                {/* Sessions per day mini-chart */}
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sessions — last 14 days</p>
                  <div className="flex items-end gap-1 h-20">
                    {analytics.sessionsByDay.map(({ date, count }) => {
                      const max = Math.max(...analytics.sessionsByDay.map((d) => d.count), 1);
                      const pct = (count / max) * 100;
                      return (
                        <div key={date} className="flex flex-1 flex-col items-center gap-1 group">
                          <div
                            className="w-full rounded-t bg-primary/70 group-hover:bg-primary transition-colors"
                            style={{ height: `${Math.max(pct, 4)}%` }}
                            title={`${date}: ${count} sessions`}
                          />
                          <span className="text-[9px] text-muted-foreground hidden sm:block">
                            {date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Top Pals */}
                {analytics.topPals.length > 0 && (
                  <Card className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Top Pat Pals (30 days)</p>
                    <div className="space-y-2">
                      {analytics.topPals.map((p, i) => (
                        <div key={p.id} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{p.name}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                            <span className="text-sm font-bold">{p.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Recent sessions */}
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent sessions</p>
                  <div className="space-y-2">
                    {analytics.recentSessions.length === 0 && (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    )}
                    {analytics.recentSessions.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-sm border-b border-border pb-2 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{s.clientName} → {s.palName}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.kind} · {s.minutes}m · ${s.costDollars}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {new Date(s.date).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Button variant="outline" onClick={loadAnalytics} className="w-full">
                  Refresh
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="pals" className="space-y-2">
            {pals.length === 0 && <p className="p-4 text-sm text-muted-foreground">No Pat Pals yet.</p>}
            {pals.map((p) => (
              <Card key={p.user_id} className="space-y-2 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{p.full_name || "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground">{p.headline || "No headline"}</p>
                    <p className="mt-1 text-xs">
                      ${(p.price_cents_per_minute / 100).toFixed(2)}/min · {p.tier} · {p.availability}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAvailability(p.user_id, "available")}>
                    Enable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAvailability(p.user_id, "offline")}>
                    Disable
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="codes" className="space-y-3">
            <Card className="space-y-2 p-3">
              <h3 className="font-semibold">New trial code</h3>
              <Input
                placeholder="CODE"
                value={newCode.code}
                onChange={(e) => setNewCode({ ...newCode, code: e.target.value })}
              />
              <Input
                placeholder="Label (optional)"
                value={newCode.label}
                onChange={(e) => setNewCode({ ...newCode, label: e.target.value })}
              />
              <div className="flex items-center justify-between">
                <Label htmlFor="unlimited">Unlimited access</Label>
                <Switch
                  id="unlimited"
                  checked={newCode.unlimited}
                  onCheckedChange={(v) => setNewCode({ ...newCode, unlimited: v })}
                />
              </div>
              <Button onClick={createCode} className="w-full">Create code</Button>
            </Card>
            {codes.map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="font-mono font-semibold">{c.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.label || "—"} {c.unlimited ? "· unlimited" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={c.is_active} onCheckedChange={(v) => toggleCode(c.id, v)} />
                  <Button size="icon" variant="ghost" onClick={() => deleteCode(c.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="banners" className="space-y-3">
            <Card className="space-y-2 p-3">
              <h3 className="font-semibold">New banner</h3>
              <Input
                placeholder="Title"
                value={newBanner.title}
                onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })}
              />
              <Input
                placeholder="Body"
                value={newBanner.body}
                onChange={(e) => setNewBanner({ ...newBanner, body: e.target.value })}
              />
              <Input
                placeholder="CTA label"
                value={newBanner.cta_label}
                onChange={(e) => setNewBanner({ ...newBanner, cta_label: e.target.value })}
              />
              <Input
                placeholder="CTA link"
                value={newBanner.cta_href}
                onChange={(e) => setNewBanner({ ...newBanner, cta_href: e.target.value })}
              />
              <Button onClick={createBanner} className="w-full">Create banner</Button>
            </Card>
            {banners.map((b) => (
              <Card key={b.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="font-semibold">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.body || "—"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={b.is_visible} onCheckedChange={(v) => toggleBanner(b.id, v)} />
                  <Button size="icon" variant="ghost" onClick={() => deleteBanner(b.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4 space-y-1">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
