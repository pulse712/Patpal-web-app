import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { serverAuth } from "@/lib/server-auth";

/** Route guard — redirect non–Pat Pals away from /pal-dashboard. */
export const checkPalAccess = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isPal, error } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "pat_pal",
    });
    if (error || !isPal) {
      throw redirect({ to: "/home", replace: true });
    }
    return { ok: true as const };
  });
