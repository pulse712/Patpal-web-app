import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Redirect unauthenticated users to /auth. Client-only — SSR has no session storage. */
export async function requireAuthBeforeLoad() {
  if (typeof window === "undefined") return;

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/auth", replace: true });
  }

  return { userId: data.session.user.id };
}
