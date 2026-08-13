import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Clock, ShieldAlert, XCircle, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/account-status")({
  head: () => ({ meta: [{ title: "Account status — Pat My Back" }] }),
  component: AccountStatusPage,
});

type Status = "checking" | "pending" | "rejected" | "banned" | "deleted";

const POLL_MS = 5000;

function AccountStatusPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!sess.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("is_active, approval_status")
        .eq("id", sess.session.user.id)
        .maybeSingle();
      if (cancelled) return;

      if (error) {
        // Can't confirm anything (migration not applied yet, transient
        // network error, etc.) — don't strand them on this page forever.
        navigate({ to: "/home", replace: true });
        return;
      }

      if (!profile) {
        // A clean read finding zero rows is confirmed, not unconfirmed —
        // the account was deleted.
        setStatus("deleted");
        void supabase.auth.signOut();
        return;
      }

      if (profile.is_active === false) {
        setStatus("banned");
        // Deactivated accounts are signed out immediately — the message
        // above stays visible since it's driven by local state, not by
        // the session, but the underlying session/token is invalidated
        // right away rather than lingering until it naturally expires.
        void supabase.auth.signOut();
        return;
      }
      if (profile.approval_status === "rejected") {
        setStatus("rejected");
        return;
      }
      if (profile.approval_status === "pending") {
        setStatus("pending");
        timer = setTimeout(check, POLL_MS);
        return;
      }

      // Approved and active — release them into the app.
      navigate({ to: "/home", replace: true });
    }

    void check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [navigate]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <BrandLogo />
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          {status === "checking" ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          ) : (
            <StatusBody status={status} onSignOut={handleSignOut} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBody({
  status,
  onSignOut,
}: {
  status: Exclude<Status, "checking">;
  onSignOut: () => void;
}) {
  const copy = STATUS_COPY[status];
  return (
    <>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {copy.icon}
      </div>
      <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
      <Button onClick={onSignOut} variant="outline" className="mt-6 w-full">
        Sign out
      </Button>
    </>
  );
}

const STATUS_COPY: Record<
  Exclude<Status, "checking">,
  { icon: ReactNode; title: string; body: string }
> = {
  pending: {
    icon: <Clock className="h-6 w-6 text-amber-600" />,
    title: "Waiting for support team's approval",
    body: "We're checking your request. You'll be able to sign in as soon as our support team approves your account — this page will update automatically.",
  },
  rejected: {
    icon: <XCircle className="h-6 w-6 text-destructive" />,
    title: "Signup request not approved",
    body: "Our support team was not able to approve your signup request. If you think this is a mistake, please contact support.",
  },
  banned: {
    icon: <ShieldAlert className="h-6 w-6 text-destructive" />,
    title: "Your account is not active",
    body: "Your account has been deactivated by our support team and you've been signed out. Please contact support if you think this is a mistake.",
  },
  deleted: {
    icon: <UserX className="h-6 w-6 text-destructive" />,
    title: "This account no longer exists",
    body: "Your account was removed by our support team and you've been signed out. You're welcome to sign up again with the same email.",
  },
};
