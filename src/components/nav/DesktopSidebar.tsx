import { Link, useLocation } from "react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useSession } from "@/hooks/useSession";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { UserMenu } from "./UserMenu";
import { ADMIN_ACCENT, ADMIN_LINK, SECONDARY_LINKS, isAdminRole } from "./navItems";

type DesktopSidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  /**
   * True below 1280px, where the rail is forced to icons. The manual toggle is
   * withheld rather than shown-but-inert: clicking "expand" there would write a
   * preference that the layout immediately overrides.
   */
  autoCollapsed?: boolean;
};

/**
 * 240px fixed rail, collapsible to 64px.
 *
 * It is a `hidden lg:flex` element rather than a conditionally rendered one, so
 * crossing the breakpoint never unmounts it (and therefore never touches the
 * session). The collapse control only writes a layout preference.
 */
export function DesktopSidebar({ collapsed, onToggle, autoCollapsed = false }: DesktopSidebarProps) {
  const active = useActiveWorkspace();
  const { pathname } = useLocation();
  const { user } = useSession();
  const isAdmin = isAdminRole(user?.role);

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar lg:flex",
        "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand + current workspace crumb */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2 border-b border-border",
          collapsed ? "justify-center px-2" : "px-3",
        )}
      >
        <Link
          to="/app"
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-lg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          )}
          aria-label="Cloudie home"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-[13px] font-bold text-foreground">
            C
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold leading-tight tracking-tight text-foreground">
                Cloudie
              </span>
              <span className="flex items-center gap-1.5 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", active.accent.dot)}
                />
                <span className="truncate">{active.label}</span>
              </span>
            </span>
          )}
        </Link>

        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <PanelLeftClose className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <nav
        aria-label="Primary"
        className={cn("min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-2")}
      >
        <WorkspaceSwitcher collapsed={collapsed} />

        <div className="my-3 border-t border-border" role="presentation" />

        <ul className="flex flex-col gap-0.5" role="list">
          {SECONDARY_LINKS.map((link) => {
            const Icon = link.icon;
            const isCurrent = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  to={link.href}
                  aria-label={collapsed ? link.label : undefined}
                  title={collapsed ? link.label : undefined}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground",
                    "transition-[background-color,color] duration-200 hover:bg-muted hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                  {!collapsed && <span className="truncate">{link.label}</span>}
                </Link>
              </li>
            );
          })}

          {/* Hidden — not disabled — for everyone who is not an administrator.
              The API re-checks every admin route; this is navigation, not
              access control. */}
          {isAdmin && (
            <li>
              <Link
                to={ADMIN_LINK.href}
                aria-label={collapsed ? ADMIN_LINK.label : undefined}
                title={collapsed ? ADMIN_LINK.label : undefined}
                className={cn(
                  "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground",
                  "transition-[background-color,color] duration-200 hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                  collapsed && "justify-center px-0",
                )}
              >
                <span
                  aria-hidden
                  className={cn("absolute left-0 h-5 w-[3px] rounded-r-full", ADMIN_ACCENT.bar)}
                />
                <ADMIN_LINK.icon
                  className={cn("size-5 shrink-0", ADMIN_ACCENT.text)}
                  strokeWidth={1.75}
                  aria-hidden
                />
                {!collapsed && <span className="truncate">{ADMIN_LINK.label}</span>}
              </Link>
            </li>
          )}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        {collapsed && !autoCollapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="mb-1 flex min-h-11 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <PanelLeftOpen className="size-4" aria-hidden />
          </button>
        )}
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
