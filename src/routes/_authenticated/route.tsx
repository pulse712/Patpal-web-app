import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { requireAuthBeforeLoad } from "@/lib/auth-guard";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { IncomingCallProvider } from "@/components/IncomingCallProvider";
import { PushRegistration } from "@/components/PushRegistration";
import { IncomingCallDeepLink } from "@/components/IncomingCallDeepLink";
import { NotificationProvider } from "@/components/NotificationProvider";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: requireAuthBeforeLoad,
  pendingComponent: AuthPending,
  component: AuthenticatedLayout,
});

function AuthPending() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

/** Handles SSR (no session storage) and client-side auth in one place. */
function AuthenticatedLayout() {
  const { user, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("is_active, approval_status")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        // Fail open on any error or missing row (migration not applied yet,
        // profile row not created yet, transient network error, etc.) —
        // only redirect on a confirmed, successful read that shows the
        // account is actually blocked. Blocking on an unconfirmed read here
        // caused a redirect loop with /account-status, which fails open the
        // same way when it can't confirm a status either.
        if (error || !data) return;
        if (data.is_active === false || data.approval_status !== "approved") {
          navigate({ to: "/account-status", replace: true });
        }
      });
  }, [user, navigate]);

  if (loading) return <AuthPending />;
  if (!user) return null;

  return (
    <IncomingCallProvider userId={user.id}>
      <NotificationProvider userId={user.id}>
        <PushRegistration />
        <IncomingCallDeepLink />
        <Outlet />
      </NotificationProvider>
    </IncomingCallProvider>
  );
}
