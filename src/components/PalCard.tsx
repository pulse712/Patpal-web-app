import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type PalCardData = {
  user_id: string;
  headline: string | null;
  price_cents_per_minute: number;
  availability: "available" | "busy" | "offline" | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

const statusColor: Record<string, string> = {
  available: "bg-success",
  busy: "bg-accent",
  offline: "bg-muted-foreground/40",
};

export function PalCard({ pal }: { pal: PalCardData }) {
  const name = pal.profiles?.full_name ?? "Pat Pal";
  const dot = statusColor[pal.availability ?? "offline"] ?? statusColor.offline;
  return (
    <Link
      to="/pal/$palId"
      params={{ palId: pal.user_id }}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card transition-colors hover:border-primary/30"
    >
      <div className="relative">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{pal.headline ?? "Here to listen."}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-primary">${(pal.price_cents_per_minute / 100).toFixed(2)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">per min</p>
      </div>
    </Link>
  );
}
