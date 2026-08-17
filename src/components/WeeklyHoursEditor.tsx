import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { EDITOR_DAYS, type DayHours, type EditorDay, type WeeklyHours } from "@/lib/schedule";

export function WeeklyHoursEditor({
  hours,
  onChange,
}: {
  hours: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
}) {
  function updateDay(day: EditorDay, patch: Partial<DayHours>) {
    onChange({ ...hours, [day]: { ...hours[day], ...patch } });
  }

  return (
    <div className="space-y-2.5">
      {EDITOR_DAYS.map((day) => {
        const d = hours[day];
        return (
          <div key={day} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
            <Switch
              checked={d.enabled}
              onCheckedChange={(v) => updateDay(day, { enabled: v })}
              aria-label={`Toggle ${day}`}
            />
            <span className="w-10 text-sm font-semibold">{day}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Input
                type="time"
                value={d.start}
                disabled={!d.enabled}
                onChange={(e) => updateDay(day, { start: e.target.value })}
                className="h-9 w-[110px]"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="time"
                value={d.end}
                disabled={!d.enabled}
                onChange={(e) => updateDay(day, { end: e.target.value })}
                className="h-9 w-[110px]"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
