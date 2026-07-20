import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { MessageCircle, DollarSign, Star, Clock } from "lucide-react";
import { useIsOnline } from "@/lib/presence";

export const Route = createFileRoute("/_authenticated/pal-dashboard")({
  component: PalDashboard,
});

type PalRow = {
  user_id: string;
  headline: string | null;
  availability: "available" | "busy" | "offline";
  price_cents_per_minute: number;
  rating_avg: number | null;
  rating_count: number | null;
  tier: string;
};

function PalDashboard() {
  const { user, loading } = useSession();
  const [pal, setPal] = useState<PalRow | null>(null);
  const [isPal, setIsPal] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ sessions: 0, minutes: 0, earnings: 0, unread: 0 });
  const [price, setPrice] = useState<string>("");
  const [headline, setHeadline] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Must be called unconditionally — before any early returns
  const livePresence = useIsOnline(user?.id ?? null);

  useEffect(() => {
    if (loading || !user) return;
    (async () => {
      const { data: roleData } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "pat_pal",
      });
      setIsPal(!!roleData);
      if (!roleData) return;

      const { data: palRow } = await supabase
        .from("pat_pals")
        .select("user_id, headline, availability, price_cents_per_minute, rating_avg, rating_count, tier")
        .eq("user_id", user.id)
        .maybeSingle();
      if (palRow) {
        setPal(palRow as PalRow);
        setPrice(String((palRow.price_cents_per_minute ?? 0) / 100));
        setHeadline(palRow.headline ?? "");
      }

      const { data: sess } = await supabase
        .from("sessions")
        .select("seconds_used, cost_cents")
        .eq("pal_id", user.id)
        .eq("status", "ended");
      const totalSecs   = (sess ?? []).reduce((a, s) => a + (s.seconds_used ?? 0), 0);
      const totalCents  = (sess ?? []).reduce((a, s) => a + (s.cost_cents ?? 0), 0);
      setStats({
        sessions: sess?.length ?? 0,
        minutes:  Math.round(totalSecs / 60),
        earnings: Math.round(totalCents * 0.7), // 70% payout share
        unread:   0,
      });
    })();
  }, [user, loading]);

  async function toggleAvailability(available: boolean) {
    if (!user || !pal) return;
    const next = available ? "available" : "offline";
    const { error } = await supabase
      .from("pat_pals")
      .update({ availability: next })
      .eq("user_id", user.id);
    if (error) { toast.error(error.message); return; }
    setPal({ ...pal, availability: next });
    toast.success(available ? "You're online" : "You're offline");
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    const cents = Math.max(0, Math.round(parseFloat(price || "0") * 100));
    const { error } = await supabase
      .from("pat_pals")
      .update({ price_cents_per_minute: cents, headline })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (pal) setPal({ ...pal, price_cents_per_minute: cents, headline });
    toast.success("Profile updated");
  }

  if (loading || isPal === null) {
    return <AppShell><div className="p-6 text-sm text-muted-foreground">Loading...</div></AppShell>;
  }

  if (!isPal) {
    return (
      <AppShell>
        <div className="p-6 space-y-3">
          <h1 className="text-xl font-semibold">Not a Pat Pal</h1>
          <p className="text-sm text-muted-foreground">This dashboard is for approved Pat Pals only.</p>
          <Button asChild><Link to="/">Back home</Link></Button>
        </div>
      </AppShell>
    );
  }

  const acceptingCalls = pal?.availability === "available";

  return (
    <AppShell>
      <div className="space-y-4 p-4 pb-24">
        <header className="rounded-2xl bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground shadow-lg">
          <p className="text-xs uppercase tracking-wide opacity-80">Pat Pal</p>
          <h1 className="text-2xl font-bold">Your dashboard</h1>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${livePresence ? "bg-success" : "bg-white/40"}`}
            />
            <span className="opacity-90">
              {livePresence ? "You're online right now" : "You appear offline"}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-white/15 px-4 py-3 backdrop-blur">
            <div>
              <p className="text-xs opacity-80">Accepting calls</p>
              <p className="text-sm font-semibold">
                {acceptingCalls ? "Available for calls" : "Not accepting"}
              </p>
            </div>
            <Switch checked={acceptingCalls} onCheckedChange={toggleAvailability} />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={MessageCircle} label="Sessions"  value={stats.sessions} />
          <StatCard icon={Clock}         label="Minutes"   value={stats.minutes} />
          <StatCard
            icon={DollarSign}
            label="Earnings (70%)"
            value={`$${(stats.earnings / 100).toFixed(2)}`}
          />
          <StatCard
            icon={Star}
            label="Rating"
            value={
              pal?.rating_avg
                ? `${Number(pal.rating_avg).toFixed(1)} (${pal.rating_count ?? 0})`
                : "—"
            }
          />
        </div>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Profile</h2>
          <div className="space-y-1.5">
            <Label htmlFor="headline">Headline</Label>
            <Input
              id="headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="What you help with"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price">Price per minute (USD)</Label>
            <Input
              id="price"
              type="number"
              step="0.1"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <Button onClick={saveProfile} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">Quick actions</h2>
          <Button variant="outline" asChild className="w-full justify-start">
            <Link to="/chats">Open chats</Link>
          </Button>
          <Button variant="outline" asChild className="w-full justify-start">
            <Link to="/profile">Edit personal profile</Link>
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-4">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </Card>
  );
}
