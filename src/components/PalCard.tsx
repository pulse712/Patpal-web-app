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
  const name = pal.profiles?.full_name?.trim() || "Pat Pal";
  const isOnline = useIsOnline(pal.user_id);

  return (
    <Link
      to="/pal/$palId"
      params={{ palId: pal.user_id }}
      className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/30"
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {pal.profiles?.avatar_url ? (
            <img
              src={pal.profiles.avatar_url}
              alt={name}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
              isOnline ? "bg-success" : "bg-muted-foreground/40",
            )}
            aria-label={isOnline ? "Online" : "Offline"}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug break-words">{name}</p>
          <p
            className={cn(
              "mt-1 text-[11px] font-medium",
              isOnline ? "text-success" : "text-muted-foreground",
            )}
          >
            {isOnline ? "● Online now" : "○ Offline"}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-snug text-muted-foreground">
        {pal.headline ?? "Here to listen."}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Talk time
        </span>
        <div className="rounded-full bg-primary-soft px-3 py-1 text-right">
          <span className="text-sm font-bold text-primary">
            ${(pal.price_cents_per_minute / 100).toFixed(2)}
          </span>
          <span className="ml-1 text-[10px] font-medium text-muted-foreground">/ min</span>
        </div>
      </div>
    </Link>
  );
}
