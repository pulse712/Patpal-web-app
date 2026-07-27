import { supabase } from "@/integrations/supabase/client";

export type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  introduction: string | null;
  languages: string[] | null;
};

const BASIC_PUBLIC_PROFILE_COLUMNS = "id, full_name, avatar_url, bio" as const;
const FULL_PUBLIC_PROFILE_COLUMNS =
  "id, full_name, avatar_url, bio, introduction, languages" as const;

function toPublicProfile(
  row: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    introduction?: string | null;
    languages?: string[] | null;
  },
): PublicProfile {
  return {
    id: row.id,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    bio: row.bio,
    introduction: row.introduction ?? null,
    languages: row.languages ?? null,
  };
}

/** Safe cross-user profile fields (via public_profiles view). */
export async function fetchPublicProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  if (!ids.length) return new Map();

  const full = await supabase
    .from("public_profiles")
    .select(FULL_PUBLIC_PROFILE_COLUMNS)
    .in("id", ids);

  if (!full.error && full.data) {
    return new Map(full.data.map((p) => [p.id, toPublicProfile(p)]));
  }

  const basic = await supabase
    .from("public_profiles")
    .select(BASIC_PUBLIC_PROFILE_COLUMNS)
    .in("id", ids);

  if (basic.error) {
    console.error("fetchPublicProfiles failed:", basic.error.message);
    return new Map();
  }

  return new Map((basic.data ?? []).map((p) => [p.id, toPublicProfile(p)]));
}

export async function fetchPublicProfile(id: string): Promise<PublicProfile | null> {
  const map = await fetchPublicProfiles([id]);
  return map.get(id) ?? null;
}
