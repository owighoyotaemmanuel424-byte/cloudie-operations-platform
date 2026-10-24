import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileDrawer } from "./MobileDrawer";
import { BottomTabBar } from "./BottomTabBar";
import { NAV_COLLAPSE_KEY } from "./navItems";

function readCollapsedPreference(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSE_KEY) === "true";
  } catch {
    // Private browsing can block storage; the rail then starts expanded.
    return false;
  }
}

function useNarrowViewport(maxWidth: number) {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    setNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}

/**
 * The authenticated shell.
 *
 * Session rules encoded here:
 *  - It reads the shared `SessionProvider`; it never fetches the session and
 *    never holds auth state of its own.
 *  - It does **not** redirect. `RequireAuth` is the single guard, so the shell
 *    and the route can never disagree about `loading`.
 *  - Collapsing the rail, opening the drawer or crossing a breakpoint only
 *    changes layout state. Nothing in this file clears a session.
 */
export function AppShell() {
  const { status } = useSession();
  const { pathname } = useLocation();
  const active = useActiveWorkspace();
  const narrow = useNarrowViewport(1279);

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedPreference);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);

  // The scroll container lives inside the shell, so the browser's own
  // restoration never fires. Reset it on navigation only.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  // Below 1280px the rail is forced to icons without overwriting the stored
  // preference: widening the window restores whatever the user chose.
  const railCollapsed = narrow || collapsed;

  const toggleRail = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(NAV_COLLAPSE_KEY, String(next));
      } catch {
        /* storage unavailable — layout still changes for this visit */
      }
      return next;
    });
  };

  if (status === "loading") return <ShellSkeleton />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <DesktopSidebar collapsed={railCollapsed} onToggle={toggleRail} autoCollapsed={narrow} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Phone-only top strip: the drawer's trigger and the current workspace. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <Menu className="size-5" aria-hidden />
          </button>

          <Link
            to="/app"
            className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            aria-label="Cloudie home"
          >
            <span className="text-sm font-bold tracking-tight text-foreground">Cloudie</span>
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", active.accent.dot)}
            />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {active.label}
            </span>
          </Link>
        </header>

        <main
          id="app-content"
          ref={scrollRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="cloudie-page mx-auto w-full max-w-[1440px] page-gutter py-4 sm:py-6 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomTabBar />
      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}

/**
 * Loading state for the shell. Deliberately a skeleton and never a redirect:
 * "not answered yet" is not "signed out".
 */
function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-background" aria-busy="true" aria-live="polite">
      <div className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-border px-3">
          <div className="size-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-11 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 shrink-0 border-b border-border bg-sidebar lg:hidden" />
        <div className="space-y-4 p-4 sm:p-6">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
        </div>
      </div>
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}
