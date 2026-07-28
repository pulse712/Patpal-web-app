-- When a trial code is revoked, remove its redemption rows from wallet history.

CREATE OR REPLACE FUNCTION public.revoke_trial_code_benefits(p_trial_code_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        TEXT;
  v_note_prefix TEXT;
  r             RECORD;
BEGIN
  SELECT code INTO v_code
  FROM public.trial_codes
  WHERE id = p_trial_code_id;

  IF v_code IS NULL THEN
    RETURN;
  END IF;

  v_note_prefix := 'Trial code ' || v_code || ':%';

  FOR r IN
    SELECT user_id, seconds_delta
    FROM public.credit_transactions
    WHERE kind = 'trial'
      AND seconds_delta > 0
      AND (trial_code_id = p_trial_code_id OR note LIKE v_note_prefix)
  LOOP
    UPDATE public.wallets
    SET balance_seconds = GREATEST(0, COALESCE(balance_seconds, 0) - r.seconds_delta),
        updated_at      = now()
    WHERE user_id = r.user_id;
  END LOOP;

  UPDATE public.wallets
  SET unlimited_until = NULL,
      trial_code_id   = NULL,
      updated_at      = now()
  WHERE trial_code_id = p_trial_code_id;

  FOR r IN
    SELECT ct.user_id
    FROM public.credit_transactions ct
    WHERE ct.kind = 'trial'
      AND ct.seconds_delta = 0
      AND (ct.trial_code_id = p_trial_code_id OR ct.note LIKE v_note_prefix)
  LOOP
    UPDATE public.wallets
    SET unlimited_until = NULL,
        trial_code_id   = NULL,
        updated_at      = now()
    WHERE user_id = r.user_id;
  END LOOP;

  DELETE FROM public.credit_transactions
  WHERE kind = 'trial'
    AND (trial_code_id = p_trial_code_id OR note LIKE v_note_prefix);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_trial_code_benefits(UUID) TO service_role;
