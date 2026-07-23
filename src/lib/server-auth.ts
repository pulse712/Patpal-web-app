// Shared server auth middleware: valid JWT + active account.
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const requireActiveAccount = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const userId = (context as unknown as { userId?: string }).userId;
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .single();

    if (profile?.is_active === false) {
      throw new Error("Unauthorized: Account deactivated");
    }

    return next();
  },
);

/** Use on all authenticated server functions. */
export const serverAuth = [requireSupabaseAuth, requireActiveAccount] as const;
