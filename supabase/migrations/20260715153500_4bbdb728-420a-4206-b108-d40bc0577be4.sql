
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any existing auth users that are missing rows
INSERT INTO public.profiles (id, full_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', '')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profile_contacts (user_id, phone)
SELECT u.id, u.raw_user_meta_data->>'phone'
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.wallets (user_id, balance_seconds)
SELECT u.id, 0 FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, COALESCE((u.raw_user_meta_data->>'role')::public.app_role, 'client')
FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.pat_pals (user_id, headline)
SELECT u.id, u.raw_user_meta_data->>'bio'
FROM auth.users u
WHERE COALESCE(u.raw_user_meta_data->>'role', 'client') = 'pat_pal'
ON CONFLICT (user_id) DO NOTHING;
