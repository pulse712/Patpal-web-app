import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { HandHeart, Loader2 } from "lucide-react";
import { sendWelcome } from "@/lib/welcome.functions";
import { sendWelcomeOnce } from "@/lib/welcome-client";
import { getAuthRedirectUrl } from "@/lib/auth-redirect";
import { isEmailNotConfirmedError, resendSignupVerification } from "@/lib/auth-email";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Pat My Back" },
      {
        name: "description",
        content:
          "Sign in or create your Pat My Back account to chat, call, and video with Pat Pals.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-6 pt-14 pb-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-hero-gradient shadow-hero">
            <HandHeart className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pat My Back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Talk to a real person who has your back.
          </p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>
          <TabsContent value="login" className="mt-6">
            <LoginForm />
          </TabsContent>
          <TabsContent value="register" className="mt-6">
            <RegisterForm />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function VerificationPendingPanel({
  email,
  onResent,
}: {
  email: string;
  onResent?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onResend() {
    setBusy(true);
    const { error } = await resendSignupVerification(email);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Verification email sent — check inbox and spam.");
    onResent?.();
  }

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-5 text-center">
      <p className="text-sm font-semibold text-foreground">Verify your email</p>
      <p className="mt-2 text-sm text-muted-foreground">
        We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
        Open it to activate your account, then sign in.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Check spam/junk. Gmail may filter mail from Supabase.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 w-full"
        disabled={busy}
        onClick={onResend}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend verification email"}
      </Button>
    </div>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      if (isEmailNotConfirmedError(error.message)) {
        toast.error("Please verify your email first. Use resend below if needed.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success("Welcome back!");
    navigate({ to: "/home", replace: true });
  }

  async function onForgot() {
    if (!email) return toast.error("Enter your email first");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl("/reset-password"),
    });
    if (error) return toast.error(error.message);
    toast.success("Password reset email sent");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
      <button
        type="button"
        onClick={onForgot}
        className="block w-full text-center text-sm text-muted-foreground hover:text-primary"
      >
        Forgot password?
      </button>
      {email ? (
        <button
          type="button"
          onClick={async () => {
            const { error } = await resendSignupVerification(email);
            if (error) return toast.error(error.message);
            toast.success("Verification email sent — check inbox and spam.");
          }}
          className="block w-full text-center text-sm text-muted-foreground hover:text-primary"
        >
          Resend verification email
        </button>
      ) : null}
    </form>
  );
}

function RegisterForm() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Passwords don't match");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    setPendingVerificationEmail(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl("/auth/callback"),
        data: { full_name: fullName, phone, role: "client" },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);

    if (data.session) {
      void sendWelcomeOnce({
        userId: data.session.user.id,
        name: fullName,
        email,
        send: (payload) => sendWelcome({ data: payload }),
      });
      toast.success("Account created!");
      navigate({ to: "/home", replace: true });
      return;
    }

    if (data.user) {
      setPendingVerificationEmail(email);
      toast.success("Check your email to verify your account.");
      return;
    }

    toast.error("Could not create account. Try again.");
  }

  if (pendingVerificationEmail) {
    return <VerificationPendingPanel email={pendingVerificationEmail} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="reg-name">Full name</Label>
        <Input
          id="reg-name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-email">Email</Label>
        <Input
          id="reg-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-phone">Phone number</Label>
        <Input
          id="reg-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-password">Password</Label>
        <Input
          id="reg-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-confirm">Confirm password</Label>
        <Input
          id="reg-confirm"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        By creating an account you agree to our terms and privacy policy.
      </p>
    </form>
  );
}
