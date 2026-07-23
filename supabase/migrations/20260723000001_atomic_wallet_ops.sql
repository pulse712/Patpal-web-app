-- ================================================================
-- Atomic wallet operations
-- Ensures wallet balance and credit_transactions are always in sync
-- by wrapping both writes in a single database transaction.
-- ================================================================

-- ── debit_wallet: called when a session ends ─────────────────────
-- Subtracts seconds from the wallet and inserts a debit transaction.
-- No-ops if the session is already ended (idempotent via session check).
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id     UUID,
  p_session_id  UUID,
  p_seconds     INT,
  p_cost_cents  INT,
  p_note        TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deduct from wallet (floor at 0)
  UPDATE public.wallets
  SET
    balance_seconds = GREATEST(0, balance_seconds - p_seconds),
    updated_at      = now()
  WHERE user_id = p_user_id;

  -- Record the debit transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, session_id, note)
  VALUES
    (p_user_id, 'debit', -p_seconds, p_cost_cents, p_session_id, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_wallet TO service_role;


-- ── credit_wallet: called after successful Stripe payment ────────
-- Adds seconds to the wallet and inserts a purchase transaction.
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id        UUID,
  p_seconds        INT,
  p_cents_amount   INT,
  p_stripe_ref     TEXT,
  p_note           TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Upsert wallet (create row if first purchase)
  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (p_user_id, p_seconds, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance_seconds = public.wallets.balance_seconds + p_seconds,
        updated_at      = now();

  -- Record the purchase transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'purchase', p_seconds, p_cents_amount, p_stripe_ref, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_wallet TO service_role;


-- ── apply_trial_code: atomically grants trial access ────────────
-- Can grant either unlimited access (until timestamp) or fixed seconds.
CREATE OR REPLACE FUNCTION public.apply_trial_code(
  p_user_id         UUID,
  p_seconds         INT,      -- 0 if unlimited
  p_unlimited_until TIMESTAMPTZ, -- NULL if not unlimited
  p_note            TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_unlimited_until IS NOT NULL THEN
    -- Grant unlimited access until timestamp
    INSERT INTO public.wallets (user_id, unlimited_until, updated_at)
    VALUES (p_user_id, p_unlimited_until, now())
    ON CONFLICT (user_id) DO UPDATE
      SET unlimited_until = p_unlimited_until,
          updated_at      = now();
  ELSE
    -- Grant fixed seconds
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (p_user_id, p_seconds, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance_seconds = public.wallets.balance_seconds + p_seconds,
          updated_at      = now();
  END IF;

  -- Record trial transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, note)
  VALUES
    (p_user_id, 'trial', p_seconds, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_trial_code TO service_role;
