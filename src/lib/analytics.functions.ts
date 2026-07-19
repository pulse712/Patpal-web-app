// Admin analytics — aggregated stats from the database.
// Server-only: uses service role to read across all users.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    // Verify admin role
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isSuperAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (!isAdmin && !isSuperAdmin) throw new Error("Unauthorized");

    const now = new Date();
    const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const startOf7Days  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString();
    const startOfToday  = new Date(now.setHours(0, 0, 0, 0)).toISOString();

    const [
      { count: totalUsers },
      { count: newUsers7d },
      { count: totalPals },
      { count: activePals },
      { count: totalSessions },
      { count: sessions7d },
      { data: revData },
      { data: rev7dData },
      { data: topPals },
      { data: recentSessions },
      { data: dailySessions },
    ] = await Promise.all([
      // Total users
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),

      // New users last 7 days
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true })
        .gte("created_at", startOf7Days),

      // Total pat pals
      supabaseAdmin.from("pat_pals").select("*", { count: "exact", head: true }),

      // Active (available/busy) pat pals
      supabaseAdmin.from("pat_pals").select("*", { count: "exact", head: true })
        .in("availability", ["available", "busy"]),

      // Total ended sessions
      supabaseAdmin.from("sessions").select("*", { count: "exact", head: true })
        .eq("status", "ended"),

      // Sessions last 7 days
      supabaseAdmin.from("sessions").select("*", { count: "exact", head: true })
        .eq("status", "ended")
        .gte("started_at", startOf7Days),

      // Total revenue (all time) from credit_transactions purchases
      supabaseAdmin.from("credit_transactions")
        .select("cents_amount")
        .eq("kind", "purchase"),

      // Revenue last 7 days
      supabaseAdmin.from("credit_transactions")
        .select("cents_amount")
        .eq("kind", "purchase")
        .gte("created_at", startOf7Days),

      // Top 5 pals by session count
      supabaseAdmin.from("sessions")
        .select("pal_id")
        .eq("status", "ended")
        .gte("started_at", startOf30Days),

      // Recent 10 sessions
      supabaseAdmin.from("sessions")
        .select("id, client_id, pal_id, kind, seconds_used, cost_cents, started_at")
        .eq("status", "ended")
        .order("started_at", { ascending: false })
        .limit(10),

      // Sessions per day last 14 days (for chart)
      supabaseAdmin.from("sessions")
        .select("started_at")
        .eq("status", "ended")
        .gte("started_at", new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order("started_at", { ascending: true }),
    ]);

    // Aggregate revenue
    const totalRevCents = (revData ?? []).reduce((s, r) => s + (r.cents_amount ?? 0), 0);
    const rev7dCents    = (rev7dData ?? []).reduce((s, r) => s + (r.cents_amount ?? 0), 0);

    // Top pals count map
    const palSessionMap: Record<string, number> = {};
    for (const s of recentSessions ?? []) {
      if (!palSessionMap[s.pal_id]) palSessionMap[s.pal_id] = 0;
    }
    for (const s of (topPals ?? [])) {
      palSessionMap[s.pal_id] = (palSessionMap[s.pal_id] ?? 0) + 1;
    }
    const topPalIds = Object.entries(palSessionMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count }));

    // Fetch names for top pals
    let topPalNames: { id: string; name: string; count: number }[] = [];
    if (topPalIds.length) {
      const { data: palProfiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", topPalIds.map((p) => p.id));
      const nameMap = new Map((palProfiles ?? []).map((p) => [p.id, p.full_name]));
      topPalNames = topPalIds.map((p) => ({
        id: p.id,
        name: nameMap.get(p.id) ?? "Unknown",
        count: p.count,
      }));
    }

    // Sessions per day (last 14 days)
    const dayMap: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const s of dailySessions ?? []) {
      const day = s.started_at.slice(0, 10);
      if (dayMap[day] !== undefined) dayMap[day]++;
    }
    const sessionsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    // Fetch client+pal names for recent sessions
    const recentUserIds = [
      ...new Set([
        ...(recentSessions ?? []).map((s) => s.client_id),
        ...(recentSessions ?? []).map((s) => s.pal_id),
      ]),
    ];
    let recentNameMap = new Map<string, string>();
    if (recentUserIds.length) {
      const { data: rp } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", recentUserIds);
      recentNameMap = new Map((rp ?? []).map((p) => [p.id, p.full_name ?? "Unknown"]));
    }

    const recentSessionsFormatted = (recentSessions ?? []).map((s) => ({
      id: s.id,
      clientName: recentNameMap.get(s.client_id) ?? "Unknown",
      palName:    recentNameMap.get(s.pal_id) ?? "Unknown",
      kind:       s.kind as string,
      minutes:    Math.round(s.seconds_used / 60),
      costDollars: (s.cost_cents / 100).toFixed(2),
      date:       s.started_at,
    }));

    return {
      totalUsers:       totalUsers ?? 0,
      newUsers7d:       newUsers7d ?? 0,
      totalPals:        totalPals ?? 0,
      activePals:       activePals ?? 0,
      totalSessions:    totalSessions ?? 0,
      sessions7d:       sessions7d ?? 0,
      totalRevDollars:  (totalRevCents / 100).toFixed(2),
      rev7dDollars:     (rev7dCents / 100).toFixed(2),
      topPals:          topPalNames,
      recentSessions:   recentSessionsFormatted,
      sessionsByDay,
    };
  });
