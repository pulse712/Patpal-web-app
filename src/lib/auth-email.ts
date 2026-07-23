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
