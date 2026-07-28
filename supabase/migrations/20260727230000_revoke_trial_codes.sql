-- Link trial redemptions to codes so revoking a code removes granted access.

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS trial_code_id UUID REFERENCES public.trial_codes(id) ON DELETE SET NULL;

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS trial_code_id UUID REFERENCES public.trial_codes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS credit_transactions_trial_code_id_idx
  ON public.credit_transactions (trial_code_id)
  WHERE trial_code_id IS NOT NULL;

-- Replace the 4-arg version with a 5-arg version (adding trial_code_id).
DROP FUNCTION IF EXISTS public.apply_trial_code(UUID, INT, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.apply_trial_code(UUID, INT, TIMESTAMPTZ, TEXT, UUID);

CREATE FUNCTION public.apply_trial_code(
  p_user_id         UUID,
  p_seconds         INT,
  p_unlimited_until TIMESTAMPTZ,
  p_note            TEXT,
  p_trial_code_id   UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE user_id = p_user_id AND kind = 'trial' AND note = p_note
  ) THEN
    RAISE EXCEPTION 'Trial code already redeemed';
  END IF;

  IF p_unlimited_until IS NOT NULL THEN
    INSERT INTO public.wallets (user_id, unlimited_until, trial_code_id, updated_at)
    VALUES (p_user_id, p_unlimited_until, p_trial_code_id, now())
    ON CONFLICT (user_id) DO UPDATE
      SET unlimited_until = p_unlimited_until,
          trial_code_id   = p_trial_code_id,
          updated_at      = now();
  ELSE
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (p_user_id, p_seconds, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance_seconds = public.wallets.balance_seconds + p_seconds,
          updated_at      = now();
  END IF;

  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, note, trial_code_id)
  VALUES
    (p_user_id, 'trial', p_seconds, p_note, p_trial_code_id);
END;
$$;

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

GRANT EXECUTE ON FUNCTION public.apply_trial_code(UUID, INT, TIMESTAMPTZ, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_trial_code_benefits(UUID) TO service_role;
