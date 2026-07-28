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

export function parseTrialCodeFromNote(note: string | null | undefined): string | null {
  if (!note?.startsWith("Trial code ")) return null;
  const rest = note.slice("Trial code ".length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  return rest.slice(0, colon).trim();
}

async function unlimitedGrantedByActiveCode(
  userId: string,
  wallet: WalletAccessRow,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (wallet.trial_code_id) {
    const { data: code } = await supabaseAdmin
      .from("trial_codes")
      .select("is_active")
      .eq("id", wallet.trial_code_id)
      .maybeSingle();
    return !!code?.is_active;
  }

  const { data: txs } = await supabaseAdmin
    .from("credit_transactions")
    .select("note, trial_code_id")
    .eq("user_id", userId)
    .eq("kind", "trial")
    .eq("seconds_delta", 0);

  for (const tx of txs ?? []) {
    if (tx.trial_code_id) {
      const { data: code } = await supabaseAdmin
        .from("trial_codes")
        .select("is_active")
        .eq("id", tx.trial_code_id)
        .maybeSingle();
      if (code?.is_active) return true;
      continue;
    }

    const codeName = parseTrialCodeFromNote(tx.note);
    if (!codeName) continue;

    const { data: code } = await supabaseAdmin
      .from("trial_codes")
      .select("is_active")
      .eq("code", codeName)
      .maybeSingle();
    if (code?.is_active) return true;
  }

  return false;
}

async function clearRevokedTrialUnlimited(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("wallets")
    .update({
      unlimited_until: null,
      trial_code_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/** Resolve whether a client can call, honoring revoked trial codes. */
export async function resolveWalletAccess(
  userId: string,
  wallet: WalletAccessRow | null,
): Promise<{
  balanceSeconds: number;
  displayBalanceSeconds: number;
  isUnlimited: boolean;
  canStartCall: boolean;
  unlimitedUntil: string | null;
}> {
  const isPlatformStaff = await hasPlatformStaffRole(userId);
  const displayBalance = wallet?.balance_seconds ?? 0;

  if (isPlatformStaff) {
    return {
      balanceSeconds: 999999,
      displayBalanceSeconds: displayBalance,
      isUnlimited: true,
      canStartCall: true,
      unlimitedUntil: null,
    };
  }

  let isUnlimited = false;
  let unlimitedUntil: string | null = null;

  if (wallet?.unlimited_until && new Date(wallet.unlimited_until) > new Date()) {
    isUnlimited = await unlimitedGrantedByActiveCode(userId, wallet);
    if (isUnlimited) {
      unlimitedUntil = wallet.unlimited_until;
    } else {
      await clearRevokedTrialUnlimited(userId);
    }
  }

  const balanceSeconds = isUnlimited ? 999999 : displayBalance;
  return {
    balanceSeconds,
    displayBalanceSeconds: displayBalance,
    isUnlimited,
    canStartCall: isUnlimited || displayBalance >= 60,
    unlimitedUntil,
  };
}
