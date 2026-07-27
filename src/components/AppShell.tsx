import type { ReactNode } from "react";
import { BottomNav, SidebarNav } from "./BottomNav";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  /** Use for full-height views like chat (fills viewport below sidebar). */
  fullHeight?: boolean;
};

export function AppShell({ children, fullHeight = false }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="md:flex">
        <SidebarNav />
        <main
          className={cn(
            "min-h-screen min-w-0 flex-1",
            fullHeight ? "flex flex-col pb-24 md:pb-0" : "pb-24 md:pb-8",
          )}
        >
          <div
            className={cn(
              "mx-auto w-full max-w-7xl",
              fullHeight ? "flex min-h-0 flex-1 flex-col" : undefined,
            )}
          >
            {children}
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
