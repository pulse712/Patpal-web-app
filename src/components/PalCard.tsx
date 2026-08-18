import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { isAcceptingCalls } from "@/lib/availability";

export type PalCardProfile = {
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  introduction?: string | null;
  languages?: string[] | null;
};

export type PalCardData = {
  user_id: string;
  headline: string | null;
  service_range?: string | null;
  price_cents_per_minute: number;
  availability: "available" | "busy" | "offline" | null;
  profiles: PalCardProfile | null;
};

export function PalCard({ pal }: { pal: PalCardData }) {
  const name = pal.profiles?.full_name?.trim() || "Pat Pal";
  const isOnline = isAcceptingCalls(pal.availability);
  const summary =
    pal.headline?.trim() ||
    pal.profiles?.bio?.trim() ||
    pal.profiles?.introduction?.trim() ||
    "Here to listen.";
  const languages = (pal.profiles?.languages ?? []).slice(0, 4);

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
            aria-label={isOnline ? "Available" : "Away"}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug break-words">{name}</p>
          {pal.headline?.trim() && (
            <p className="mt-0.5 text-sm font-medium text-primary">{pal.headline}</p>
          )}
          <p
            className={cn(
              "mt-1 text-[11px] font-medium",
              isOnline ? "text-success" : "text-muted-foreground",
            )}
          >
            {isAcceptingCalls(pal.availability) ? "● Available" : "○ Away"}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm leading-snug text-muted-foreground">{summary}</p>

      {pal.service_range?.trim() && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Range:</span> {pal.service_range}
        </p>
      )}

      {languages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {languages.map((lang) => (
            <span
              key={lang}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {lang}
            </span>
          ))}
          {(pal.profiles?.languages?.length ?? 0) > languages.length && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              +{(pal.profiles?.languages?.length ?? 0) - languages.length}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Rate
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
