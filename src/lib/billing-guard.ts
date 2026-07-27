/** Platform staff (admin / super_admin) call for free — no wallet balance required. */
export async function hasPlatformStaffRole(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  return !!(isAdmin || isSuperAdmin);
}

export function walletHasUnlimitedAccess(
  unlimitedUntil: string | null | undefined,
  isPlatformStaff: boolean,
): boolean {
  if (isPlatformStaff) return true;
  return unlimitedUntil ? new Date(unlimitedUntil) > new Date() : false;
}
