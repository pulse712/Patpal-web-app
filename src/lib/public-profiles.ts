import { supabase } from "@/integrations/supabase/client";

export type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  introduction: string | null;
  languages: string[] | null;
};

/** Safe cross-user profile fields (via public_profiles view). */
export async function fetchPublicProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (!ids.length) return new Map();

  const { data } = await supabase
    .from("public_profiles")
    .select("id, full_name, avatar_url, bio, introduction, languages")
    .in("id", ids);

  return new Map((data ?? []).map((p) => [p.id, p as PublicProfile]));
}

export async function fetchPublicProfile(id: string): Promise<PublicProfile | null> {
  const map = await fetchPublicProfiles([id]);
  return map.get(id) ?? null;
}
