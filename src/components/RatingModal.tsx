/**
 * RatingModal
 * Post-session rating sheet — appears after a call ends.
 * Clients then see a tip prompt.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, Loader2, X, Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitRating } from "@/lib/rating.functions";
import { createTipIntent, TIP_PRESETS } from "@/lib/tip.functions";
import { CallTopUpPayment } from "@/components/CallTopUpPayment";

interface RatingModalProps {
  sessionId: string;
  rateeName: string;
  durationMinutes: number;
  offerTip?: boolean;
  onDone: () => void;
}

const LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export function RatingModal({
  sessionId,
  rateeName,
  durationMinutes,
  offerTip = false,
  onDone,
}: RatingModalProps) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"rate" | "tip" | "pay" | "done">("rate");
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [tipSecret, setTipSecret] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const active = hovered || stars;

  function goAfterRating() {
    if (offerTip) {
      setStep("tip");
      setBusy(false);
      return;
    }
    setStep("done");
    setTimeout(onDone, 1500);
  }

  async function submit() {
    if (!stars) return;
    setBusy(true);
    try {
      await submitRating({
        data: { sessionId, stars, comment: comment.trim() || undefined },
      });
      toast.success("Thanks for your feedback!");
      goAfterRating();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rating");
      setBusy(false);
    }
  }

  async function startTip(cents: number) {
    setBusy(true);
    try {
      const { clientSecret } = await createTipIntent({ data: { sessionId, cents } });
      setTipCents(cents);
      setTipSecret(clientSecret);
      setStep("pay");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start tip");
    } finally {
      setBusy(false);
    }
  }

  if (!portalTarget) return null;

  const amountLabel = tipCents ? `$${(tipCents / 100).toFixed(tipCents % 100 === 0 ? 0 : 2)}` : "";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 px-4 pb-8">
      <div className="w-full max-w-md rounded-2xl bg-background text-foreground shadow-2xl overflow-hidden">
        {step === "done" ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10">
              <Star className="h-7 w-7 fill-primary text-primary" />
            </div>
            <p className="text-lg font-bold">Thank you!</p>
            <p className="text-sm text-muted-foreground">Your feedback helps the community.</p>
          </div>
        ) : step === "tip" || step === "pay" ? (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-bold text-base leading-tight">Send a tip</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Optional thank-you for {rateeName}
                </p>
              </div>
              <button
                onClick={onDone}
                aria-label="Skip tip"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-6 space-y-4">
              {step === "pay" && tipSecret ? (
                <CallTopUpPayment
                  clientSecret={tipSecret}
                  amountLabel={amountLabel}
                  theme="stripe"
                  description={`Pay ${amountLabel} as a tip for ${rateeName}.`}
                  onSuccess={() => {
                    toast.success("Tip sent — thank you!");
                    setStep("done");
                    setTimeout(onDone, 1500);
                  }}
                  onCancel={() => {
                    setTipSecret(null);
                    setStep("tip");
                  }}
                />
              ) : (
                <>
                  <div className="flex justify-center">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                      <Heart className="h-6 w-6" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {TIP_PRESETS.map((p) => (
                      <button
                        key={p.cents}
                        type="button"
                        disabled={busy}
                        onClick={() => void startTip(p.cents)}
                        className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold hover:border-primary hover:bg-primary/5"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    className="w-full h-11"
                    onClick={onDone}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "No tip"}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-bold text-base leading-tight">Rate your session</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {durationMinutes} min with {rateeName}
                </p>
              </div>
              <button
                onClick={() => (offerTip ? setStep("tip") : onDone())}
                aria-label="Skip rating"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-6 space-y-5">
              <div className="flex flex-col items-center gap-3" onMouseLeave={() => setHovered(0)}>
                <div className="flex gap-1" role="group" aria-label="Star rating">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-label={`${s} star${s > 1 ? "s" : ""}`}
                      onMouseEnter={() => setHovered(s)}
                      onFocus={() => setHovered(s)}
                      onClick={() => setStars(s)}
                      className="rounded-full p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <Star
                        className={cn(
                          "h-10 w-10 transition-colors duration-150",
                          s <= active
                            ? "fill-amber-400 text-amber-400"
                            : "fill-none text-muted-foreground/30",
                        )}
                      />
                    </button>
                  ))}
                </div>
                <p
                  className={cn(
                    "h-5 text-sm font-semibold transition-opacity duration-150",
                    active > 0 ? "text-amber-500 opacity-100" : "opacity-0",
                  )}
                  aria-live="polite"
                >
                  {active > 0 ? LABELS[active] : "Rating"}
                </p>
              </div>

              <div>
                <Textarea
                  placeholder="Leave a comment (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="min-h-0 resize-none rounded-xl bg-background text-foreground caret-foreground placeholder:text-muted-foreground"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {comment.length}/500
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-11 text-foreground"
                  onClick={() => (offerTip ? setStep("tip") : onDone())}
                  disabled={busy}
                >
                  Skip
                </Button>
                <Button
                  className="flex-1 h-11 font-semibold"
                  onClick={submit}
                  disabled={!stars || busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit rating"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    portalTarget,
  );
}
