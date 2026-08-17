import { describe, expect, it } from "vitest";
import { buildOpenSlots, DEFAULT_WEEKLY_HOURS, hoursToRows, rowsToHours } from "./schedule";

describe("schedule hours", () => {
  it("round-trips enabled weekdays", () => {
    const rows = hoursToRows(DEFAULT_WEEKLY_HOURS);
    expect(rows.map((r) => r.weekday).sort()).toEqual([1, 2, 3, 4, 5]);
    const back = rowsToHours(rows);
    expect(back.Mon.enabled).toBe(true);
    expect(back.Sat.enabled).toBe(false);
    expect(back.Mon.start).toBe("09:00");
  });

  it("builds future weekday slots and skips booked starts", () => {
    const from = new Date("2026-08-17T12:00:00.000Z"); // Monday
    const slots = buildOpenSlots({
      hours: DEFAULT_WEEKLY_HOURS,
      timeZone: "UTC",
      bookedStarts: [],
      from,
      days: 2,
      slotMinutes: 30,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => new Date(s.startsAt).getTime() > from.getTime())).toBe(true);
    const booked = slots[0]!.startsAt;
    const open = buildOpenSlots({
      hours: DEFAULT_WEEKLY_HOURS,
      timeZone: "UTC",
      bookedStarts: [booked],
      from,
      days: 2,
      slotMinutes: 30,
    });
    expect(open.some((s) => s.startsAt === booked)).toBe(false);
  });
});
