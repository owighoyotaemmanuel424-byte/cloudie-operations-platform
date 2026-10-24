import { useLocation } from "react-router";
import { WORKSPACES, type Workspace } from "@/components/nav/navItems";

/**
 * The workspace a URL belongs to.
 *
 * Derived from the route on every render — never stored in nav state. That is
 * what makes a deep link such as `/app/shipments/xyz` open with Shipments
 * already highlighted, and what stops a drawer close or a sidebar collapse from
 * changing which item looks active.
 *
 * Matching is longest-prefix-wins with path boundaries, so `/app/services/email`
 * cannot be swallowed by the shorter `/app` (Personal) prefix.
 */
export function workspaceForPath(pathname: string): Workspace {
  const path = pathname.split("?")[0].split("#")[0] || "/";

  const matches = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

  let best: Workspace | null = null;
  let bestLength = -1;

  for (const workspace of WORKSPACES) {
    for (const prefix of workspace.match) {
      if (matches(prefix) && prefix.length > bestLength) {
        best = workspace;
        bestLength = prefix.length;
      }
    }
  }

  // Anything signed-in that no workspace claims (settings, billing, help…)
  // stays inside Personal rather than leaving the nav with no active item.
  return best ?? WORKSPACES[0];
}

export function useActiveWorkspace(): Workspace {
  const { pathname } = useLocation();
  return workspaceForPath(pathname);
}
