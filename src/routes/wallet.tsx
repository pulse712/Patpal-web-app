import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Wallet as WalletIcon, Gift, Clock, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/wallet")({
  head: () => ({ meta: [{ title: "Wallet — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Wallet,
});

type Tx = {
  id: string;
  kind: string;
  seconds_delta: number;
  cents_amount: number | null;
  note: string | null;
  created_at: string;
};

const packs = [
  { minutes: 10, cents: 999 },
  { minutes: 30, cents: 2699, badge: "Popular" },
  { minutes: 60, cents: 4999, badge: "Save 20%" },
  { minutes: 120, cents: 8999 },
];

function Wallet() {
  const navigate = useNavigate();
  const [uid, setUid] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [unlimitedUntil, setUnlimitedUntil] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(id: string) {
    const [{ data: w }, { data: t }] = await Promise.all([
      supabase.from("wallets").select("balance_seconds, unlimited_until").eq("user_id", id).maybeSingle(),
      supabase.from("credit_transactions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(30),
    ]);
    setSeconds(w?.balance_seconds ?? 0);
    setUnlimitedUntil(w?.unlimited_until ?? null);
    setTx((t ?? []) as Tx[]);
  }

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      setUid(sess.session.user.id);
      await load(sess.session.user.id);
    })();
  }, [navigate]);

  async function redeemCode(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !code.trim()) return;
    setBusy(true);
    const trimmed = code.trim().toUpperCase();
    const { data: tc, error } = await supabase
      .from("trial_codes")
      .select("id, code, label, is_active, expires_at, unlimited")
      .eq("code", trimmed)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !tc) {
      setBusy(false);
      toast.error("Invalid code");
      return;
    }
    if (tc.expires_at && new Date(tc.expires_at) < new Date()) {
      setBusy(false);
      toast.error("Code has expired");
      return;
    }
    // Grant 60 free minutes for standard trial codes, or unlimited until expiry
    if (tc.unlimited) {
      const until = tc.expires_at ?? new Date(Date.now() + 7 * 864e5).toISOString();
      await supabase.from("wallets").update({ unlimited_until: until }).eq("user_id", uid);
      await supabase.from("credit_transactions").insert({
        user_id: uid,
        kind: "trial",
        seconds_delta: 0,
        note: `Trial code ${tc.code}: ${tc.label ?? "unlimited"}`,
      });
    } else {
      const grant = 60 * 60;
      await supabase.from("wallets").update({ balance_seconds: seconds + grant }).eq("user_id", uid);
      await supabase.from("credit_transactions").insert({
        user_id: uid,
        kind: "trial",
        seconds_delta: grant,
        note: `Trial code ${tc.code}: ${tc.label ?? "60 minutes"}`,
      });
    }
    setCode("");
    await load(uid);
    setBusy(false);
    toast.success("Code redeemed 🎉");
  }

  function buy(minutes: number) {
    toast.info(`Stripe checkout for ${minutes} min arrives with payments.`);
  }

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const unlimitedActive = unlimitedUntil && new Date(unlimitedUntil) > new Date();

  return (
    <AppShell>
      <section className="relative overflow-hidden bg-hero-gradient px-5 pt-10 pb-8 text-white">
        <div className="flex items-center gap-2 text-sm opacity-90">
          <WalletIcon className="h-4 w-4" /> Your balance
        </div>
        {unlimitedActive ? (
          <>
            <p className="mt-1 text-4xl font-extrabold tracking-tight flex items-center gap-2"><Sparkles className="h-6 w-6" /> Unlimited</p>
            <p className="mt-1 text-sm opacity-90">Until {new Date(unlimitedUntil!).toLocaleDateString()}</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">
              {minutes}<span className="text-xl font-bold opacity-80">m {secs}s</span>
            </p>
            <p className="mt-1 text-sm opacity-90">available to talk</p>
          </>
        )}
      </section>

      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">Top up</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {packs.map((p) => (
            <button
              key={p.minutes}
              onClick={() => buy(p.minutes)}
              className="relative rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-primary/40"
            >
              {p.badge && (
                <span className="absolute -top-2 left-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-accent-foreground">{p.badge}</span>
              )}
              <p className="text-2xl font-extrabold">{p.minutes}<span className="text-sm font-medium text-muted-foreground"> min</span></p>
              <p className="mt-1 text-sm font-semibold text-primary">${(p.cents / 100).toFixed(2)}</p>
              <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                <Plus className="h-3.5 w-3.5" /> Add to wallet
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">Friends &amp; Family code</h2>
        <form onSubmit={redeemCode} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Gift className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ENTER CODE" className="h-11 pl-9 uppercase tracking-wider" />
          </div>
          <Button type="submit" disabled={busy || !code.trim()} className="h-11 font-semibold">Redeem</Button>
        </form>
      </section>

      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">History</h2>
        <div className="mt-3 space-y-2">
          {tx.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            tx.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium capitalize">{t.note ?? t.kind}</p>
                  <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                </div>
                <p className={cn("shrink-0 text-sm font-bold", t.seconds_delta >= 0 ? "text-success" : "text-destructive")}>
                  {t.seconds_delta >= 0 ? "+" : ""}{Math.round(t.seconds_delta / 60)}m
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
