import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { serverAuth } from "@/lib/server-auth";
import type { AccountGateResult } from "@/lib/account-access";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Authoritative account gate via service role (bypasses RLS).
 * Uses requireSupabaseAuth only — banned/pending users must still receive a
 * status result instead of a hard Unauthorized from requireActiveAccount.
 */
export const checkMyAccountAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountGateResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("is_active, approval_status")
      .eq("id", context.userId)
      .maybeSingle();

    if (error) {
      // Migration not applied yet — do not block every login on older DBs.
      if (/approval_status/i.test(error.message)) return { allowed: true };
      return { allowed: false, reason: "unknown" };
    }

    if (!data) return { allowed: false, reason: "missing" };
    if (data.is_active === false) return { allowed: false, reason: "banned" };
    if (data.approval_status === "rejected") return { allowed: false, reason: "rejected" };
    if (data.approval_status === "pending") return { allowed: false, reason: "pending" };
    if (data.approval_status !== "approved") return { allowed: false, reason: "pending" };

    return { allowed: true };
  });

/**
 * Called when the client finds no `profiles` row for the current session.
 * That's ambiguous on its own — it can mean the account was deleted, or
 * (a real, pre-existing gap) that `handle_new_user()`'s trigger silently
 * failed to create one at signup. Attempting the insert and checking *why*
 * it failed disambiguates authoritatively: a foreign-key violation means
 * auth.users itself has no row with this id (genuinely deleted); any other
 * outcome means the row now exists (already did, or just self-healed).
 *
 * Uses requireSupabaseAuth only so pending accounts (still is_active) can
 * self-heal without being blocked by requireActiveAccount.
 */
export const ensureMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (existing) return { deleted: false as const };

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const fallbackName =
      (authUser.user?.user_metadata?.full_name as string | undefined)?.trim() ||
      authUser.user?.email?.split("@")[0] ||
      "";

    // Only staff are auto-approved on self-heal. Pat Pals stay pending so a
    // missing profile row cannot bypass the signup approval gate. Customers
    // are approved immediately.
    const [{ data: isAdmin }, { data: isSuperAdmin }, { data: isPatPal }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "pat_pal" }),
    ]);
    const isStaff = !!(isAdmin || isSuperAdmin);
    const approvalStatus = isStaff || !isPatPal ? "approved" : "pending";

    const { error } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      full_name: fallbackName,
      is_active: true,
      approval_status: approvalStatus,
    });

    if (error) {
      if (error.code === "23503") return { deleted: true as const };
      throw new Error(error.message);
    }

    return { deleted: false as const };
  });
