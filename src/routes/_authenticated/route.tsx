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

    function checkStatus(data: { is_active: boolean; approval_status: string } | null) {
      // No row at all is a confirmed fact, not an unconfirmed one — for
      // someone already inside the authenticated app, their profile row
      // must have existed when they signed up, so its absence now means the
      // account was deleted. Treat that the same as banned/not-approved.
      if (!data || data.is_active === false || data.approval_status !== "approved") {
        navigate({ to: "/account-status", replace: true });
      }
    }

    supabase
      .from("profiles")
      .select("is_active, approval_status")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        // Only a genuine error (migration not applied yet, transient
        // network error, etc.) fails open — we can't confirm anything then.
        // A clean read, even one that finds zero rows, is confirmed and
        // goes through checkStatus like any other result.
        if (error) return;
        checkStatus(data);
      });

    // Also react live: if an admin deactivates/bans/deletes this account
    // while they're already using the app, don't wait for their next page
    // load.
    const channel = supabase
      .channel(`profile-status:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => checkStatus(payload.new as { is_active: boolean; approval_status: string }),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        () => checkStatus(null),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
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
