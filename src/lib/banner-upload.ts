import { supabase } from "@/integrations/supabase/client";

const BUCKET = "promo-banners";
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadPromoBannerImage(file: Blob, ext = "jpg"): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: ext === "webp" ? "image/webp" : "image/jpeg",
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
