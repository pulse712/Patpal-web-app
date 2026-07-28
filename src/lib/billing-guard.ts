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

export type WalletAccessRow = {
  balance_seconds?: number | null;
  unlimited_until?: string | null;
  trial_code_id?: string | null;
};

/** Resolve whether a client can call, honoring revoked trial codes. */
export async function resolveWalletAccess(
  userId: string,
  wallet: WalletAccessRow | null,
): Promise<{ balanceSeconds: number; isUnlimited: boolean; canStartCall: boolean }> {
  const isPlatformStaff = await hasPlatformStaffRole(userId);
  if (isPlatformStaff) {
    return { balanceSeconds: 999999, isUnlimited: true, canStartCall: true };
  }

  const balance = wallet?.balance_seconds ?? 0;
  let isUnlimited = false;

  if (wallet?.unlimited_until && new Date(wallet.unlimited_until) > new Date()) {
    if (wallet.trial_code_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: code } = await supabaseAdmin
        .from("trial_codes")
        .select("is_active")
        .eq("id", wallet.trial_code_id)
        .maybeSingle();
      isUnlimited = !!code?.is_active;
    } else {
      isUnlimited = true;
    }
  }

  const balanceSeconds = isUnlimited ? 999999 : balance;
  return {
    balanceSeconds,
    isUnlimited,
    canStartCall: isUnlimited || balance >= 60,
  };
}
