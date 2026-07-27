import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { serverAuth } from "@/lib/server-auth";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isAdmin && !isSuperAdmin) throw new Error("Unauthorized");
  return { isSuperAdmin: !!isSuperAdmin };
}

/**
 * Client-side admin gate for /admin beforeLoad.
 * Server functions lack the user JWT during router beforeLoad, so role checks
 * must run against the browser Supabase session (same pattern as requireAuthBeforeLoad).
 */
export async function requireAdminBeforeLoad() {
  if (typeof window === "undefined") {
    return { ssrPendingAdmin: true as const, isSuperAdmin: false };
  }

  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", replace: true });
    }

    const userId = data.session.user.id;
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);

    if (!isAdmin && !isSuperAdmin) {
      throw redirect({ to: "/home", replace: true });
    }

    return { isSuperAdmin: !!isSuperAdmin };
  } catch (err) {
    if (err && typeof err === "object" && "isRedirect" in err) throw err;
    throw redirect({ to: "/home", replace: true });
  }
}

/** Server-side admin check for admin API handlers. */
export const checkAdminAccess = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const { isSuperAdmin } = await assertAdmin(context.userId);
    return { isSuperAdmin };
  });

export { assertAdmin };
