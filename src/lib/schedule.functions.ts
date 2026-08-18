import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import {
  BOOKING_HORIZON_DAYS,
  SLOT_MINUTES,
  buildOpenSlots,
  EDITOR_DAYS,
  hoursToRows,
  normalizeTimeString,
  parseHm,
  rowsToHours,
  type StoredHoursRow,
  type WeeklyHours,
} from "@/lib/schedule";

const hoursSchema = z.record(
  z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
  z.object({
    enabled: z.boolean(),
    start: z.string(),
    end: z.string(),
  }),
);

function parseStoredHours(raw: unknown): StoredHoursRow[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredHoursRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.weekday !== "number" || rec.weekday < 0 || rec.weekday > 6) continue;
    if (typeof rec.start !== "string" || typeof rec.end !== "string") continue;
    const start = normalizeTimeString(rec.start);
    const end = normalizeTimeString(rec.end);
    if (!parseHm(start) || !parseHm(end)) continue;
    out.push({ weekday: rec.weekday, start, end });
  }
  return out;
}

async function isStaff(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  return !!(isAdmin || isSuperAdmin);
}

export type PalScheduleData = {
  palId: string;
  timeZone: string;
  hours: WeeklyHours;
};

export const getPalSchedule = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ palId: z.string().uuid() }).parse(data))
  .handler(async ({ data }): Promise<PalScheduleData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("pal_schedules")
      .select("pal_id, timezone, hours")
      .eq("pal_id", data.palId)
      .maybeSingle();
    return {
      palId: data.palId,
      timeZone: row?.timezone || "UTC",
      hours: rowsToHours(parseStoredHours(row?.hours)),
    };
  });

export const savePalSchedule = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        palId: z.string().uuid().optional(),
        timeZone: z.string().min(1).max(80),
        hours: hoursSchema,
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<PalScheduleData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const palId = data.palId ?? context.userId;
    if (palId !== context.userId && !(await isStaff(context.userId))) {
      throw new Error("You can only edit your own calendar.");
    }

    const hours = data.hours as WeeklyHours;
    for (const dayName of EDITOR_DAYS) {
      const day = hours[dayName];
      if (!day.enabled) continue;
      const start = normalizeTimeString(day.start);
      const end = normalizeTimeString(day.end);
      if (!parseHm(start) || !parseHm(end)) {
        throw new Error(`${dayName}: use hours like 9:00 AM as 09:00 (24-hour).`);
      }
      const a = parseHm(start)!;
      const b = parseHm(end)!;
      if (a.hour * 60 + a.minute >= b.hour * 60 + b.minute) {
        throw new Error(`${dayName}: end time must be after start time.`);
      }
      day.start = start;
      day.end = end;
    }

    const rows = hoursToRows(hours);
    const { error } = await supabaseAdmin.from("pal_schedules").upsert(
      {
        pal_id: palId,
        timezone: data.timeZone,
        hours: rows,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "pal_id" },
    );
    if (error) throw new Error(error.message);
    return { palId, timeZone: data.timeZone, hours };
  });

export type BookingSlot = { startsAt: string; endsAt: string };

async function loadOpenSlots(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  palId: string,
): Promise<{ timeZone: string; slots: BookingSlot[] }> {
  const { data: pal } = await supabaseAdmin
    .from("pat_pals")
    .select("user_id, is_approved")
    .eq("user_id", palId)
    .maybeSingle();
  if (!pal || pal.is_approved === false) return { timeZone: "UTC", slots: [] };

  const { data: schedule } = await supabaseAdmin
    .from("pal_schedules")
    .select("timezone, hours")
    .eq("pal_id", palId)
    .maybeSingle();
  const timeZone = schedule?.timezone || "UTC";
  const hours = rowsToHours(parseStoredHours(schedule?.hours));

  const horizon = new Date(Date.now() + BOOKING_HORIZON_DAYS * 86_400_000);
  const { data: booked } = await supabaseAdmin
    .from("session_bookings")
    .select("starts_at")
    .eq("pal_id", palId)
    .eq("status", "confirmed")
    .gte("starts_at", new Date().toISOString())
    .lte("starts_at", horizon.toISOString());

  const slots = buildOpenSlots({
    hours,
    timeZone,
    bookedStarts: (booked ?? []).map((b) => b.starts_at),
  });
  return { timeZone, slots };
}

