import { supabase } from "@/integrations/supabase/client";

const BUCKET = "profile-avatars";
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadProfileAvatar(file: Blob): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error("You must be signed in to upload a photo.");

  const path = `${user.id}/${Date.now()}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: "image/jpeg",
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
