import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RequireAdmin } from "@/components/RequireAdmin";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useState } from "react";
import { usePendingChanges } from "@/lib/pendingChanges";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, BadgeDollarSign, BarChart3, Bell, Boxes, Brain, Building2, ChevronRight,
  ClipboardCheck, CreditCard, FileText, Gavel, Inbox, Layers, LayoutDashboard,
  LogOut, Mail, MapPin, Menu, Package, Palette, Settings, ShieldAlert,
  ShieldCheck, ShoppingCart, Tags, Truck, Users, Zap, Waypoints, Wrench,
  PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { AppSearch } from "@/components/AppSearch";

type AdminItem = { to: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "openFlags" | "pendingKyc" | "pendingVendors" | "openDisputes"; pendingScope?: "pricing" | "catalog" };
type AdminGroup = { label: GroupLabel; items: AdminItem[] };
type GroupLabel = "Command Center" | "Users & Access" | "Finance" | "VTU & Providers" | "Marketplace" | "Logistics" | "Documents & AI" | "Communications" | "Configuration";

const ADMIN_GROUPS: AdminGroup[] = [
  { label: "Command Center", items: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/system-health", label: "System Health", icon: Activity },
    { to: "/admin/risk", label: "Risk Operations", icon: ShieldAlert },
    { to: "/admin/maintenance", label: "Maintenance Mode", icon: Wrench },
  ]},
  { label: "Users & Access", items: [
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/administrators", label: "Administrators", icon: ShieldCheck },
    { to: "/admin/tenants", label: "Business Tenants", icon: Building2, badge: "openFlags" as const },
    { to: "/admin/kyc", label: "KYC", icon: ClipboardCheck, badge: "pendingKyc" as const },
    { to: "/admin/audit", label: "Audit Logs", icon: ShieldAlert },
  ]},
  { label: "Finance", items: [
    { to: "/admin/transactions", label: "Wallet & Ledger", icon: BadgeDollarSign },
    { to: "/admin/payments", label: "Payment Providers", icon: CreditCard },
    { to: "/admin/pricing", label: "Pricing", icon: BadgeDollarSign, pendingScope: "pricing" as const },
  ]},
  { label: "VTU & Providers", items: [
    { to: "/admin/vtu/providers", label: "VTU Providers", icon: Zap },
    { to: "/admin/vtu/catalog", label: "VTU Catalog & Routing", icon: Waypoints, pendingScope: "catalog" as const },
    { to: "/admin/catalog", label: "Catalog & Prices", icon: Tags },
    { to: "/admin/vtu/unresolved", label: "VTU Unresolved", icon: Inbox },
  ]},
  { label: "Marketplace", items: [
    { to: "/admin/vendors", label: "Vendors", icon: Boxes, badge: "pendingVendors" as const },
    { to: "/admin/marketplace", label: "Marketplace", icon: ShoppingCart },
    { to: "/admin/orders", label: "Orders", icon: Package },
    { to: "/admin/disputes", label: "Disputes", icon: Gavel, badge: "openDisputes" as const },
  ]},
  { label: "Logistics", items: [
    { to: "/admin/shipments", label: "Shipments", icon: Truck },
    { to: "/admin/locations", label: "Locations", icon: MapPin },
    { to: "/admin/facilities", label: "Facilities", icon: Building2 },
  ]},
  { label: "Documents & AI", items: [
    { to: "/admin/documents", label: "Documents", icon: FileText },
    { to: "/admin/document-templates", label: "Doc Templates", icon: Layers },
    { to: "/admin/template-classifier", label: "AI Classifier", icon: Brain },
    { to: "/admin/document-templates/classify", label: "Classify Studio", icon: Brain },
  ]},
  { label: "Communications", items: [
    { to: "/admin/notifications", label: "Notifications", icon: Bell },
    { to: "/admin/settings/email", label: "Email Settings", icon: Mail },
  ]},
  { label: "Configuration", items: [
    { to: "/admin/appearance", label: "Appearance & Support", icon: Palette },
    { to: "/admin/settings", label: "Settings", icon: Settings, exact: true },
  ]},
] as const;

/** The group + item the current path belongs to, for the breadcrumb trail. */
function trail(pathname: string): { group: AdminGroup; item: AdminItem } | null {
  for (const group of ADMIN_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.to || (!item.exact && pathname.startsWith(item.to + "/"))) {
        return { group, item };
      }
    }
  }
  return null;
}

/**
 * Which sidebar group is open.
 *
 * `null` = "no manual choice yet", so the open group is derived from the current
 * route; `false` = the administrator collapsed everything. Deriving instead of
 * mirroring the route into state inside an effect is what keeps a navigation
 * from triggering a second render pass on every route change.
 */
type GroupChoice = GroupLabel | null | false;

