import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Handles Supabase email links (#access_token=...) after signup or magic link. */
export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing you in — Pat My Back" }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error) {
        toast.error(error.message);
        navigate({ to: "/auth", replace: true });
        return;
      }

      if (data.session) {
        navigate({ to: "/home", replace: true });
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        if (session) {
          sub.subscription.unsubscribe();
          navigate({ to: "/home", replace: true });
        }
      });

      window.setTimeout(() => {
        if (cancelled) return;
        sub.subscription.unsubscribe();
        toast.error("Sign-in link expired or invalid. Try again.");
        navigate({ to: "/auth", replace: true });
      }, 8000);
    }

    void finish();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Signing in" />
    </div>
  );
}
