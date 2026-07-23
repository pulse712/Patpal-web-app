export const TRIAL_GRANT_SECONDS = 60 * 60;

export type TrialCodeRow = {
  code: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  unlimited: boolean;
};

export function normalizeTrialCode(code: string): string {
  return code.trim().toUpperCase();
}

export function assertTrialCodeRedeemable(
  tc: TrialCodeRow | null,
  hasPriorRedemption: boolean,
  now: Date = new Date(),
): asserts tc is TrialCodeRow {
  if (!tc || !tc.is_active) {
    throw new Error("Invalid or inactive code");
  }
  if (tc.expires_at && new Date(tc.expires_at) < now) {
    throw new Error("This code has expired");
  }
  if (hasPriorRedemption) {
    throw new Error("You have already redeemed this code");
  }
}

export function buildTrialNote(code: string, label: string | null, unlimited: boolean): string {
  return `Trial code ${code}: ${label ?? (unlimited ? "unlimited" : "60 minutes")}`;
}

export function computeTrialBalance(currentBalance: number): number {
  return currentBalance + TRIAL_GRANT_SECONDS;
}
