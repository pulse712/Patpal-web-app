-- ── refund_wallet: atomically deduct seconds and log a refund transaction ──
-- Called when Stripe fires charge.refunded for a previous purchase.
CREATE OR REPLACE FUNCTION public.refund_wallet(
  p_user_id      UUID,
  p_seconds      INT,
  p_cents_amount INT,
  p_stripe_ref   TEXT,
  p_note         TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotency: skip if already refunded for this stripe ref
  IF p_stripe_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE stripe_reference = p_stripe_ref AND kind = 'refund'
  ) THEN
    RETURN;
  END IF;

  -- Deduct seconds from wallet (floor at 0)
  UPDATE public.wallets
  SET
    balance_seconds = GREATEST(0, balance_seconds - p_seconds),
    updated_at      = now()
  WHERE user_id = p_user_id;

  -- Record the refund transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'refund', -p_seconds, p_cents_amount, p_stripe_ref, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_wallet TO service_role;