export const listOpenSlots = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ palId: z.string().uuid() }).parse(data))
  .handler(async ({ data }): Promise<{ timeZone: string; slots: BookingSlot[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOpenSlots(supabaseAdmin, data.palId);
  });

export type BookingRow = {
  id: string;
  palId: string;
  clientId: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "completed";
  otherName: string;
  role: "pal" | "client";
};

export const createBooking = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ palId: z.string().uuid(), startsAt: z.string().min(10) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ bookingId: string }> => {
    if (data.palId === context.userId) {
      throw new Error("You can't book a session with yourself.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUser } = await import("@/lib/push.functions");

    const { data: pal } = await supabaseAdmin
      .from("pat_pals")
      .select("user_id, is_approved")
      .eq("user_id", data.palId)
      .maybeSingle();
    if (!pal || pal.is_approved === false) throw new Error("This Pat Pal is not available.");

    const open = await loadOpenSlots(supabaseAdmin, data.palId);
    const slot = open.slots.find((s) => s.startsAt === data.startsAt);
    if (!slot) throw new Error("That time is no longer available.");

    const { data: overlap } = await supabaseAdmin
      .from("session_bookings")
      .select("id")
      .eq("pal_id", data.palId)
      .eq("status", "confirmed")
      .lt("starts_at", slot.endsAt)
      .gt("ends_at", slot.startsAt)
      .limit(1)
      .maybeSingle();
    if (overlap) throw new Error("That time is no longer available.");

    const { data: inserted, error } = await supabaseAdmin
      .from("session_bookings")
      .insert({
        pal_id: data.palId,
        client_id: context.userId,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        status: "confirmed",
      })
      .select("id")
      .single();
    if (error?.code === "23505") throw new Error("That time is no longer available.");
    if (error || !inserted) throw new Error(error?.message || "Could not book that time.");

    const { data: clientProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const clientName = clientProfile?.full_name?.trim() || "A client";
    await sendPushToUser(data.palId, {
      title: "New booked session",
      body: `${clientName} booked a ${SLOT_MINUTES}-minute session.`,
      url: "/calendar",
      tag: `booking-${inserted.id}`,
    });

    return { bookingId: inserted.id };
  });

export const listMyBookings = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }): Promise<{ bookings: BookingRow[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("session_bookings")
      .select("id, pal_id, client_id, starts_at, ends_at, status")
      .or(`pal_id.eq.${context.userId},client_id.eq.${context.userId}`)
      .gte("starts_at", since)
      .order("starts_at", { ascending: true })
      .limit(80);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const otherIds = [
      ...new Set(rows.map((r) => (r.pal_id === context.userId ? r.client_id : r.pal_id))),
    ];
    const names = new Map<string, string>();
    if (otherIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", otherIds);
      for (const p of profiles ?? []) {
        names.set(p.id, p.full_name?.trim() || "Pat My Back user");
      }
    }

    return {
      bookings: rows.map((r) => {
        const role: "pal" | "client" = r.pal_id === context.userId ? "pal" : "client";
        const otherId = role === "pal" ? r.client_id : r.pal_id;
        return {
          id: r.id,
          palId: r.pal_id,
          clientId: r.client_id,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          status: r.status as BookingRow["status"],
          otherName: names.get(otherId) || "Pat My Back user",
          role,
        };
      }),
    };
  });

export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ bookingId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("session_bookings")
      .select("id, pal_id, client_id, status, starts_at")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (!row) throw new Error("Booking not found.");
    if (row.pal_id !== context.userId && row.client_id !== context.userId) {
      throw new Error("You can't cancel this booking.");
    }
    if (row.status !== "confirmed") throw new Error("This booking is already closed.");

    const { error } = await supabaseAdmin
      .from("session_bookings")
      .update({ status: "cancelled" })
      .eq("id", data.bookingId);
    if (error) throw new Error(error.message);

    const { sendPushToUser } = await import("@/lib/push.functions");
    const otherId = row.pal_id === context.userId ? row.client_id : row.pal_id;
    await sendPushToUser(otherId, {
      title: "Session cancelled",
      body: "A booked session was cancelled.",
      url: "/calendar",
      tag: `booking-${row.id}`,
    });
    return { ok: true };
  });

export type StaffCalendarRow = {
  palId: string;
  name: string;
  isTeam: boolean;
  timeZone: string;
  hours: WeeklyHours;
};

export const listStaffCalendars = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }): Promise<{ calendars: StaffCalendarRow[] }> => {
    if (!(await isStaff(context.userId))) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pals, error } = await supabaseAdmin
      .from("pat_pals")
      .select("user_id, is_team, is_approved")
      .eq("is_approved", true)
      .order("is_team", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (pals ?? []).map((p) => p.user_id);
    if (ids.length === 0) return { calendars: [] };
    const [{ data: profiles }, { data: schedules }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ids),
      supabaseAdmin.from("pal_schedules").select("pal_id, timezone, hours").in("pal_id", ids),
    ]);
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name?.trim() || "Pat Pal"]));
    const schedMap = new Map((schedules ?? []).map((s) => [s.pal_id, s]));

    return {
      calendars: (pals ?? []).map((p) => {
        const sched = schedMap.get(p.user_id);
        return {
          palId: p.user_id,
          name: nameMap.get(p.user_id) || "Pat Pal",
          isTeam: !!p.is_team,
          timeZone: sched?.timezone || "UTC",
          hours: rowsToHours(parseStoredHours(sched?.hours)),
        };
      }),
    };
  });
