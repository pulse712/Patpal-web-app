/** Session cost from elapsed seconds and per-minute rate (cents). */
export function computeSessionCostCents(
  secondsUsed: number,
  priceCentsPerMinute: number,
): number {
  return Math.round((secondsUsed / 60) * priceCentsPerMinute);
}

/** Wallet balance after a timed session (unlimited wallets are unchanged). */
export function computeDebitedBalance(
  currentBalance: number,
  secondsUsed: number,
  isUnlimited: boolean,
): number {
  if (isUnlimited) return currentBalance;
  return Math.max(0, currentBalance - secondsUsed);
}

/** Wallet balance after purchasing credits. */
export function computeCreditedBalance(
  currentSeconds: number,
  secondsToAdd: number,
): number {
  return currentSeconds + secondsToAdd;
}

/** Seconds granted for a mid-call top-up ($10 / 15 min default rate). */
export function computeTopUpSeconds(
  cents: number,
  ratePerMinCents = 1000 / 15,
): number {
  return Math.round((cents / ratePerMinCents) * 60);
}
