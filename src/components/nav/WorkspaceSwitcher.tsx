import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { WORKSPACES, type Workspace } from "./navItems";

type WorkspaceSwitcherProps = {
  /** Icon-only rail. Labels become the accessible name and the tooltip. */
  collapsed?: boolean;
  /** Drawer items are taller: this is the primary touch surface on phones. */
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
};

/**
 * The six workspaces, in one list, for every surface.
 *
 * Active state comes from the route (`useActiveWorkspace`), so a deep link is
 * highlighted on first render and no click has to "set" anything.
 */
export function WorkspaceSwitcher({
  collapsed = false,
  variant = "desktop",
  onNavigate,
}: WorkspaceSwitcherProps) {
  const active = useActiveWorkspace();

  return (
    <ul className="flex flex-col gap-0.5" role="list">
      {WORKSPACES.map((workspace) => (
        <li key={workspace.id}>
          <WorkspaceItem
            workspace={workspace}
            active={workspace.id === active.id}
            collapsed={collapsed}
            variant={variant}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  );
}

function WorkspaceItem({
  workspace,
  active,
  collapsed,
  variant,
  onNavigate,
}: {
  workspace: Workspace;
  active: boolean;
  collapsed: boolean;
  variant: "desktop" | "drawer";
  onNavigate?: () => void;
}) {
  const Icon = workspace.icon;

  return (
    <Link
      to={workspace.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? workspace.label : undefined}
      title={collapsed ? workspace.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg text-sm font-medium",
        "transition-[background-color,color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        variant === "drawer" ? "min-h-12 px-3" : "min-h-11 px-3",
        collapsed && "justify-center px-0",
        active
          ? cn("bg-muted text-foreground", workspace.accent.tint)
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {/* The accent bar is a shape as well as a colour, so "current page" does
          not depend on hue perception. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-200",
          workspace.accent.bar,
          active ? "opacity-100" : "opacity-0",
        )}
      />

      {!collapsed && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-opacity duration-200",
            workspace.accent.dot,
            active ? "opacity-100" : "opacity-60 group-hover:opacity-90",
          )}
        />
      )}

      <Icon
        aria-hidden
        className={cn(
          "shrink-0",
          variant === "drawer" ? "size-5" : "size-5",
          active ? workspace.accent.text : "text-muted-foreground group-hover:text-foreground",
        )}
        strokeWidth={1.75}
      />

      {!collapsed && <span className="truncate">{workspace.label}</span>}
    </Link>
  );
}
