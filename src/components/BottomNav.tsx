import type { ReactNode } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Home, MessageCircle, Compass, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/home", label: "Home", icon: Home, exact: true },
  { to: "/browse", label: "Browse", icon: Compass, exact: false },
  { to: "/chats", label: "Chats", icon: MessageCircle, exact: false },
  { to: "/wallet", label: "Wallet", icon: Wallet, exact: false },
  { to: "/profile", label: "Profile", icon: User, exact: false },
] as const;

function NavItem({
  to,
  label,
  icon: Icon,
  exact,
  layout,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  exact: boolean;
  layout: "sidebar" | "bottom";
}) {
  const matchRoute = useMatchRoute();
  const active = !!matchRoute({ to, fuzzy: !exact });

  return (
    <li className={layout === "bottom" ? "flex-1" : undefined}>
      <Link
        to={to}
        className={cn(
          "font-medium transition-colors",
          layout === "bottom"
            ? cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px]",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )
            : cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                active
                  ? "bg-primary-soft font-semibold text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ),
        )}
      >
        <Icon className={cn(layout === "bottom" ? "h-[22px] w-[22px]" : "h-5 w-5", active && "stroke-[2.4]")} />
        <span>{label}</span>
      </Link>
    </li>
  );
}

export function SidebarNav() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-background md:flex">
      <div className="border-b border-border px-6 py-5">
        <Link to="/home" className="text-xl font-extrabold tracking-tight text-primary">
          Pat My Back
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Support when you need it</p>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col px-3 py-4">
        <ul className="space-y-1">
          {tabs.map((t) => (
            <NavItem key={t.to} {...t} layout="sidebar" />
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex w-full items-stretch justify-around px-2 py-1.5">
        {tabs.map((t) => (
          <NavItem key={t.to} {...t} layout="bottom" />
        ))}
      </ul>
    </nav>
  );
}
