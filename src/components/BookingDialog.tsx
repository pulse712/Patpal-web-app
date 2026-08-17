import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createBooking, listOpenSlots } from "@/lib/schedule.functions";
import { formatSlotRange, type OpenSlot } from "@/lib/schedule";

export function BookingDialog({
  palId,
  palName,
  open,
  onOpenChange,
}: {
  palId: string;
  palName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const listOpenSlotsFn = useServerFn(listOpenSlots);
  const createBookingFn = useServerFn(createBooking);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setLoading(true);
    void listOpenSlotsFn({ data: { palId } })
      .then((res) => setSlots(res.slots))
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [open, palId, listOpenSlotsFn]);

  const grouped = useMemo(() => {
    const map = new Map<string, OpenSlot[]>();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [slots]);

  async function book() {
    if (!selected) return;
    setBooking(true);
    try {
      await createBookingFn({ data: { palId, startsAt: selected } });
      toast.success("Session booked");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not book that time.");
    } finally {
      setBooking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book {palName}</DialogTitle>
          <DialogDescription>
            Pick a 30-minute slot from their calendar. You can still call now if they are available.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading times…</p>
        ) : grouped.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No open times in the next two weeks. They may not have set hours yet — try Chat or Call
            now.
          </p>
        ) : (
          <div className="space-y-4 py-1">
            {grouped.map(([day, daySlots]) => (
              <div key={day}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {day}
                </p>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => setSelected(slot.startsAt)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                        selected === slot.startsAt
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {formatSlotRange(slot.startsAt, slot.endsAt).split(" · ")[1]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void book()} disabled={!selected || booking}>
            {booking ? "Booking…" : "Book session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
