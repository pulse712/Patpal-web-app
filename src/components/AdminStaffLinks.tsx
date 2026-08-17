import { Link } from "@tanstack/react-router";
import { ShieldCheck, LayoutDashboard, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStaffRole } from "@/hooks/use-staff-role";
import { usePendingSignupCount } from "@/hooks/use-pending-signup-count";
import { cn } from "@/lib/utils";

/** Small red dot indicating there are signups waiting for admin approval. */
function PendingDot({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background"
      aria-label={`${count} signup${count === 1 ? "" : "s"} pending approval`}
    />
  );
}

/** Prominent admin entry points for staff users. */
export function AdminStaffBanner() {
  const { isStaff, isSuperAdmin, loading } = useStaffRole();
  const pendingCount = usePendingSignupCount();

  if (loading || !isStaff) return null;

  return (
    <section className="px-5 pt-4 lg:px-8">
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="font-semibold text-primary">Staff tools</p>
            <Badge variant="secondary" className="text-[10px]">
              {isSuperAdmin ? "Super Admin" : "Admin"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users, analytics, promo codes, and banners.
          </p>
        </div>
        <Button asChild className="relative shrink-0 font-semibold">
          <Link to="/admin">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Open admin panel
            <PendingDot count={pendingCount} />
          </Link>
        </Button>
      </div>
    </section>
  );
}

export function AdminStaffHeaderButton() {
  const { isStaff, loading } = useStaffRole();
  const pendingCount = usePendingSignupCount();

  if (loading || !isStaff) return null;

  return (
    <Link
      to="/admin"
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary sm:px-3 sm:text-sm",
        "hover:bg-primary/10 transition-colors",
      )}
    >
      <ShieldCheck className="h-4 w-4" />
      Admin
      <PendingDot count={pendingCount} />
    </Link>
  );
}

export function AdminStaffProfileSection() {
  const { isStaff, isSuperAdmin, loading } = useStaffRole();

  if (loading || !isStaff) return null;

  return (
    <div className="px-5 pt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Staff
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-primary/20 bg-card">
        <Link
          to="/admin"
          className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/50"
        >
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Admin panel</span>
              <Badge variant="secondary" className="text-[10px]">
                {isSuperAdmin ? "Super Admin" : "Admin"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Users, analytics, trial codes, promo banners
            </div>
          </div>
        </Link>
        <Link
          to="/calendar"
          className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/50"
        >
          <CalendarDays className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <span className="text-sm font-semibold">Calendars</span>
            <div className="text-xs text-muted-foreground">
              Set staff and Pat Pal booking hours
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
