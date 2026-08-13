import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Clock, ShieldAlert, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/BrandLogo";

export const SUPPORT_EMAIL = "thebenhurk@gmail.com";

type Status = "checking" | "pending" | "rejected" | "banned" | "deleted";

type AccountStatusSearch = {
  status?: Exclude<Status, "checking">;
};

export const Route = createFileRoute("/account-status")({
  validateSearch: (search: Record<string, unknown>): AccountStatusSearch => ({
    status:
      search.status === "pending" ||
      search.status === "rejected" ||
      search.status === "banned" ||
      search.status === "deleted"
        ? search.status
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Account status — Pat My Back" }] }),
  component: AccountStatusPage,
});

function AccountStatusPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [status, setStatus] = useState<Status>(search.status ?? "checking");

  useEffect(() => {
    // Message already provided by login redirect — keep it and clear session.
    if (search.status) {
      void supabase.auth.signOut();
      return;
    }

    let cancelled = false;

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
        navigate({ to: "/auth", replace: true });
        return;
      }

      if (!profile) {
        let result: { deleted: boolean };
        try {
          const { ensureMyProfile } = await import("@/lib/account.functions");
          result = await ensureMyProfile();
        } catch (err) {
          console.error("[account-status] ensureMyProfile failed:", err);
          setStatus("pending");
          void supabase.auth.signOut();
          return;
        }
        if (cancelled) return;
        if (result.deleted) {
          setStatus("deleted");
          void supabase.auth.signOut();
          return;
        }
        const { data: healed } = await supabase
          .from("profiles")
          .select("is_active, approval_status")
          .eq("id", sess.session.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!healed || healed.is_active === false) {
          setStatus("banned");
          void supabase.auth.signOut();
          return;
        }
        if (healed.approval_status === "rejected") {
          setStatus("rejected");
          void supabase.auth.signOut();
          return;
        }
        if (healed.approval_status !== "approved") {
          setStatus("pending");
          void supabase.auth.signOut();
          return;
        }
        navigate({ to: "/home", replace: true });
        return;
      }

      if (profile.is_active === false) {
        setStatus("banned");
        void supabase.auth.signOut();
        return;
      }
      if (profile.approval_status === "rejected") {
        setStatus("rejected");
        void supabase.auth.signOut();
        return;
      }
      if (profile.approval_status === "pending") {
        setStatus("pending");
        void supabase.auth.signOut();
        return;
      }

      navigate({ to: "/home", replace: true });
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, [navigate, search.status]);

  async function handleBackToAuth() {
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
            <StatusBody status={status} onBack={handleBackToAuth} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBody({
  status,
  onBack,
}: {
  status: Exclude<Status, "checking">;
  onBack: () => void;
}) {
  const copy = STATUS_COPY[status];
  return (
    <>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {copy.icon}
      </div>
      <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
      {status === "deleted" || status === "rejected" ? (
        <Button asChild className="mt-6 w-full">
          <Link to="/auth">Sign up</Link>
        </Button>
      ) : (
        <Button onClick={onBack} variant="outline" className="mt-6 w-full">
          Back to sign in
        </Button>
      )}
    </>
  );
}

const STATUS_COPY: Record<
  Exclude<Status, "checking">,
  { icon: ReactNode; title: string; body: ReactNode }
> = {
  pending: {
    icon: <Clock className="h-6 w-6 text-amber-600" />,
    title: "Your signup request is being reviewed",
    body: "Your signup request is being reviewed by our support team. This can take up to 24 hours.",
  },
  rejected: {
    icon: <UserX className="h-6 w-6 text-destructive" />,
    title: "Your account does not exist",
    body: "Your account does not exist. Please sign up.",
  },
  banned: {
    icon: <ShieldAlert className="h-6 w-6 text-destructive" />,
    title: "Your account is not active",
    body: (
      <>
        Your account has been deactivated by our support team and you&apos;ve been signed out.
        Please contact support{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-medium text-primary underline underline-offset-2"
        >
          {SUPPORT_EMAIL}
        </a>{" "}
        if you think this is a mistake.
      </>
    ),
  },
  deleted: {
    icon: <UserX className="h-6 w-6 text-destructive" />,
    title: "Your account does not exist",
    body: "Your account does not exist. Please sign up.",
  },
};
