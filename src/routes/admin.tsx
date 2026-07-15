import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Trash2 } from "lucide-react";

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

function AdminPanel() {
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [pals, setPals] = useState<Pal[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);

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

        <Tabs defaultValue="pals">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pals">Pals</TabsTrigger>
            <TabsTrigger value="codes">Codes</TabsTrigger>
            <TabsTrigger value="banners">Banners</TabsTrigger>
          </TabsList>

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