-- Profile photo uploads (public read, users manage files in their own folder).

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-avatars', 'profile-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "profile avatars public read" ON storage.objects;
CREATE POLICY "profile avatars public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-avatars');

DROP POLICY IF EXISTS "profile avatars owner upload" ON storage.objects;
CREATE POLICY "profile avatars owner upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "profile avatars owner update" ON storage.objects;
CREATE POLICY "profile avatars owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "profile avatars owner delete" ON storage.objects;
CREATE POLICY "profile avatars owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
