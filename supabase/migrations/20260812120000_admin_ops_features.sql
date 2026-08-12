-- Admin ops features: PatPal approval, trial code options, banner schedule, app settings

-- ── Pat Pals: approval gate ───────────────────────────────────────────────────
ALTER TABLE public.pat_pals
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- Existing pals stay listed; only new signups start pending
UPDATE public.pat_pals SET is_approved = true WHERE is_approved = false;

-- The existing "pat_pals public listing read" policy is USING (true) — it
-- predates is_approved and was a deliberate choice back when every row WAS
-- meant to be public. Now that pending pals exist, that policy would let
-- anyone query pending/unapproved pals directly via the anon key (which is
-- public in the client bundle), bypassing the approval gate entirely —
-- app-side .eq("is_approved", true) filtering only hides them from this
-- app's own UI, not from direct API access. Re-scope it: approved pals stay
-- public, a pal can still see their own (pending) row, and admins/super
-- admins can see everything (needed for admin.tsx's own pending-pal list,
-- which queries via the RLS-bound client, not a service-role function).
DROP POLICY IF EXISTS "pat_pals public listing read" ON public.pat_pals;
DROP POLICY IF EXISTS "pat_pals read auth" ON public.pat_pals;
DROP POLICY IF EXISTS "pat_pals public read" ON public.pat_pals;
CREATE POLICY "pat_pals public listing read"
  ON public.pat_pals FOR SELECT
  TO authenticated, anon
  USING (
    is_approved = true
    OR user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- ── PatPal display-name uniqueness ────────────────────────────────────────────
-- Deliberately NOT a global unique index on profiles.full_name — that would
-- apply to every client too, and handle_new_user()'s profile insert swallows
-- its own errors (EXCEPTION WHEN OTHERS THEN NULL), so a name collision on
-- an ordinary client signup would silently fail to create their profile row
-- with zero indication anything went wrong, rather than a clean error.
-- The client's actual ask was Pat Pal duplicate names specifically, which is
-- already enforced app-side (checkDisplayNameAvailable pre-check +
-- applySignupRole's scoped check) in src/lib/signup.functions.ts.

-- ── Trial codes: schedule + minute grants ────────────────────────────────────
ALTER TABLE public.trial_codes
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS grant_seconds integer;

COMMENT ON COLUMN public.trial_codes.grant_seconds IS
  'Seconds granted on redeem when unlimited=false. Null falls back to 3600.';

-- ── Promo banners: schedule window ───────────────────────────────────────────
ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;

-- ── App settings (general pricing / credit packs) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app_settings" ON public.app_settings;
CREATE POLICY "Anyone can read app_settings"
  ON public.app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage app_settings" ON public.app_settings;
CREATE POLICY "Admins can manage app_settings"
  ON public.app_settings FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );

INSERT INTO public.app_settings (key, value) VALUES
  (
    'credit_packages',
    '[
      {"id":"pack_15min","label":"15 minutes","seconds":900,"amount":1000},
      {"id":"pack_30min","label":"30 minutes","seconds":1800,"amount":1800},
      {"id":"pack_60min","label":"60 minutes","seconds":3600,"amount":3000}
    ]'::jsonb
  ),
  ('default_price_cents_per_minute', '100'::jsonb)
ON CONFLICT (key) DO NOTHING;
