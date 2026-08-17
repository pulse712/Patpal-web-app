import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WeeklyHoursEditor } from "@/components/WeeklyHoursEditor";
import { toast } from "sonner";
import { CalendarDays } from "lucide-react";
import { useSession } from "@/lib/session";
import { useStaffRole } from "@/hooks/use-staff-role";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_WEEKLY_HOURS,
  detectTimeZone,
  EDITOR_DAYS,
  formatSlotRange,
  type WeeklyHours,
} from "@/lib/schedule";
import {
  cancelBooking,
  getPalSchedule,
  listMyBookings,
  listStaffCalendars,
  savePalSchedule,
  type BookingRow,
  type StaffCalendarRow,
} from "@/lib/schedule.functions";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [{ title: "Calendar — Pat My Back" }, { name: "robots", content: "noindex" }],
  }),
  component: CalendarPage,
});

function hoursSummary(hours: WeeklyHours) {
  const on = EDITOR_DAYS.filter((d) => hours[d].enabled);
  if (on.length === 0) return "No hours set";
  return on.map((d) => `${d} ${hours[d].start}–${hours[d].end}`).join(" · ");
}

function CalendarPage() {
  const { user, loading } = useSession();
  const { isStaff } = useStaffRole();
  const getPalScheduleFn = useServerFn(getPalSchedule);
  const savePalScheduleFn = useServerFn(savePalSchedule);
  const listMyBookingsFn = useServerFn(listMyBookings);
  const cancelBookingFn = useServerFn(cancelBooking);
  const listStaffCalendarsFn = useServerFn(listStaffCalendars);

  const [isListable, setIsListable] = useState(false);
  const [hours, setHours] = useState<WeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [staffHours, setStaffHours] = useState<WeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [timeZone, setTimeZone] = useState(detectTimeZone());
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [staffCals, setStaffCals] = useState<StaffCalendarRow[]>([]);
  const [editingPalId, setEditingPalId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    (async () => {
      const { data: palRow } = await supabase
        .from("pat_pals")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const listed = !!palRow;
      setIsListable(listed);
      if (listed) {
        try {
          const sched = await getPalScheduleFn({ data: { palId: user.id } });
          setHours(sched.hours);
          setTimeZone(sched.timeZone === "UTC" ? detectTimeZone() : sched.timeZone);
        } catch {
          setTimeZone(detectTimeZone());
        }
      }
      try {
        const { bookings: rows } = await listMyBookingsFn();
        setBookings(rows);
      } catch {
        setBookings([]);
      }
      if (isStaff) {
        try {
          const { calendars } = await listStaffCalendarsFn();
          setStaffCals(calendars);
        } catch {
          setStaffCals([]);
        }
      }
    })();
  }, [loading, user, isStaff, getPalScheduleFn, listMyBookingsFn, listStaffCalendarsFn]);

  async function saveHours(palId?: string) {
    if (!user) return;
    setSaving(true);
    try {
      await savePalScheduleFn({
        data: { palId, timeZone, hours: palId ? staffHours : hours },
      });
      toast.success("Calendar saved");
      setEditingPalId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save calendar.");
    } finally {
      setSaving(false);
    }
  }

  async function onCancel(id: string) {
    try {
      await cancelBookingFn({ data: { bookingId: id } });
      setBookings((rows) => rows.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)));
      toast.success("Booking cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel.");
    }
  }

  const upcoming = bookings.filter((b) => b.status === "confirmed");

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4 pb-24">
        <header>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Schedule
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <CalendarDays className="h-6 w-6 text-primary" />
            Calendar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set weekly hours so clients can book you. Instant calls still work when you are
            available.
          </p>
        </header>

        {isListable && (
          <Card className="space-y-3 p-4">
            <div>
              <h2 className="font-semibold">Your weekly hours</h2>
              <p className="text-xs text-muted-foreground">Times in {timeZone}</p>
            </div>
            <WeeklyHoursEditor hours={hours} onChange={setHours} />
            <Button onClick={() => void saveHours()} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save hours"}
            </Button>
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Upcoming bookings</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No booked sessions yet.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((b) => (
                <li
                  key={b.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{b.otherName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSlotRange(b.startsAt, b.endsAt)} ·{" "}
                      {b.role === "pal" ? "with a client" : "with your Pal"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void onCancel(b.id)}>
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isStaff && (
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">Staff and Pat Pal calendars</h2>
            <p className="text-xs text-muted-foreground">
              Admins can set hours for any listed Pal or team member.
            </p>
            <ul className="space-y-2">
              {staffCals.map((row) => (
                <li key={row.palId} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {row.name}{" "}
                        {row.isTeam && (
                          <span className="text-[10px] font-bold uppercase text-primary">
                            Staff
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{hoursSummary(row.hours)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingPalId(row.palId);
                        setStaffHours(row.hours);
                        setTimeZone(row.timeZone === "UTC" ? detectTimeZone() : row.timeZone);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                  {editingPalId === row.palId && (
                    <div className="mt-3 space-y-3">
                      <WeeklyHoursEditor hours={staffHours} onChange={setStaffHours} />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveHours(row.palId)}
                          disabled={saving}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingPalId(null)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
