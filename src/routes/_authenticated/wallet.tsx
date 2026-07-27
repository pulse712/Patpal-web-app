import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Wallet as WalletIcon,
  Gift,
  Clock,
  Sparkles,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createCheckoutSession } from "@/lib/stripe.functions";
import { redeemTrialCode } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/wallet")({
  validateSearch: (search: Record<string, unknown>) => ({
    payment: (search.payment as string | undefined) ?? undefined,
  }),
  head: () => ({
    meta: [{ title: "Wallet — Pat My Back" }, { name: "robots", content: "noindex" }],
  }),
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

// Credit packages — must match stripe.server.ts CREDIT_PACKAGES
const PACKAGES = [
  { id: "pack_15min", label: "15 minutes", minutes: "15 min", price: "$10", badge: undefined },
  { id: "pack_30min", label: "30 minutes", minutes: "30 min", price: "$18", badge: "Popular" },
  { id: "pack_60min", label: "60 minutes", minutes: "60 min", price: "$30", badge: undefined },
] as const;

function Wallet() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/wallet" });

  const [uid, setUid] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [unlimitedUntil, setUnlimitedUntil] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx[]>([]);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const balanceBeforePaymentRef = useRef<number | null>(null);

  const load = useCallback(async (id: string) => {
    const [{ data: w }, { data: t }] = await Promise.all([
      supabase
        .from("wallets")
        .select("balance_seconds, unlimited_until")
        .eq("user_id", id)
        .maybeSingle(),
      supabase
        .from("credit_transactions")
        .select("*")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setSeconds(w?.balance_seconds ?? 0);
    setUnlimitedUntil(w?.unlimited_until ?? null);
    setTx((t ?? []) as Tx[]);
  }, []);

  // Handle return from Stripe checkout — poll until webhook credits wallet
  useEffect(() => {
    if (search.payment !== "success" || !uid) return;

    navigate({ to: "/wallet", search: { payment: undefined }, replace: true });

    let cancelled = false;
    const baseline = balanceBeforePaymentRef.current ?? seconds;

    (async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        const { data: w, error } = await supabase
          .from("wallets")
          .select("balance_seconds")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) break;

        const next = w?.balance_seconds ?? 0;
        if (next > baseline) {
          setSeconds(next);
          toast.success("Payment successful! Your balance has been updated.", {
            icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
            duration: 5000,
          });
          await load(uid);
          balanceBeforePaymentRef.current = null;
          return;
        }

        await new Promise((r) => window.setTimeout(r, 1500));
      }

      if (!cancelled) {
        await load(uid);
        toast.info("Payment received — balance may take a moment to update.", { duration: 6000 });
        balanceBeforePaymentRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search.payment, uid, navigate, load]);

  useEffect(() => {
    if (search.payment === "cancelled") {
      toast.info("Payment cancelled — no charge was made.");
      navigate({ to: "/wallet", search: { payment: undefined }, replace: true });
      balanceBeforePaymentRef.current = null;
    }
  }, [search.payment, navigate]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      setUid(sess.session.user.id);
      await load(sess.session.user.id);
    })();
  }, [load]);

  // Reload balance when user returns to tab (e.g. after Stripe redirect)
  useEffect(() => {
    const handleFocus = () => {
      if (uid) load(uid);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [uid, load]);

  async function redeemCode(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !code.trim()) return;
    setCodeBusy(true);
    try {
      await redeemTrialCode({ data: { code: code.trim() } });
      setCode("");
      await load(uid);
      toast.success("Code redeemed 🎉");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not redeem code");
    } finally {
      setCodeBusy(false);
    }
  }

  async function buyPackage(packageId: string, _label: string) {
    balanceBeforePaymentRef.current = seconds;
    setBuyingId(packageId);
    try {
      const { url } = await createCheckoutSession({
        data: { packageId, returnOrigin: window.location.origin },
      });
      window.location.href = url;
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message.includes("STRIPE_SECRET_KEY")
          ? "Payments are not configured yet. Ask the site owner to add Stripe keys in Vercel."
          : err instanceof Error
            ? err.message
            : "Could not start checkout — please try again.";
      toast.error(message);
      setBuyingId(null);
    }
  }

  async function buyCustom(e: React.FormEvent) {
    e.preventDefault();
    const dollars = parseFloat(customAmount);
    if (isNaN(dollars) || dollars < 5) {
      toast.error("Minimum custom amount is $5");
      return;
    }
    setBuyingId("custom");
    balanceBeforePaymentRef.current = seconds;
    try {
      const customCents = Math.round(dollars * 100);
      const { url } = await createCheckoutSession({
        data: { customCents, returnOrigin: window.location.origin },
      });
      window.location.href = url;
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message.includes("STRIPE_SECRET_KEY")
          ? "Payments are not configured yet. Ask the site owner to add Stripe keys in Vercel."
          : err instanceof Error
            ? err.message
            : "Could not start checkout — please try again.";
      toast.error(message);
      setBuyingId(null);
    }
  }

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const unlimitedActive = unlimitedUntil && new Date(unlimitedUntil) > new Date();
  const lowBalance = !unlimitedActive && seconds < 10 * 60;

  return (
    <AppShell>
      {/* Balance hero */}
      <section className="relative overflow-hidden bg-hero-gradient px-5 pt-10 pb-8 text-white">
        <div className="flex items-center gap-2 text-sm opacity-90">
          <WalletIcon className="h-4 w-4" /> Your balance
        </div>
        {unlimitedActive ? (
          <>
            <p className="mt-1 text-4xl font-extrabold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6" /> Unlimited
            </p>
            <p className="mt-1 text-sm opacity-90">
              Until {new Date(unlimitedUntil!).toLocaleDateString()}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">
              {minutes}
              <span className="text-xl font-bold opacity-80">m {secs}s</span>
            </p>
            <p className="mt-1 text-sm opacity-90">available to talk</p>
          </>
        )}
      </section>

      {/* Low balance warning */}
      {lowBalance && (
        <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Your balance is running low — top up to stay connected.</p>
        </div>
      )}

      {/* Buy minutes */}
      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">Buy Minutes</h2>
        <p className="text-sm text-muted-foreground">One-time credit — never expires.</p>
        <div className="mt-3 space-y-3">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              onClick={() => buyPackage(pkg.id, pkg.label)}
              disabled={!!buyingId}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-primary/40 disabled:opacity-60"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold">{pkg.minutes}</p>
                  {pkg.badge && <Badge className="text-[10px]">{pkg.badge}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-primary">{pkg.price}</p>
                {buyingId === pkg.id && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Tax calculated at checkout · Powered by Stripe
        </p>
      </section>

      {/* Custom amount */}
      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">Custom Amount</h2>
        <p className="text-sm text-muted-foreground">Top up any amount ($5 minimum).</p>
        <form onSubmit={buyCustom} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <Input
              type="number"
              min="5"
              step="1"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="20"
              className="h-11 pl-7"
            />
          </div>
          <Button
            type="submit"
            disabled={!!buyingId || !customAmount}
            className="h-11 font-semibold"
          >
            {buyingId === "custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay"}
          </Button>
        </form>
      </section>

      {/* Friends & Family trial code */}
      <section className="px-5 pt-6">
        <h2 className="text-base font-bold">Friends &amp; Family Code</h2>
        <form onSubmit={redeemCode} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Gift className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ENTER CODE"
              className="h-11 pl-9 uppercase tracking-wider"
            />
          </div>
          <Button type="submit" disabled={codeBusy || !code.trim()} className="h-11 font-semibold">
            {codeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem"}
          </Button>
        </form>
      </section>

      {/* Transaction history */}
      <section className="px-5 pt-6 pb-8">
        <h2 className="text-base font-bold">History</h2>
        <div className="mt-3 space-y-2">
          {tx.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No transactions yet
            </p>
          ) : (
            tx.map((t) => {
              const isCredit = t.seconds_delta >= 0;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                    {t.kind === "purchase" ? (
                      <WalletIcon className="h-4 w-4" />
                    ) : t.kind === "trial" ? (
                      <Gift className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium capitalize">{t.note ?? t.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                      {t.cents_amount ? ` · $${(t.cents_amount / 100).toFixed(2)}` : ""}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "shrink-0 text-sm font-bold",
                      isCredit ? "text-green-600 dark:text-green-400" : "text-destructive",
                    )}
                  >
                    {isCredit ? "+" : ""}
                    {Math.round(t.seconds_delta / 60)}m
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>
    </AppShell>
  );
}
