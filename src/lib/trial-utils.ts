export const TRIAL_GRANT_SECONDS = 60 * 60;

export type TrialCodeRow = {
  code: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  starts_at?: string | null;
  grant_seconds?: number | null;
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
  if (tc.starts_at && new Date(tc.starts_at) > now) {
    throw new Error("This code is not active yet");
  }
  if (tc.expires_at && new Date(tc.expires_at) < now) {
    throw new Error("This code has expired");
  }
  if (hasPriorRedemption) {
    throw new Error("You have already redeemed this code");
  }
}

export function resolveTrialGrantSeconds(tc: TrialCodeRow): number {
  if (tc.unlimited) return 0;
  if (typeof tc.grant_seconds === "number" && tc.grant_seconds > 0) {
    return tc.grant_seconds;
  }
  return TRIAL_GRANT_SECONDS;
}

export function buildTrialNote(
  code: string,
  label: string | null,
  unlimited: boolean,
  grantSeconds?: number | null,
): string {
  if (label) return `Trial code ${code}: ${label}`;
  if (unlimited) return `Trial code ${code}: unlimited`;
  const minutes = Math.round((grantSeconds ?? TRIAL_GRANT_SECONDS) / 60);
  return `Trial code ${code}: ${minutes} minutes`;
}

export function computeTrialBalance(
  currentBalance: number,
  grantSeconds = TRIAL_GRANT_SECONDS,
): number {
  return currentBalance + grantSeconds;
}
