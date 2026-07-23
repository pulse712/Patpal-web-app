import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side auth gate for protected routes.
 * SSR has no Supabase session in storage — AuthenticatedLayout redirects
 * unauthenticated users once the client hydrates (see _authenticated/route.tsx).
 */
export async function requireAuthBeforeLoad() {
  if (typeof window === "undefined") {
    return { ssrPendingAuth: true as const };
  }

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/auth", replace: true });
  }

  return { userId: data.session.user.id };
}
