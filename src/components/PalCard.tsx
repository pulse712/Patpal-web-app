import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/lib/presence";

export type PalCardData = {
  user_id: string;
  headline: string | null;
  price_cents_per_minute: number;
  availability: "available" | "busy" | "offline" | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

export function PalCard({ pal }: { pal: PalCardData }) {
  const name = pal.profiles?.full_name ?? "Pat Pal";
  const isOnline = useIsOnline(pal.user_id);
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
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
            isOnline ? "bg-success" : "bg-muted-foreground/40",
          )}
          aria-label={isOnline ? "Online" : "Offline"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{pal.headline ?? "Here to listen."}</p>
        <p className={cn("mt-0.5 text-[10px] font-medium", isOnline ? "text-success" : "text-muted-foreground")}>
          {isOnline ? "● Online now" : "○ Offline"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-primary">${(pal.price_cents_per_minute / 100).toFixed(2)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">per min</p>
      </div>
    </Link>
  );
}
