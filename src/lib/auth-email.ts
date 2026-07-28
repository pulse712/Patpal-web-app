import { supabase } from "@/integrations/supabase/client";
import { getAuthRedirectUrl } from "@/lib/auth-redirect";

/** Ask Supabase Auth to resend the signup confirmation email. */
export async function resendSignupVerification(email: string) {
  return supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: getAuthRedirectUrl("/auth/callback") },
  });
}

export function isEmailNotConfirmedError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("email not confirmed") || lower.includes("not verified");
}

export function isEmailRateLimitError(message: string): boolean {
  return message.toLowerCase().includes("rate limit");
}

export function emailRateLimitMessage(): string {
  return "Email sending is temporarily limited. Wait about an hour before requesting another verification email, or contact support to activate your account.";
}

export function formatAuthEmailError(message: string): string {
  if (isEmailRateLimitError(message)) return emailRateLimitMessage();
  return message;
}
