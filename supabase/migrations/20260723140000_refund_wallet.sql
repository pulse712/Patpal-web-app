-- Refund wallet credits when Stripe payment is refunded (idempotent via stripe_reference).

CREATE OR REPLACE FUNCTION public.refund_wallet(
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
DECLARE
  v_inserted UUID;
  v_refund_seconds INT := ABS(p_seconds);
BEGIN
  IF p_stripe_ref IS NULL OR v_refund_seconds <= 0 THEN
    RAISE EXCEPTION 'Invalid refund parameters';
  END IF;

  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'refund', -v_refund_seconds, -ABS(p_cents_amount), p_stripe_ref, p_note)
  ON CONFLICT (stripe_reference) WHERE stripe_reference IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.wallets
  SET balance_seconds = GREATEST(0, balance_seconds - v_refund_seconds),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_wallet TO service_role;
