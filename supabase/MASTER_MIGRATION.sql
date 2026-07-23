-- ================================================================
-- Pat My Back — Master Database Setup
-- Run this entire file in Supabase SQL Editor ONE TIME
-- on a fresh project (xhgybcyvpasmtlpscdly)
--
-- Then run POST_MASTER_MIGRATION.sql (RPCs + security hardening).
-- Do NOT run migrations/20260715065810_* — it duplicates this file.
-- ================================================================

-- ── Enums ────────────────────────────────────────────────────────
CREATE TYPE public.app_role AS ENUM ('client', 'pat_pal', 'admin', 'super_admin');
CREATE TYPE public.pal_tier AS ENUM ('trusted', 'expert', 'premium');
CREATE TYPE public.availability_status AS ENUM ('available', 'busy', 'offline');
CREATE TYPE public.session_kind AS ENUM ('chat', 'audio', 'video');
CREATE TYPE public.session_status AS ENUM ('active', 'ended', 'cancelled');
CREATE TYPE public.tx_kind AS ENUM ('purchase', 'debit', 'refund', 'trial');

-- ── user_roles (must exist before has_role()) ─────────────────────
CREATE TABLE public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ── has_role helper (must exist before policies that call it) ─────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
     )
  THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
END;
$$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- ── profiles ─────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  bio        TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update own"         ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles insert own"         ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ── profile_contacts (sensitive — phone) ─────────────────────────
CREATE TABLE public.profile_contacts (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_contacts TO authenticated;
GRANT ALL ON public.profile_contacts TO service_role;
ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts owner read"   ON public.profile_contacts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
CREATE POLICY "contacts owner insert" ON public.profile_contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contacts owner update" ON public.profile_contacts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_roles read own"    ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_roles admin write" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ── categories ───────────────────────────────────────────────────
CREATE TABLE public.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read"  ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories admin write"  ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

INSERT INTO public.categories (slug, name, emoji, sort_order) VALUES
  ('mentorship',            'Mentorship',            '🤝', 1),
  ('training',              'Training',              '🏋️', 2),
  ('motivation',            'Motivation',            '🔥', 3),
  ('accountability',        'Accountability',        '✅', 4),
  ('business-coaching',     'Business Coaching',     '📈', 5),
  ('friendly-chat',         'Friendly Chat',         '💬', 6),
  ('emotional-support',     'Emotional Support',     '💗', 7),
  ('consulting',            'Consulting',            '💡', 8),
  ('career-advice',         'Career Advice',         '💼', 9),
  ('encouragement',         'Encouragement',         '🌟', 10),
  ('spiritual-encouragement','Spiritual Encouragement','✝️', 11),
  ('music-lessons',         'Music Lessons',         '🎵', 12);

-- ── pat_pals ─────────────────────────────────────────────────────
CREATE TABLE public.pat_pals (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                   public.pal_tier NOT NULL DEFAULT 'trusted',
  price_cents_per_minute INT NOT NULL DEFAULT 100,
  availability           public.availability_status NOT NULL DEFAULT 'offline',
  category_slugs         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_team                BOOLEAN NOT NULL DEFAULT false,
  rating_avg             NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  rating_count           INT NOT NULL DEFAULT 0,
  headline               TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pat_pals TO anon, authenticated;
GRANT INSERT, UPDATE ON public.pat_pals TO authenticated;
GRANT ALL ON public.pat_pals TO service_role;
ALTER TABLE public.pat_pals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pat_pals public read"   ON public.pat_pals FOR SELECT USING (true);
CREATE POLICY "pat_pals update own"    ON public.pat_pals FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- pat_pals INSERT is admin/service-role only (see admin.functions setUserRole)
CREATE POLICY "pat_pals admin manage"  ON public.pat_pals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ── wallets ──────────────────────────────────────────────────────
CREATE TABLE public.wallets (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_seconds INT NOT NULL DEFAULT 0,
  unlimited_until TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets read own" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ── conversations + messages ──────────────────────────────────────
CREATE TABLE public.conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, pal_id)
);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations read"   ON public.conversations FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = pal_id);
CREATE POLICY "conversations insert" ON public.conversations FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = client_id
  AND client_id <> pal_id
  AND EXISTS (SELECT 1 FROM public.pat_pals WHERE user_id = pal_id)
);

