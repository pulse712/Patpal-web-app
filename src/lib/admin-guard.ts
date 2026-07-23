import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
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

/** Route guard — redirect non-admins away from /admin. */
export const checkAdminAccess = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    try {
      await assertAdmin(context.userId);
      return { ok: true as const };
    } catch {
      throw redirect({ to: "/home", replace: true });
    }
  });

export { assertAdmin };
