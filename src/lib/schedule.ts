export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const EDITOR_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type EditorDay = (typeof EDITOR_DAYS)[number];

export const SLOT_MINUTES = 30;
export const BOOKING_HORIZON_DAYS = 14;

export type DayHours = {
  enabled: boolean;
  start: string;
  end: string;
};

export type WeeklyHours = Record<EditorDay, DayHours>;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  Mon: { enabled: true, start: "09:00", end: "17:00" },
  Tue: { enabled: true, start: "09:00", end: "17:00" },
  Wed: { enabled: true, start: "09:00", end: "17:00" },
  Thu: { enabled: true, start: "09:00", end: "17:00" },
  Fri: { enabled: true, start: "09:00", end: "17:00" },
  Sat: { enabled: false, start: "09:00", end: "17:00" },
  Sun: { enabled: false, start: "09:00", end: "17:00" },
};

const EDITOR_TO_JS_DAY: Record<EditorDay, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type StoredHoursRow = {
  weekday: number;
  start: string;
  end: string;
};

const JS_DAY_TO_EDITOR: Record<number, EditorDay> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function hoursToRows(hours: WeeklyHours): StoredHoursRow[] {
  return EDITOR_DAYS.filter((day) => hours[day].enabled).map((day) => ({
    weekday: EDITOR_TO_JS_DAY[day],
    start: normalizeTimeString(hours[day].start),
    end: normalizeTimeString(hours[day].end),
  }));
}

export function rowsToHours(rows: StoredHoursRow[] | null | undefined): WeeklyHours {
  const next: WeeklyHours = {
    Mon: { ...DEFAULT_WEEKLY_HOURS.Mon, enabled: false },
    Tue: { ...DEFAULT_WEEKLY_HOURS.Tue, enabled: false },
    Wed: { ...DEFAULT_WEEKLY_HOURS.Wed, enabled: false },
    Thu: { ...DEFAULT_WEEKLY_HOURS.Thu, enabled: false },
    Fri: { ...DEFAULT_WEEKLY_HOURS.Fri, enabled: false },
    Sat: { ...DEFAULT_WEEKLY_HOURS.Sat, enabled: false },
    Sun: { ...DEFAULT_WEEKLY_HOURS.Sun, enabled: false },
  };
  for (const row of rows ?? []) {
    const day = JS_DAY_TO_EDITOR[row.weekday];
    if (!day) continue;
    next[day] = {
      enabled: true,
      start: normalizeTimeString(row.start),
      end: normalizeTimeString(row.end),
    };
  }
  return next;
}

export function normalizeTimeString(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return trimmed;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return trimmed;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseHm(value: string): { hour: number; minute: number } | null {
  const normalized = normalizeTimeString(value);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** UTC instant for a wall-clock time in `timeZone`. */
export function wallClockInTimeZoneToDate(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = (ms: number) => {
    const map: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms))) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour === "24" ? 0 : map.hour),
      minute: Number(map.minute),
    };
  };
  const seen = parts(guess);
  const actual = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess + (desired - actual));
}

export type OpenSlot = {
  startsAt: string;
  endsAt: string;
};

export function buildOpenSlots(opts: {
  hours: WeeklyHours;
  timeZone: string;
  bookedStarts: string[];
  from?: Date;
  days?: number;
  slotMinutes?: number;
}): OpenSlot[] {
  const from = opts.from ?? new Date();
  const days = opts.days ?? BOOKING_HORIZON_DAYS;
  const slotMinutes = opts.slotMinutes ?? SLOT_MINUTES;
  const booked = new Set(opts.bookedStarts);

  const slots: OpenSlot[] = [];
  for (let offset = 0; offset < days; offset++) {
    const cursor = new Date(from.getTime() + offset * 86_400_000);
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: opts.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(cursor);
    const [year, month, day] = ymd.split("-").map(Number);
    const weekdayName = new Intl.DateTimeFormat("en-US", {
      timeZone: opts.timeZone,
      weekday: "short",
    }).format(wallClockInTimeZoneToDate(opts.timeZone, year, month, day, 12, 0));
    const editorDay = EDITOR_DAYS.find((d) => d === weekdayName) ?? null;
    if (!editorDay) continue;
    const hours = opts.hours[editorDay];
    if (!hours.enabled) continue;
    const start = parseHm(hours.start);
    const end = parseHm(hours.end);
    if (!start || !end) continue;
    let minutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    while (minutes + slotMinutes <= endMinutes) {
      const sh = Math.floor(minutes / 60);
      const sm = minutes % 60;
      const eh = Math.floor((minutes + slotMinutes) / 60);
      const em = (minutes + slotMinutes) % 60;
      const starts = wallClockInTimeZoneToDate(opts.timeZone, year, month, day, sh, sm);
      const ends = wallClockInTimeZoneToDate(opts.timeZone, year, month, day, eh, em);
      if (starts.getTime() > from.getTime() + 60_000 && !booked.has(starts.toISOString())) {
        slots.push({ startsAt: starts.toISOString(), endsAt: ends.toISOString() });
      }
      minutes += slotMinutes;
    }
  }
  return slots;
}

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatSlotRange(startsAt: string, endsAt: string, timeZone?: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const t0 = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const t1 = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return `${day} · ${t0} – ${t1}`;
}
