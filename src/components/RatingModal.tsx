/**
 * RatingModal
 * Post-session rating sheet — appears after a call ends.
 * Shows star selector + optional comment. Submits via server fn.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitRating } from "@/lib/rating.functions";

interface RatingModalProps {
  sessionId: string;
  rateeName: string;
  durationMinutes: number;
  onDone: () => void;
}

const LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export function RatingModal({
  sessionId,
  rateeName,
  durationMinutes,
  onDone,
}: RatingModalProps) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const active = hovered || stars;

  async function submit() {
    if (!stars) return;
    setBusy(true);
    try {
      await submitRating({
        data: { sessionId, stars, comment: comment.trim() || undefined },
      });
      setDone(true);
      toast.success("Thanks for your feedback!");
      setTimeout(onDone, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rating");
      setBusy(false);
    }
  }

  if (!portalTarget) return null;

  return createPortal(
    /* Backdrop — portaled to body so CallScreen text-white cannot leak in */
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 px-4 pb-8">
      <div className="w-full max-w-md rounded-2xl bg-background text-foreground shadow-2xl overflow-hidden">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10">
              <Star className="h-7 w-7 fill-primary text-primary" />
            </div>
            <p className="text-lg font-bold">Rating saved!</p>
            <p className="text-sm text-muted-foreground">Thanks for helping the community.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-bold text-base leading-tight">Rate your session</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {durationMinutes} min with {rateeName}
                </p>
              </div>
              <button
                onClick={onDone}
                aria-label="Skip rating"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-6 space-y-5">
              {/* Stars — hover on container avoids gap flicker; fixed label height stops layout jump */}
              <div
                className="flex flex-col items-center gap-3"
                onMouseLeave={() => setHovered(0)}
              >
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

              {/* Optional comment */}
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

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-11 text-foreground"
                  onClick={onDone}
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
