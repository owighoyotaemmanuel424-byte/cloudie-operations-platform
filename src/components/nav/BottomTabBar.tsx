import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { BOTTOM_TABS } from "./navItems";

/**
 * Phone thumb bar: five workspaces, 56px tall plus the home-indicator inset.
 *
 * Business Suite is deliberately absent — six 48px tabs do not fit a 320px
 * screen without dropping below the 44px touch minimum. It is reached through
 * the drawer, which the spec allows.
 */
export function BottomTabBar() {
  const active = useActiveWorkspace();

  return (
    <nav
      aria-label="Workspaces"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch" role="list">
        {BOTTOM_TABS.map((tab) => {
          const isCurrent = tab.id === active.id;
          const Icon = tab.icon;
          return (
            <li key={tab.id} className="min-w-0 flex-1">
              <Link
                to={tab.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium",
                  "transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isCurrent ? tab.accent.text : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-4 top-0 h-0.5 rounded-full transition-opacity duration-200",
                    tab.accent.bar,
                    isCurrent ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="size-6" strokeWidth={1.75} aria-hidden />
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
