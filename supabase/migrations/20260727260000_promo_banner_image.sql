-- Promo banner image support + public storage bucket for admin uploads.

ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('promo-banners', 'promo-banners', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "promo banners public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'promo-banners');

CREATE POLICY "promo banners admin upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'promo-banners'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "promo banners admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'promo-banners'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "promo banners admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'promo-banners'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );
