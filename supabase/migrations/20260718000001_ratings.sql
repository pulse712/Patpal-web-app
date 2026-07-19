-- =========================================================
-- ratings
-- =========================================================
-- One rating per client per session. Clients rate Pat Pals after a call.
CREATE TABLE public.ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id) -- one rating per session
);

GRANT SELECT, INSERT ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Clients can insert their own ratings
CREATE POLICY "ratings_client_insert" ON public.ratings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id);

-- All authenticated users can read ratings (for display on pal profiles)
CREATE POLICY "ratings_read" ON public.ratings
  FOR SELECT TO authenticated USING (true);

-- =========================================================
-- Trigger: recalculate rating_avg + rating_count on pat_pals
-- after each insert/update/delete on ratings
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_recalculate_pal_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pal_id UUID;
  _avg    NUMERIC(3,2);
  _count  INT;
BEGIN
  -- Which pal was affected?
  _pal_id := COALESCE(NEW.pal_id, OLD.pal_id);

  SELECT
    ROUND(AVG(stars)::NUMERIC, 2),
    COUNT(*)
  INTO _avg, _count
  FROM public.ratings
  WHERE pal_id = _pal_id;

  UPDATE public.pat_pals
  SET
    rating_avg   = COALESCE(_avg, 5.00),
    rating_count = COALESCE(_count, 0),
    updated_at   = now()
  WHERE user_id = _pal_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ratings_recalculate
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.tg_recalculate_pal_rating();
