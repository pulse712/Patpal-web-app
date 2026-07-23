-- Run this ONLY if MASTER_MIGRATION failed partway through (has_role error).
-- Then re-run the full MASTER_MIGRATION.sql on a clean project, OR reset first:

-- Option A — fresh start (destroys all app data in public schema):
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
-- GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- Option B — patch missing has_role if enums/tables already exist:
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('client', 'pat_pal', 'admin', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

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