function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<GroupChoice>(null);
  const badgeCounts = useQuery(api.adminApi.adminBadgeCounts) ?? {
    pendingVendors: 0, pendingKyc: 0, openDisputes: 0, openFlags: 0,
  };
  const pendingPricing = usePendingChanges("pricing");
  const pendingCatalog = usePendingChanges("catalog");

  const pendingCountFor = (scope: "pricing" | "catalog" | undefined) =>
    scope === "pricing" ? pendingPricing : scope === "catalog" ? pendingCatalog : 0;

  const badgeFor = (badge: keyof typeof badgeCounts | undefined) =>
    badge ? badgeCounts[badge] : 0;

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login");
  };

  const pendingBadge = (count: number) =>
    count > 0 ? (
      <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  const alertBadge = (count: number) =>
    count > 0 ? (
      <span className="rounded-full bg-error/15 px-1.5 py-0.5 text-[10px] font-bold text-error">
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  const current = trail(location.pathname);

  const navList = (options: { collapsed: boolean }) => (
    <nav
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
      aria-label="Admin navigation"
    >
      {ADMIN_GROUPS.map((group) => {
        const hasActive = group.items.some((item) =>
          location.pathname === item.to || (!item.exact && location.pathname.startsWith(item.to + "/")),
        );
        const expanded = options.collapsed
          ? true
          : expandedGroup === null
            ? hasActive
            : expandedGroup !== false && expandedGroup === group.label;
        return (
          <div key={group.label} className="mb-0.5">
            <button
              type="button"
              onClick={() =>
                setExpandedGroup((previous) => {
                  const open = previous === null ? hasActive : previous;
                  return open === group.label ? false : group.label;
                })
              }
              aria-expanded={expanded}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground",
                options.collapsed && "justify-center px-0",
              )}
            >
              <span className={cn("flex-1 text-left", options.collapsed && "sr-only")}>
                {group.label}
              </span>
              {!options.collapsed && (
                <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
              )}
            </button>
            {expanded && (
              <div className="space-y-0.5 pb-1">
                {group.items.map((item) => {
                  const count = badgeFor(item.badge);
                  const pendingCount = pendingCountFor(item.pendingScope);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.exact}
                      onClick={() => setMobileOpen(false)}
                      title={options.collapsed ? item.label : undefined}
                      aria-label={options.collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "relative flex min-h-10 items-center rounded-xl text-sm font-medium transition-colors duration-200",
                          options.collapsed ? "justify-center px-0" : "gap-3 px-3",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden
                            className={cn(
                              "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                              isActive ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <item.icon className="size-4 shrink-0" />
                          {!options.collapsed && (
                            <>
                              <span className="flex-1 truncate">{item.label}</span>
                              {alertBadge(count)}
                              {pendingBadge(pendingCount)}
                            </>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        aria-label="Administration"
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex lg:h-screen lg:sticky lg:top-0",
          collapsed ? "w-[68px]" : "w-72",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "justify-center px-2" : "gap-2.5 px-3",
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold leading-tight tracking-tight">
                Command Center
              </span>
              <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {user?.name || user?.email || "Administrator"}
              </span>
            </span>
          )}
        </div>
        {navList({ collapsed })}
        <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand admin sidebar" : "Collapse admin sidebar"}
            className={cn(
              "flex min-h-10 w-full items-center rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className={cn(
              "flex min-h-10 w-full items-center rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-error/10 hover:text-error",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-xl sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open admin menu"
          >
            <Menu className="size-5" />
          </Button>

          <div className="hidden min-w-0 flex-1 lg:block">
            <Breadcrumb>
              <BreadcrumbList className="text-xs sm:text-sm">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <NavLink to="/admin">Admin</NavLink>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {current && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="hidden sm:block">
                      {current.group.label}
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden sm:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage className="font-semibold text-foreground">
                        {current.item.label}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 lg:flex-none">
            <span className="truncate text-sm font-semibold lg:hidden">
              {current?.item.label ?? "Command Center"}
            </span>
            <div className="hidden sm:block">
              <AppSearch />
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="relative size-11 sm:size-9"
            onClick={() => navigate("/admin/notifications")}
            aria-label="Admin notifications"
          >
            <Bell className="size-4" />
            {badgeCounts.openDisputes + badgeCounts.pendingKyc + badgeCounts.pendingVendors > 0 && (
              <span
                aria-hidden
                className="absolute right-0.5 top-0.5 size-2 rounded-full bg-error"
              />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-11 gap-2 px-1 sm:h-9 sm:w-auto sm:px-2" aria-label="Administrator menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {(user?.name || user?.email || "A").charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-[140px] truncate text-sm font-medium md:inline">
                  {user?.name || user?.email || "Administrator"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="truncate">{user?.email || "Signed in"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/admin/settings")}>
                <Settings className="mr-2 size-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                <LayoutDashboard className="mr-2 size-4" /> Customer view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-error focus:text-error">
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="relative z-10 bg-error/12 border-b border-red-500/25" />
        <header className="sticky top-0 z-30 flex h-7 shrink-0 items-center px-3 text-[11px] font-medium text-error/80">
          Admin actions are logged
        </header>
        <div className="relative z-10 bg-error/12 border-b border-red-500/25" />
        <header className="sticky top-0 z-30 flex h-7 shrink-0 items-center px-3 text-[11px] font-medium text-error/80">
          Admin actions are logged
        </header>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-80 border-sidebar-border bg-sidebar p-0">
          <SheetTitle className="sr-only">Administration navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Every administrative section of the Cloudie platform.
          </SheetDescription>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ShieldCheck className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold leading-tight">
                  Command Center
                </span>
                <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {user?.email || "Administrator"}
                </span>
              </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex min-h-full flex-col">
                {navList({ collapsed: false })}
              </div>
            </ScrollArea>
            <div className="shrink-0 border-t border-sidebar-border p-2">
              <button
                type="button"
                onClick={handleSignOut}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-error/10 hover:text-error"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function AdminLayout() {
  return <RequireAdmin><AdminShell /></RequireAdmin>;
}
