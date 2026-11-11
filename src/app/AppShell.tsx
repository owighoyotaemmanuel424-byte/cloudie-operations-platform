import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Building2,
  ChevronDown,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  Moon,
  Shield,
  Plane,
  Sun,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlatform } from "@/platform/Provider";
import { markNotificationsRead, signOut } from "@/platform/engine";
import { WORKSPACES, type Workspace } from "@/platform/model";
import { initials, points, relative } from "@/platform/format";
import { cn } from "@/lib/utils";
import { EASE } from "@/platform/ui";

const ICONS: Record<Workspace, typeof Wallet> = {
  personal: Wallet,
  shipments: Truck,
  ticketing: Plane,
  business: Building2,
  services: Mail,
};

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = usePlatform();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

function workspaceFromPath(pathname: string): Workspace {
  if (pathname.startsWith("/app/shipments")) return "shipments";
  if (pathname.startsWith("/app/ticketing")) return "ticketing";
  if (pathname.startsWith("/app/business")) return "business";
  if (pathname.startsWith("/app/services")) return "services";
  return "personal";
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <LayoutGrid className="h-4 w-4" strokeWidth={2.4} />
      </span>
      {!compact ? (
        <span className="leading-none">
          <span className="block font-display text-[17px] font-semibold tracking-tight">Cloudie</span>
          <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">
            Operations
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const [open, setOpen] = useState(false);
  const active = WORKSPACES.find((workspace) => workspace.id === current) ?? WORKSPACES[0];
  const ActiveIcon = ICONS[active.id];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
          <ActiveIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{active.label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{active.tagline}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <button
              type="button"
              aria-label="Close workspace switcher"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl"
            >
              {WORKSPACES.map((workspace) => {
                const Icon = ICONS[workspace.id];
                return (
                  <li key={workspace.id}>
                    <NavLink
                      to={workspace.route}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                        workspace.id === current
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{workspace.label}</span>
                      {workspace.id === current ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                    </NavLink>
                  </li>
                );
              })}
            </motion.ul>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NotificationBell() {
  const { db, user, unread } = usePlatform();
  const [open, setOpen] = useState(false);
  const items = user ? db.notifications.filter((item) => item.userId === user.id).slice(0, 8) : [];

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void markNotificationsRead();
        }}
        className="relative"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--brass)] ring-2 ring-card" />
        ) : null}
      </Button>
      <AnimatePresence>
        {open ? (
          <>
            <button
              type="button"
              aria-label="Close notifications"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="absolute right-0 z-40 mt-2 w-[min(88vw,340px)] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Activity</p>
                <Badge variant="secondary" className="text-[10px]">
                  {items.length}
                </Badge>
              </div>
              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
                {items.length === 0 ? (
                  <li className="px-4 py-6 text-center text-xs text-muted-foreground">No activity yet.</li>
                ) : (
                  items.map((item) => (
                    <li key={item.id} className="px-4 py-3">
                      <p className="text-[13px] font-medium">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {relative(item.at)}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SidebarContent({ current }: { current: Workspace }) {
  const { user, theme, toggleTheme } = usePlatform();
  const navigate = useNavigate();
  const active = WORKSPACES.find((workspace) => workspace.id === current) ?? WORKSPACES[0];

  return (
    <div className="flex h-full flex-col gap-5 bg-sidebar p-4 text-sidebar-foreground">
      <Brand />
      <WorkspaceSwitcher current={current} />

      <div className="rounded-xl border border-sidebar-border bg-card p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Points balance</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {points(user?.points ?? 0)}
          <span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{active.description}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {WORKSPACES.map((workspace) => {
          const Icon = ICONS[workspace.id];
          return (
            <NavLink
              key={workspace.id}
              to={workspace.route}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors",
                  isActive
                    ? "bg-primary/12 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {workspace.label}
            </NavLink>
          );
        })}
        {user?.role === "admin" ? (
          <NavLink
            to="/app/admin"
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors",
                isActive
                  ? "bg-primary/12 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )
            }
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        ) : null}
      </nav>

      <div className="space-y-1 border-t border-sidebar-border pt-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {initials(user?.name ?? "Cloudie")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user?.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{user?.email}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sign out"
            onClick={() => {
              void signOut().then(() => navigate("/auth"));
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = workspaceFromPath(location.pathname);
  const { theme, toggleTheme, user } = usePlatform();
  const active = WORKSPACES.find((workspace) => workspace.id === current) ?? WORKSPACES[0];

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-[268px] shrink-0 border-r border-sidebar-border lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent current={current} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{active.tagline}</p>
              <h1 className="truncate font-display text-base font-semibold">{active.label} workspace</h1>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="hidden rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tabular-nums sm:block">
                {points(user?.points ?? 0)} pts
              </span>
              <NotificationBell />
              <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="page-gutter flex-1 py-6 sm:py-8">
          <Outlet />
        </main>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.26, ease: EASE }}
              className="fixed inset-y-0 left-0 z-50 w-[282px] border-r border-sidebar-border lg:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-3 z-10 rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent"
              >
                <X className="h-4 w-4" />
              </button>
              <SidebarContent current={current} />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
