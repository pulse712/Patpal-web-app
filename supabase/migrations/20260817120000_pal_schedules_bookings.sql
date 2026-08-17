-- Weekly hours + session bookings for Pat Pals and staff.
-- Pals/staff set repeating hours; clients book 30-minute slots.

CREATE TABLE IF NOT EXISTS public.pal_schedules (
  pal_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  hours      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session_bookings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pal_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'confirmed'
               CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT session_bookings_time_ok CHECK (ends_at > starts_at),
  CONSTRAINT session_bookings_not_self CHECK (pal_id <> client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS session_bookings_pal_starts_idx
  ON public.session_bookings (pal_id, starts_at)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS session_bookings_client_starts_idx
  ON public.session_bookings (client_id, starts_at)
  WHERE status = 'confirmed';

-- Bookings are placed by createBooking() and only ever transition status
-- afterward (see cancelBooking()); nothing legitimate ever rewrites who a
-- booking is for or when it is. Enforce that at the DB layer too, since the
-- public anon key lets any authenticated user call PostgREST directly and
-- RLS alone can't compare old vs. new column values.
CREATE OR REPLACE FUNCTION public.session_bookings_lock_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pal_id <> OLD.pal_id
     OR NEW.client_id <> OLD.client_id
     OR NEW.starts_at <> OLD.starts_at
     OR NEW.ends_at <> OLD.ends_at THEN
    RAISE EXCEPTION 'session_bookings: pal_id, client_id, starts_at, and ends_at cannot be changed after booking';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS session_bookings_lock_identity ON public.session_bookings;
CREATE TRIGGER session_bookings_lock_identity
  BEFORE UPDATE ON public.session_bookings
  FOR EACH ROW EXECUTE FUNCTION public.session_bookings_lock_identity();

GRANT SELECT, INSERT, UPDATE ON public.pal_schedules TO authenticated;
GRANT ALL ON public.pal_schedules TO service_role;
ALTER TABLE public.pal_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pal_schedules read" ON public.pal_schedules;
CREATE POLICY "pal_schedules read"
  ON public.pal_schedules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "pal_schedules upsert own" ON public.pal_schedules;
CREATE POLICY "pal_schedules upsert own"
  ON public.pal_schedules FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = pal_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "pal_schedules update own" ON public.pal_schedules;
CREATE POLICY "pal_schedules update own"
  ON public.pal_schedules FOR UPDATE TO authenticated
  USING (
    auth.uid() = pal_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    auth.uid() = pal_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

GRANT SELECT, INSERT, UPDATE ON public.session_bookings TO authenticated;
GRANT ALL ON public.session_bookings TO service_role;
ALTER TABLE public.session_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_bookings read own" ON public.session_bookings;
CREATE POLICY "session_bookings read own"
  ON public.session_bookings FOR SELECT TO authenticated
  USING (auth.uid() = pal_id OR auth.uid() = client_id);

DROP POLICY IF EXISTS "session_bookings insert client" ON public.session_bookings;
CREATE POLICY "session_bookings insert client"
  ON public.session_bookings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND EXISTS (SELECT 1 FROM public.pat_pals p WHERE p.user_id = pal_id AND p.is_approved = true)
  );

DROP POLICY IF EXISTS "session_bookings update participants" ON public.session_bookings;
CREATE POLICY "session_bookings update participants"
  ON public.session_bookings FOR UPDATE TO authenticated
  USING (auth.uid() = pal_id OR auth.uid() = client_id)
  WITH CHECK (auth.uid() = pal_id OR auth.uid() = client_id);
