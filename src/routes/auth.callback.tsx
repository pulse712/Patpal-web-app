import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendWelcome } from "@/lib/welcome.functions";
import { sendWelcomeOnce } from "@/lib/welcome-client";
import { applySignupRole } from "@/lib/signup.functions";
import { parseSignupRole, parseSignupCategorySlugs, parseSignupService } from "@/lib/signup-role";

/** Handles Supabase email links (#access_token=...) after signup or magic link. */
export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing you in — Pat My Back" }] }),
  component: AuthCallbackPage,
});

function finishSignIn(
  navigate: ReturnType<typeof useNavigate>,
  session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>,
) {
  const email = session.user.email;
  const name =
    (session.user.user_metadata?.full_name as string | undefined) ??
    email?.split("@")[0] ??
    "there";
  const signupRole = parseSignupRole(session.user.user_metadata?.role);
  const categorySlugs = parseSignupCategorySlugs(session.user.user_metadata);
  const service = parseSignupService(session.user.user_metadata);

  void (async () => {
    try {
      await applySignupRole({
        data: {
          role: signupRole,
          ...(signupRole === "pat_pal" && categorySlugs.length > 0
            ? { categorySlugs, ...(service ? { service } : {}) }
            : {}),
        },
      });
    } catch (err) {
      console.error("[auth/callback] applySignupRole failed:", err);
    }

    if (email) {
      void sendWelcomeOnce({
        userId: session.user.id,
        name,
        email,
        send: (data) => sendWelcome({ data }),
      });
    }

    navigate({ to: signupRole === "pat_pal" ? "/pal-dashboard" : "/home", replace: true });
  })();
}

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
        finishSignIn(navigate, data.session);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        if (session) {
          sub.subscription.unsubscribe();
          finishSignIn(navigate, session);
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
