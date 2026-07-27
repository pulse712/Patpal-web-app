import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { requireAuthBeforeLoad } from "@/lib/auth-guard";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { IncomingCallProvider } from "@/components/IncomingCallProvider";
import { PushRegistration } from "@/components/PushRegistration";
import { IncomingCallDeepLink } from "@/components/IncomingCallDeepLink";

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
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.is_active === false) {
          void supabase.auth.signOut();
          navigate({ to: "/auth", replace: true });
        }
      });
  }, [user, navigate]);

  if (loading) return <AuthPending />;
  if (!user) return null;

  return (
    <IncomingCallProvider userId={user.id}>
      <PushRegistration />
      <IncomingCallDeepLink />
      <Outlet />
    </IncomingCallProvider>
  );
}
