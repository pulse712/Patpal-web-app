import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signOutUser } from "@/lib/availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CategoryPicker } from "@/components/CategoryPicker";
import { toast } from "sonner";
import { Loader2, MessageCircle, Users } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { sendWelcome } from "@/lib/welcome.functions";
import { sendWelcomeOnce } from "@/lib/welcome-client";
import { getAuthRedirectUrl } from "@/lib/auth-redirect";
import {
  isEmailNotConfirmedError,
  isEmailRateLimitError,
  emailRateLimitMessage,
  formatAuthEmailError,
  resendSignupVerification,
} from "@/lib/auth-email";
import { applySignupRole, checkDisplayNameAvailable } from "@/lib/signup.functions";
import type { SignupRole } from "@/lib/signup-role";
import { resolveAccountGate, accountStatusFromGate } from "@/lib/account-access";

const ACCOUNT_NOT_FOUND_MESSAGE = "Your account does not exist. Please sign up.";

type SignupCategory = { id: string; name: string; slug: string; emoji: string | null };

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
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const gate = await resolveAccountGate(data.session.user.id);
      if (gate.allowed) {
        navigate({ to: "/home", replace: true });
        return;
      }
      if (gate.reason === "unknown") {
        // Don't force a pending lockout on a flaky check while already signed in.
        return;
      }
      navigate({
        to: "/account-status",
        search: { status: accountStatusFromGate(gate.reason) },
        replace: true,
      });
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-6 pt-14 pb-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo className="mb-4 h-14 max-w-[240px]" />
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

