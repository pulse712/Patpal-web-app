import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { requireAuthBeforeLoad } from "@/lib/auth-guard";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { IncomingCallProvider } from "@/components/IncomingCallProvider";
import { PushRegistration } from "@/components/PushRegistration";
import { IncomingCallDeepLink } from "@/components/IncomingCallDeepLink";
import { NotificationProvider } from "@/components/NotificationProvider";
import { isMissingColumnError } from "@/lib/postgrest-utils";

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
  // Gates rendering the actual protected content (<Outlet />) until the
  // approval/ban check below has confirmed the account is clear. Without
  // this, a pending/banned/deleted user's page rendered immediately on
  // login and only got redirected away afterward, once the async check
  // resolved — a real gap, not just a cosmetic flash, since a slow
  // connection (or someone not waiting out the redirect) let them keep
  // using the app.
  const [statusOk, setStatusOk] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!userId) return;
    const uid = userId;
    let cancelled = false;
    setStatusOk(false);

    function statusFromProfile(data: {
      is_active: boolean;
      approval_status: string;
    } | null): "pending" | "banned" | "deleted" | "rejected" {
      if (!data) return "deleted";
      if (data.is_active === false) return "banned";
      if (data.approval_status === "rejected") return "rejected";
      if (data.approval_status !== "approved") return "pending";
      // Unreachable when called from checkStatus (approved already handled).
      return "pending";
    }

    function goAccountStatus(status: "pending" | "banned" | "deleted" | "rejected") {
      navigate({ to: "/account-status", search: { status }, replace: true });
    }

    function checkStatus(data: { is_active: boolean; approval_status: string } | null) {
      if (!data || data.is_active === false || data.approval_status !== "approved") {
        goAccountStatus(statusFromProfile(data));
        return;
      }
      if (!cancelled) setStatusOk(true);
    }

    const MAX_ATTEMPTS = 4;
    const RETRY_DELAY_MS = 800;

    async function runCheck(attempt: number): Promise<void> {
      // Prefer authoritative server check (avoids RLS/client flakiness that
      // incorrectly locked approved users out as "pending").
      try {
        const { checkMyAccountAccess } = await import("@/lib/account.functions");
        const gate = await checkMyAccountAccess();
        if (cancelled) return;
        if (gate.allowed) {
          setStatusOk(true);
          return;
        }
        if (gate.reason === "unknown" && attempt < MAX_ATTEMPTS) {
          setTimeout(() => void runCheck(attempt + 1), RETRY_DELAY_MS);
          return;
        }
        goAccountStatus(
          gate.reason === "banned"
            ? "banned"
            : gate.reason === "rejected"
              ? "rejected"
              : gate.reason === "missing"
                ? "deleted"
                : "pending",
        );
        return;
      } catch (err) {
        console.warn("[auth] server account check failed, falling back:", err);
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("is_active, approval_status")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;

      if (error) {
        // Only fail open for the one specific, expected reason: the
        // approval_status column genuinely doesn't exist on this database
        // yet (migration not applied). Anything else — a transient network
        // blip, a momentary connection hiccup right after a fresh redirect,
        // etc. — retries instead of granting access outright. A single
        // one-off error used to permanently unlock the app for the rest of
        // that session, since this check only runs once per login and
        // nothing else re-triggers it if nothing in the row ever changes.
        if (isMissingColumnError(error)) {
          setStatusOk(true);
          return;
        }
        if (attempt < MAX_ATTEMPTS) {
          setTimeout(() => void runCheck(attempt + 1), RETRY_DELAY_MS);
          return;
        }
        // Could not confirm approval after retries — do not unlock the app.
        navigate({ to: "/account-status", search: { status: "pending" }, replace: true });
        return;
      }

      if (data) {
        checkStatus(data);
        return;
      }

      // No row found is ambiguous on its own: it can mean the account was
      // deleted, or (a real, separate bug) that the signup trigger silently
      // failed to create a profile row in the first place — confirmed to
      // happen for at least one existing super_admin. Ask the server to
      // disambiguate, then re-check approval — never grant access blindly.
      // Dynamic import so a missing account.functions chunk does not break
      // the whole authenticated layout for users who already have a profile.
      let result: { deleted: boolean };
      try {
        const { ensureMyProfile } = await import("@/lib/account.functions");
        result = await ensureMyProfile();
      } catch (healErr) {
        console.error("[auth] ensureMyProfile failed:", healErr);
        goAccountStatus("pending");
        return;
      }
      if (cancelled) return;
      if (result.deleted) {
        goAccountStatus("deleted");
        return;
      }

      const { data: healed, error: healedError } = await supabase
        .from("profiles")
        .select("is_active, approval_status")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (healedError || !healed) {
        goAccountStatus("deleted");
        return;
      }
      checkStatus(healed);
    }

    void runCheck(1);

    // Also react live: if an admin deactivates/bans this account while
    // they're already using the app, don't wait for their next page load.
    // A realtime DELETE event is unambiguous (unlike a missing row found on
    // initial load), so no self-heal check is needed here.
    const channel = supabase
      .channel(`profile-status:${uid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        (payload) => checkStatus(payload.new as { is_active: boolean; approval_status: string }),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        () => goAccountStatus("deleted"),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [userId, navigate]);

  if (loading) return <AuthPending />;
  if (!user) return null;
  if (!statusOk) return <AuthPending />;

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
