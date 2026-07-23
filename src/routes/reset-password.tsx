import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset password — Pat My Back" }, { name: "robots", content: "noindex" }],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const sessionReadyRef = useRef(false);
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
        sessionReadyRef.current = true;
        setReady(true);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled || !session) return;
        sessionReadyRef.current = true;
        sub.subscription.unsubscribe();
        setReady(true);
      });

      window.setTimeout(() => {
        if (cancelled || sessionReadyRef.current) return;
        sub.subscription.unsubscribe();
        toast.error("This reset link is invalid or has expired.");
        navigate({ to: "/auth", replace: true });
      }, 8000);
    }

    void finish();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    navigate({ to: "/home", replace: true });
  }

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 pt-16">
      <h1 className="text-2xl font-bold">Set a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="np">New password</Label>
          <Input
            id="np"
            type="password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-11 w-full font-semibold" disabled={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}
