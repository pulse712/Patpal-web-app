// Server functions for wallet operations.
// Wallet mutations use the service role to bypass RLS.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import {
  assertTrialCodeRedeemable,
  buildTrialNote,
  computeTrialBalance,
  normalizeTrialCode,
  TRIAL_GRANT_SECONDS,
} from "@/lib/trial-utils";

export const redeemTrialCode = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ code: z.string().min(1).max(64) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;
    const trimmed = normalizeTrialCode(data.code);

    const { data: tc, error: codeError } = await supabaseAdmin
      .from("trial_codes")
      .select("id, code, label, is_active, expires_at, unlimited")
      .eq("code", trimmed)
      .eq("is_active", true)
      .maybeSingle();

    if (codeError) throw new Error("Invalid or inactive code");

    const { data: prior } = await supabaseAdmin
      .from("credit_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "trial")
      .like("note", `Trial code ${trimmed}:%`)
      .maybeSingle();

    assertTrialCodeRedeemable(tc, !!prior);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance_seconds, unlimited_until")
      .eq("user_id", userId)
      .single();

    const note = buildTrialNote(tc.code, tc.label, tc.unlimited);

    if (tc.unlimited) {
      const until = tc.expires_at ?? new Date(Date.now() + 7 * 864e5).toISOString();

      const { error } = await supabaseAdmin.rpc("apply_trial_code", {
        p_user_id: userId,
        p_seconds: 0,
        p_unlimited_until: until,
        p_note: note,
      });

      if (error) throw new Error("Could not apply trial code");

      return { ok: true, unlimitedUntil: until };
    }

    const { error } = await supabaseAdmin.rpc("apply_trial_code", {
      p_user_id: userId,
      p_seconds: TRIAL_GRANT_SECONDS,
      p_unlimited_until: null,
      p_note: note,
    });

    if (error) throw new Error("Could not apply trial code");

    const currentBalance = wallet?.balance_seconds ?? 0;
    const newBalance = computeTrialBalance(currentBalance);

    return { ok: true, balanceSeconds: newBalance, secondsGranted: TRIAL_GRANT_SECONDS };
  });