function VerificationPendingPanel({ email, onResent }: { email: string; onResent?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setTimeout(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSec]);

  async function onResend() {
    if (cooldownSec > 0) return;
    setBusy(true);
    const { error } = await resendSignupVerification(email);
    setBusy(false);
    if (error) return toast.error(formatAuthEmailError(error.message));
    toast.success("Verification email sent — check inbox and spam.");
    setCooldownSec(60);
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
        Check spam/junk. If nothing arrives after a few minutes, contact support — we can activate
        your account manually.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 w-full"
        disabled={busy || cooldownSec > 0}
        onClick={onResend}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : cooldownSec > 0 ? (
          `Resend available in ${cooldownSec}s`
        ) : (
          "Resend verification email"
        )}
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      if (isEmailNotConfirmedError(error.message)) {
        toast.error("Please verify your email first. Use resend below if needed.");
      } else if (/invalid login credentials|invalid email or password|user not found/i.test(error.message)) {
        toast.error(ACCOUNT_NOT_FOUND_MESSAGE);
      } else {
        toast.error(error.message);
      }
      return;
    }

    const userId = data.user?.id ?? data.session?.user.id;
    if (!userId) {
      setBusy(false);
      toast.error(ACCOUNT_NOT_FOUND_MESSAGE);
      return;
    }

    const gate = await resolveAccountGate(userId);
    setBusy(false);
    if (!gate.allowed) {
      if (gate.reason === "unknown") {
        toast.error("Could not verify your account status. Please try again.");
        await signOutUser();
        return;
      }
      navigate({
        to: "/account-status",
        search: { status: accountStatusFromGate(gate.reason) },
        replace: true,
      });
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
            if (error) return toast.error(formatAuthEmailError(error.message));
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
  const [signupRole, setSignupRole] = useState<SignupRole>("client");
  const [categorySlugs, setCategorySlugs] = useState<string[]>([]);
  const [service, setService] = useState("");
  const [categories, setCategories] = useState<SignupCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug, emoji")
        .order("sort_order");
      if (!error && data) setCategories(data as SignupCategory[]);
      setCategoriesLoading(false);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Passwords don't match");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (signupRole === "pat_pal" && categorySlugs.length === 0) {
      return toast.error("Please choose at least one support category.");
    }
    if (signupRole === "pat_pal" && service.trim().length < 3) {
      return toast.error("Please describe your service (at least 3 characters).");
    }
    if (!fullName.trim()) return toast.error("Please enter your name.");

    if (signupRole === "pat_pal") {
      try {
        const nameCheck = await checkDisplayNameAvailable({
          data: { fullName: fullName.trim() },
        });
        if (!nameCheck.available) {
          return toast.error("That display name is already taken. Please choose another.");
        }
      } catch (err) {
        return toast.error(err instanceof Error ? err.message : "Could not verify name");
      }
    }

    setBusy(true);
    setPendingVerificationEmail(null);
    const signupMetadata: Record<string, string> = {
      full_name: fullName,
      phone,
      role: signupRole,
    };
    if (signupRole === "pat_pal") {
      signupMetadata.category_slugs = categorySlugs.join(",");
      signupMetadata.category_slug = categorySlugs[0] ?? "";
      signupMetadata.service = service.trim();
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthRedirectUrl("/auth/callback"),
        data: signupMetadata,
      },
    });
    setBusy(false);
    if (error) {
      if (isEmailRateLimitError(error.message)) return toast.error(emailRateLimitMessage());
      return toast.error(error.message);
    }

    // Supabase deliberately doesn't return an error for signUp() when the
    // email already has a confirmed account (anti-enumeration behavior) —
    // it returns a user object with no session and an empty identities
    // array instead of a new signup.
    if (data.user && data.user.identities?.length === 0) {
      toast.error("You've already signed up with this email. Please sign in instead.");
      return;
    }

    if (data.session) {
      try {
        await applySignupRole({
          data: {
            role: signupRole,
            ...(signupRole === "pat_pal" ? { categorySlugs, service: service.trim() } : {}),
          },
        });
      } catch (err) {
        console.error("[signup] applySignupRole failed:", err);
        toast.error("Account created, but role setup failed. Try signing in or contact support.");
        navigate({ to: "/auth", replace: true });
        return;
      }
      void sendWelcomeOnce({
        userId: data.session.user.id,
        name: fullName,
        email,
        send: (payload) => sendWelcome({ data: payload }),
      });
      toast.success(
        signupRole === "pat_pal"
          ? "Account created — waiting for admin approval."
          : "Account created — welcome!",
      );
      if (signupRole === "pat_pal") {
        navigate({ to: "/account-status", search: { status: "pending" }, replace: true });
      } else {
        navigate({ to: "/home", replace: true });
      }
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
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">I am signing up as</legend>
        <RadioGroup
          value={signupRole}
          onValueChange={(value) => {
            setSignupRole(value as SignupRole);
            if (value === "client") {
              setCategorySlugs([]);
              setService("");
            }
          }}
          className="grid gap-2"
        >
          <label
            htmlFor="role-client"
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
              signupRole === "client"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40",
            )}
          >
            <RadioGroupItem value="client" id="role-client" className="mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageCircle className="h-4 w-4 text-primary" />
                Customer
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Browse Pat Pals, buy credits, and start chats or calls.
              </p>
            </div>
          </label>
          <label
            htmlFor="role-pal"
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
              signupRole === "pat_pal"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40",
            )}
          >
            <RadioGroupItem value="pat_pal" id="role-pal" className="mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-4 w-4 text-primary" />
                Pat Pal
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Offer support, set your availability, and receive sessions.
              </p>
            </div>
          </label>
        </RadioGroup>
      </fieldset>
      {signupRole === "pat_pal" && (
        <div className="space-y-1.5">
          <Label>Support categories</Label>
          <CategoryPicker
            categories={categories}
            value={categorySlugs}
            onChange={setCategorySlugs}
            disabled={busy}
            loading={categoriesLoading}
          />
          <p className="text-xs text-muted-foreground">
            Customers will find you when browsing these categories.
          </p>
        </div>
      )}
      {signupRole === "pat_pal" && categorySlugs.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="reg-service">Your service</Label>
          <Input
            id="reg-service"
            required
            minLength={3}
            maxLength={200}
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. Career coaching for new graduates"
          />
          <p className="text-xs text-muted-foreground">
            A short line about what you offer — shown on your Pat Pal profile.
          </p>
        </div>
      )}
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
