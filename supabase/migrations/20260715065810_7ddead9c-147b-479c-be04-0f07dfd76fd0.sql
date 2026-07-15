
-- Enums
CREATE TYPE public.app_role AS ENUM ('client', 'pat_pal', 'admin', 'super_admin');
CREATE TYPE public.pal_tier AS ENUM ('trusted', 'expert', 'premium');
CREATE TYPE public.availability_status AS ENUM ('available', 'busy', 'offline');
CREATE TYPE public.session_kind AS ENUM ('chat', 'audio', 'video');
CREATE TYPE public.session_status AS ENUM ('active', 'ended', 'cancelled');
CREATE TYPE public.tx_kind AS ENUM ('purchase', 'debit', 'refund', 'trial');

-- =========================================================
-- profiles
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles update own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles insert own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- =========================================================
-- user_roles + has_role
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles read own" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "user_roles admin manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- =========================================================
-- categories
-- =========================================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories admin write" ON public.categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

INSERT INTO public.categories (slug, name, emoji, sort_order) VALUES
  ('mentorship', 'Mentorship', '🎓', 10),
  ('tutoring', 'Tutoring', '📚', 20),
  ('motivation', 'Motivation', '🔥', 30),
  ('accountability', 'Accountability', '🎯', 40),
  ('business-coaching', 'Business Coaching', '📈', 50),
  ('friendly-chat', 'Friendly Chat', '☕', 60),
  ('emotional-support', 'Emotional Support', '💙', 70),
  ('consulting', 'Consulting', '💡', 80),
  ('career-advice', 'Career Advice', '💼', 90),
  ('encouragement', 'Encouragement', '🌟', 100),
  ('spiritual', 'Spiritual', '✝️', 110),
  ('music-lessons', 'Music Lessons', '🎵', 120);

-- =========================================================
-- pat_pals
-- =========================================================
CREATE TABLE public.pat_pals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.pal_tier NOT NULL DEFAULT 'trusted',
  price_cents_per_minute INT NOT NULL DEFAULT 100,
  availability public.availability_status NOT NULL DEFAULT 'offline',
  category_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_team BOOLEAN NOT NULL DEFAULT false,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  rating_count INT NOT NULL DEFAULT 0,
  headline TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pat_pals TO authenticated;
GRANT INSERT, UPDATE ON public.pat_pals TO authenticated;
GRANT ALL ON public.pat_pals TO service_role;
ALTER TABLE public.pat_pals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pat_pals read auth" ON public.pat_pals FOR SELECT TO authenticated USING (true);
CREATE POLICY "pat_pals update own" ON public.pat_pals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pat_pals insert own" ON public.pat_pals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pat_pals admin manage" ON public.pat_pals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- =========================================================
-- wallets
-- =========================================================
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_seconds INT NOT NULL DEFAULT 0,
  unlimited_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets read own" ON public.wallets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- conversations + messages
-- =========================================================
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, pal_id)
);
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations read participants" ON public.conversations
  FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = pal_id);
-- only client can create the conversation
CREATE POLICY "conversations client insert" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages read participants" ON public.messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND (c.client_id = auth.uid() OR c.pal_id = auth.uid()))
  );
CREATE POLICY "messages insert participants" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_id
                  AND (c.client_id = auth.uid() OR c.pal_id = auth.uid()))
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pat_pals;

-- =========================================================
-- sessions (call records)
-- =========================================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.session_kind NOT NULL,
  status public.session_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  seconds_used INT NOT NULL DEFAULT 0,
  cost_cents INT NOT NULL DEFAULT 0,
  price_cents_per_minute INT NOT NULL,
  remaining_seconds_at_start INT NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions read participants" ON public.sessions
  FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = pal_id);
-- only client initiates
CREATE POLICY "sessions client insert" ON public.sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);

-- =========================================================
-- credit_transactions
-- =========================================================
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.tx_kind NOT NULL,
  seconds_delta INT NOT NULL,
  cents_amount INT NOT NULL DEFAULT 0,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  stripe_reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_tx read own" ON public.credit_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- trial_codes
-- =========================================================
CREATE TABLE public.trial_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  unlimited BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trial_codes TO authenticated;
GRANT ALL ON public.trial_codes TO service_role;
ALTER TABLE public.trial_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trial_codes admin manage" ON public.trial_codes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
-- allow reading by code for redemption (server-side); simple auth read of active codes only
CREATE POLICY "trial_codes read active" ON public.trial_codes
  FOR SELECT TO authenticated USING (is_active = true);

-- =========================================================
-- promo_banners
-- =========================================================
CREATE TABLE public.promo_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT,
  cta_label TEXT,
  cta_href TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promo_banners TO anon, authenticated;
GRANT ALL ON public.promo_banners TO service_role;
ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo public read visible" ON public.promo_banners
  FOR SELECT USING (is_visible = true);
CREATE POLICY "promo admin manage" ON public.promo_banners
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- =========================================================
-- updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER pat_pals_touch BEFORE UPDATE ON public.pat_pals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER wallets_touch BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER promo_banners_touch BEFORE UPDATE ON public.promo_banners
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- handle_new_user: create profile + wallet + client role by default
-- Role and bio can be upgraded to pat_pal from the app later.
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_seconds) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'client'))
  ON CONFLICT (user_id, role) DO NOTHING;

  -- if signing up as pat_pal, create the pat_pals record too
  IF COALESCE(NEW.raw_user_meta_data->>'role', 'client') = 'pat_pal' THEN
    INSERT INTO public.pat_pals (user_id, headline)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'bio')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
