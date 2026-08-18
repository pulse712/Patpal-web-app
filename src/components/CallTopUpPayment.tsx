import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPublicEnv } from "@/lib/public-env";

type CallTopUpPaymentProps = {
  clientSecret: string;
  amountLabel: string;
  onSuccess: () => void;
  onCancel: () => void;
  description?: string;
  theme?: "night" | "stripe";
};

/** Stripe Payment Element for mid-call top-up or post-call tips. */
export function CallTopUpPayment({
  clientSecret,
  amountLabel,
  onSuccess,
  onCancel,
  description,
  theme = "night",
}: CallTopUpPaymentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    let paymentElement: import("@stripe/stripe-js").StripePaymentElement | null = null;

    (async () => {
      const key = getPublicEnv("VITE_STRIPE_PUBLISHABLE_KEY");
      if (!key || key.includes("YOUR_")) {
        toast.error("Stripe is not configured.");
        return;
      }

      const stripe = await loadStripe(key);
      if (!stripe || !containerRef.current || !mounted) return;

      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret,
        appearance: { theme, variables: { colorPrimary: "#0EA5A0" } },
      });
      elementsRef.current = elements;
      paymentElement = elements.create("payment");
      paymentElement.mount(containerRef.current);
      paymentElement.on("ready", () => {
        if (mounted) setReady(true);
      });
    })();

    return () => {
      mounted = false;
      paymentElement?.destroy();
    };
  }, [clientSecret, theme]);

  async function handlePay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;

    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    setBusy(false);

    if (error) {
      toast.error(error.message ?? "Payment failed");
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      onSuccess();
      return;
    }

    toast.error("Payment incomplete. Please try again.");
  }

  return (
    <div className="mt-4 space-y-3">
      <p className={theme === "night" ? "text-xs text-gray-400" : "text-xs text-muted-foreground"}>
        {description ?? `Pay ${amountLabel} to add time to this call.`}
      </p>
      <div ref={containerRef} className="min-h-[120px] rounded-lg bg-white/5 p-2" />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className={
            theme === "night" ? "flex-1 border-white/20 text-white hover:bg-white/10" : "flex-1"
          }
          disabled={busy}
          onClick={onCancel}
        >
          Back
        </Button>
        <Button
          type="button"
          className="flex-1 font-semibold"
          disabled={!ready || busy}
          onClick={handlePay}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pay now"}
        </Button>
      </div>
    </div>
  );
}