CREATE TABLE public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages read" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (c.client_id = auth.uid() OR c.pal_id = auth.uid())));
CREATE POLICY "messages insert" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND (c.client_id = auth.uid() OR c.pal_id = auth.uid())));

ALTER TABLE public.messages       REPLICA IDENTITY FULL;
ALTER TABLE public.conversations  REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pat_pals;

-- ── sessions ─────────────────────────────────────────────────────
CREATE TABLE public.sessions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  client_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id                      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                        public.session_kind NOT NULL,
  status                      public.session_status NOT NULL DEFAULT 'active',
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                    TIMESTAMPTZ,
  seconds_used                INT NOT NULL DEFAULT 0,
  cost_cents                  INT NOT NULL DEFAULT 0,
  price_cents_per_minute      INT NOT NULL,
  remaining_seconds_at_start  INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions read"   ON public.sessions FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = pal_id);
-- Session creation is server-only (service role via startSession server function)
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;

-- ── credit_transactions ───────────────────────────────────────────
CREATE TABLE public.credit_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind             public.tx_kind NOT NULL,
  seconds_delta    INT NOT NULL,
  cents_amount     INT NOT NULL DEFAULT 0,
  session_id       UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  stripe_reference TEXT,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_tx read own" ON public.credit_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ── trial_codes ───────────────────────────────────────────────────
CREATE TABLE public.trial_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  label      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  unlimited  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trial_codes TO authenticated;
GRANT ALL ON public.trial_codes TO service_role;
ALTER TABLE public.trial_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trial_codes read active" ON public.trial_codes FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "trial_codes admin write" ON public.trial_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ── promo_banners ─────────────────────────────────────────────────
CREATE TABLE public.promo_banners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  body       TEXT,
  cta_label  TEXT,
  cta_href   TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promo_banners TO anon, authenticated;
GRANT ALL ON public.promo_banners TO service_role;
ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo public read"  ON public.promo_banners FOR SELECT USING (is_visible = true);
CREATE POLICY "promo admin write"  ON public.promo_banners FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ── push_subscriptions ────────────────────────────────────────────
CREATE TABLE public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_own" ON public.push_subscriptions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── ratings ───────────────────────────────────────────────────────
CREATE TABLE public.ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars      SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);
GRANT SELECT, INSERT ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings read"   ON public.ratings FOR SELECT TO authenticated USING (true);
-- ratings INSERT is service-role only (via submitRating server function)

-- ── updated_at trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER profiles_touch       BEFORE UPDATE ON public.profiles       FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER pat_pals_touch       BEFORE UPDATE ON public.pat_pals       FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER wallets_touch        BEFORE UPDATE ON public.wallets        FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER promo_banners_touch  BEFORE UPDATE ON public.promo_banners  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── rating recalculate trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_recalculate_pal_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pal_id UUID; _avg NUMERIC(3,2); _count INT;
BEGIN
  _pal_id := COALESCE(NEW.pal_id, OLD.pal_id);
  SELECT ROUND(AVG(stars)::NUMERIC, 2), COUNT(*) INTO _avg, _count FROM public.ratings WHERE pal_id = _pal_id;
  UPDATE public.pat_pals SET rating_avg = COALESCE(_avg, 5.00), rating_count = COALESCE(_count, 0), updated_at = now() WHERE user_id = _pal_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ratings_recalculate AFTER INSERT OR UPDATE OR DELETE ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.tg_recalculate_pal_rating();

-- ── handle_new_user: auto-setup on signup (always client role) ───
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profile_contacts (user_id, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_seconds) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- Security hardening (2026-07-23) — also in migrations 202607231*
-- ================================================================

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_client
  ON public.sessions (client_id) WHERE status = 'active';

REVOKE UPDATE ON public.sessions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;

DROP POLICY IF EXISTS "user_roles admin write" ON public.user_roles;
DROP POLICY IF EXISTS "trial_codes read active" ON public.trial_codes;
CREATE POLICY "trial_codes admin read" ON public.trial_codes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP POLICY IF EXISTS "profiles read authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio FROM public.profiles;
GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- See migration files for full RPC definitions:
-- mark_session_connected, cancel_session_before_connect, end_session_billing (v2),
-- guard_profiles_update, guard_pat_pals_update triggers
