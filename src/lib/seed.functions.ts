import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";

type Demo = {
  email: string;
  full_name: string;
  headline: string;
  bio: string;
  price: number;
  tier: "trusted" | "premium" | "expert";
  availability: "available" | "busy" | "offline";
  is_team: boolean;
  rating_avg: number;
  rating_count: number;
  category_slugs: string[];
  avatar_url: string;
};

const DEMOS: Demo[] = [
  {
    email: "rachel.demo@patmyback.app",
    full_name: "Rachel Kim",
    headline: "Co-founder of Pat My Back. I'm here to help.",
    bio: "Co-founder, listener, cheerleader.",
    price: 0,
    tier: "trusted",
    availability: "available",
    is_team: true,
    rating_avg: 5.0,
    rating_count: 42,
    category_slugs: ["mentorship", "encouragement"],
    avatar_url: "https://i.pravatar.cc/200?img=47",
  },
  {
    email: "benhurk.demo@patmyback.app",
    full_name: "Benhurk",
    headline: "Founder of Pat My Back. Call me to try out the app.",
    bio: "Founder. Ask me anything.",
    price: 0,
    tier: "trusted",
    availability: "available",
    is_team: true,
    rating_avg: 4.9,
    rating_count: 31,
    category_slugs: ["mentorship", "business-coaching"],
    avatar_url: "https://i.pravatar.cc/200?img=12",
  },
  {
    email: "sarah.chen.demo@patmyback.app",
    full_name: "Dr. Sarah Chen",
    headline: "Career coach with 20+ years helping professionals navigate transitions.",
    bio: "20+ years of career coaching experience.",
    price: 200,
    tier: "expert",
    availability: "available",
    is_team: false,
    rating_avg: 4.9,
    rating_count: 128,
    category_slugs: ["career-advice", "consulting"],
    avatar_url: "https://i.pravatar.cc/200?img=45",
  },
  {
    email: "michael.torres.demo@patmyback.app",
    full_name: "Michael Torres",
    headline: "On-demand specialist for operations, growth strategy, and scale.",
    bio: "Ops & growth consultant.",
    price: 250,
    tier: "premium",
    availability: "available",
    is_team: false,
    rating_avg: 4.8,
    rating_count: 87,
    category_slugs: ["business-coaching", "consulting"],
    avatar_url: "https://i.pravatar.cc/200?img=33",
  },
  {
    email: "luna.martinez.demo@patmyback.app",
    full_name: "Luna Martinez",
    headline: "Your accountability partner. I'll help you stay focused, hit your goals.",
    bio: "Accountability & motivation coach.",
    price: 100,
    tier: "trusted",
    availability: "available",
    is_team: false,
    rating_avg: 4.7,
    rating_count: 64,
    category_slugs: ["accountability", "motivation"],
    avatar_url: "https://i.pravatar.cc/200?img=48",
  },
  {
    email: "david.kim.demo@patmyback.app",
    full_name: "Prof. David Kim",
    headline: "Premium mentorship for founders and executives. Deep expertise.",
    bio: "Executive mentor.",
    price: 300,
    tier: "expert",
    availability: "offline",
    is_team: false,
    rating_avg: 4.9,
    rating_count: 156,
    category_slugs: ["mentorship", "business-coaching"],
    avatar_url: "https://i.pravatar.cc/200?img=68",
  },
];

/** Shared seed logic — used by server fn and API route. */
export async function runSeedDemoPatPals() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results: string[] = [];

  for (const d of DEMOS) {
    let demoUserId: string | null = null;
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users.find((u) => u.email === d.email);
    if (existing) {
      demoUserId = existing.id;
    } else {
      const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
        email: d.email,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { full_name: d.full_name, role: "pat_pal", bio: d.bio },
      });
      if (cErr || !created?.user) {
        results.push(`skip ${d.email}: ${cErr?.message ?? "no user"}`);
        continue;
      }
      demoUserId = created.user.id;
    }

    await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: demoUserId, full_name: d.full_name, avatar_url: d.avatar_url, bio: d.bio },
        { onConflict: "id" },
      );

    await supabaseAdmin.from("pat_pals").upsert(
      {
        user_id: demoUserId,
        headline: d.headline,
        price_cents_per_minute: d.price,
        tier: d.tier,
        availability: d.availability,
        is_team: d.is_team,
        rating_avg: d.rating_avg,
        rating_count: d.rating_count,
        category_slugs: d.category_slugs,
      },
      { onConflict: "user_id" },
    );

    await supabaseAdmin.from("user_roles").upsert(
      { user_id: demoUserId, role: "pat_pal" },
      { onConflict: "user_id,role" },
    );

    results.push(`ok ${d.email}`);
  }
  return { results };
}

export const seedDemoPatPals = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);

    if (!isAdmin && !isSuperAdmin) {
      throw new Error("Unauthorized: Admin access required");
    }

    return runSeedDemoPatPals();
  });
