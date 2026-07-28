-- Allow both call participants to leave a review (client, pal, or admin in either role).

ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS rater_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ratee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.ratings
SET
  rater_id = client_id,
  ratee_id = pal_id
WHERE rater_id IS NULL OR ratee_id IS NULL;

ALTER TABLE public.ratings
  ALTER COLUMN rater_id SET NOT NULL,
  ALTER COLUMN ratee_id SET NOT NULL;

ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_session_id_key;
ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_session_rater_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ratings_session_rater_unique'
  ) THEN
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_session_rater_unique UNIQUE (session_id, rater_id);
  END IF;
END $$;

DROP POLICY IF EXISTS "ratings_client_insert" ON public.ratings;
DROP POLICY IF EXISTS "ratings_participant_insert" ON public.ratings;

CREATE POLICY "ratings_participant_insert" ON public.ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = rater_id
    AND EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = session_id
        AND s.status = 'ended'
        AND (s.client_id = auth.uid() OR s.pal_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.tg_recalculate_pal_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pal_id UUID;
  _avg    NUMERIC(3,2);
  _count  INT;
BEGIN
  _pal_id := COALESCE(NEW.ratee_id, OLD.ratee_id);

  IF NOT EXISTS (SELECT 1 FROM public.pat_pals WHERE user_id = _pal_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    ROUND(AVG(stars)::NUMERIC, 2),
    COUNT(*)
  INTO _avg, _count
  FROM public.ratings
  WHERE ratee_id = _pal_id;

  UPDATE public.pat_pals
  SET
    rating_avg   = COALESCE(_avg, 5.00),
    rating_count = COALESCE(_count, 0),
    updated_at   = now()
  WHERE user_id = _pal_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
