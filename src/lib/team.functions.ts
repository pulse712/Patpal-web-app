import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";

type TeamRole = "admin" | "super_admin";

export type TeamMember = {
  user_id: string;
  role: TeamRole;
  headline: string | null;
  price_cents_per_minute: number;
  availability: string;
  tier: string;
  full_name: string | null;
  avatar_url: string | null;
  rating_avg: number | null;
  rating_count: number | null;
};

/** Ensure admins appear as callable team members on the homepage. */
export async function ensureTeamPalRecord(
  supabaseAdmin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  userId: string,
) {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("bio")
    .eq("id", userId)
    .maybeSingle();

  const headline = profile?.bio?.trim() || "Pat My Back team";

  const { data: existing } = await supabaseAdmin
    .from("pat_pals")
    .select("user_id, headline")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from("pat_pals").update({ is_team: true }).eq("user_id", userId);
    return;
  }

  await supabaseAdmin.from("pat_pals").insert({
    user_id: userId,
    headline,
    availability: "offline",
    price_cents_per_minute: 100,
    tier: "trusted",
    is_team: true,
  });
}

/** Public staff id list — used to hide admin profiles from browse listings. */
export const getStaffUserIds = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .in("role", ["admin", "super_admin"]);
  if (error) throw new Error(error.message);
  return { userIds: [...new Set((data ?? []).map((r) => r.user_id))] };
});

export const getTeamMembers = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async (): Promise<{ members: TeamMember[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "super_admin"]);

    if (rolesError) throw new Error(rolesError.message);

    const roleByUser = new Map<string, TeamRole>();
    for (const row of roles ?? []) {
      const role = row.role as TeamRole;
      const current = roleByUser.get(row.user_id);
      if (!current || role === "super_admin") {
        roleByUser.set(row.user_id, role);
      }
    }

    const userIds = [...roleByUser.keys()];
    if (userIds.length === 0) return { members: [] };

    await Promise.all(userIds.map((userId) => ensureTeamPalRecord(supabaseAdmin, userId)));

    const [{ data: pals }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from("pat_pals")
        .select(
          "user_id, headline, price_cents_per_minute, availability, tier, rating_avg, rating_count",
        )
        .in("user_id", userIds),
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, avatar_url, is_active")
        .in("id", userIds),
    ]);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const palMap = new Map((pals ?? []).map((p) => [p.user_id, p]));

    const members = userIds
      .map((userId) => {
        const profile = profileMap.get(userId);
        if (profile?.is_active === false) return null;

        const pal = palMap.get(userId);
        if (!pal) return null;

        return {
          user_id: userId,
          role: roleByUser.get(userId)!,
          headline: pal.headline,
          price_cents_per_minute: pal.price_cents_per_minute,
          availability: pal.availability as string,
          tier: pal.tier as string,
          full_name: profile?.full_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          rating_avg: pal.rating_avg,
          rating_count: pal.rating_count,
        } as TeamMember;
      })
      .filter((m): m is TeamMember => m !== null)
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === "super_admin" ? -1 : 1;
        return (a.full_name ?? "").localeCompare(b.full_name ?? "");
      });

    return { members };
  });
