import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";

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
 * Called when the client finds no `profiles` row for the current session.
 * That's ambiguous on its own — it can mean the account was deleted, or
 * (a real, pre-existing gap) that `handle_new_user()`'s trigger silently
 * failed to create one at signup. Attempting the insert and checking *why*
 * it failed disambiguates authoritatively: a foreign-key violation means
 * auth.users itself has no row with this id (genuinely deleted); any other
 * outcome means the row now exists (already did, or just self-healed).
 */
export const ensureMyProfile = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
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

    // Only staff are auto-approved on self-heal. Everyone else stays pending
    // so a missing profile row cannot bypass the signup approval gate.
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    const isStaff = !!(isAdmin || isSuperAdmin);

    const { error } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      full_name: fallbackName,
      is_active: true,
      approval_status: isStaff ? "approved" : "pending",
    });

    if (error) {
      if (error.code === "23503") return { deleted: true as const };
      throw new Error(error.message);
    }

    return { deleted: false as const };
  });
