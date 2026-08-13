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
import { ensureMyProfile } from "@/lib/account.functions";

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
      if (!data || data.is_active === false || data.approval_status !== "approved") {
        navigate({ to: "/account-status", replace: true });
      }
    }

    supabase
      .from("profiles")
      .select("is_active, approval_status")
      .eq("id", user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        // A genuine error (migration not applied yet, transient network
        // error, etc.) fails open — we can't confirm anything then.
        if (error) return;
        if (data) {
          checkStatus(data);
          return;
        }
        // No row found is ambiguous on its own: it can mean the account was
        // deleted, or (a real, separate bug) that the signup trigger
        // silently failed to create a profile row in the first place —
        // confirmed to happen for at least one existing super_admin. Ask
        // the server to disambiguate before concluding "deleted".
        const result = await ensureMyProfile();
        if (result.deleted) {
          navigate({ to: "/account-status", replace: true });
        }
        // Otherwise the row now exists (self-healed) — nothing to do.
      });

    // Also react live: if an admin deactivates/bans this account while
    // they're already using the app, don't wait for their next page load.
    // A realtime DELETE event is unambiguous (unlike a missing row found on
    // initial load), so no self-heal check is needed here.
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
        () => navigate({ to: "/account-status", replace: true }),
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
