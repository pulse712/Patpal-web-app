import { supabase } from "@/integrations/supabase/client";
import { isMissingColumnError } from "@/lib/postgrest-utils";

export type AccountGateResult =
  | { allowed: true }
  | { allowed: false; reason: "pending" | "rejected" | "banned" | "missing" | "unknown" };

export function accountStatusFromGate(
  reason: "pending" | "rejected" | "banned" | "missing" | "unknown",
): "pending" | "banned" | "deleted" {
  if (reason === "banned") return "banned";
  if (reason === "rejected" || reason === "missing") return "deleted";
  return "pending";
}

/**
 * After password/session auth succeeds, confirm the profile is approved and
 * active before sending the user into the app.
 *
 * Prefers the server-side admin check (bypasses RLS / flaky client reads).
 * Falls back to a direct profiles select if the server fn chunk fails to load.
 */
export async function resolveAccountGate(userId: string): Promise<AccountGateResult> {
  try {
    const { checkMyAccountAccess } = await import("@/lib/account.functions");
    return await checkMyAccountAccess();
  } catch (err) {
    console.warn("[account-access] server check failed, falling back to client:", err);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("is_active, approval_status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Migration not applied yet — do not block every login on older DBs.
    if (isMissingColumnError(error)) return { allowed: true };
    return { allowed: false, reason: "unknown" };
  }

  if (!data) return { allowed: false, reason: "missing" };
  if (data.is_active === false) return { allowed: false, reason: "banned" };
  if (data.approval_status === "rejected") return { allowed: false, reason: "rejected" };
  if (data.approval_status === "pending") return { allowed: false, reason: "pending" };
  if (data.approval_status !== "approved") return { allowed: false, reason: "pending" };

  return { allowed: true };
}
