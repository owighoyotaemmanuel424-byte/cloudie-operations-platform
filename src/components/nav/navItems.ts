import {
  Building2,
  Layers,
  LifeBuoy,
  Settings,
  Shield,
  Store,
  Ticket,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";

/**
 * The navigation contract.
 *
 * This is the only file that knows the workspace list. The desktop sidebar, the
 * mobile drawer, the bottom tab bar, the active-workspace derivation and the
 * navigation tests all read from here, so a workspace can never exist in one
 * surface and be missing from another.
 *
 * Hues are tokens from `index.css` (`--ws-*`), never raw palette values: the
 * accent identifies a workspace, it does not carry status.
 */
export type WorkspaceId =
  | "personal"
  | "shipments"
  | "ticketing"
  | "business"
  | "services"
  | "marketplace";

export type AccentClasses = {
  /** The 6px identity dot. Decorative only. */
  dot: string;
  /** Icon colour when the workspace is active. */
  text: string;
  /** 10% background tint when the workspace is active. */
  tint: string;
  /** 3px left bar when the workspace is active. */
  bar: string;
};

export type Workspace = {
  id: WorkspaceId;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Route prefixes owned by this workspace. Longest match wins. */
  match: string[];
  accent: AccentClasses;
};

export const WORKSPACES: Workspace[] = [
  {
    id: "personal",
    label: "Personal",
    href: "/app",
    icon: User,
    match: [
      "/app",
      "/dashboard",
      "/personal",
      "/wallet",
      "/buy-points",
      "/transactions",
      "/notifications",
      "/settings",
      "/support",
      "/referrals",
      "/documents",
      "/billing",
      "/ledger",
    ],
    accent: {
      dot: "bg-ws-personal",
      text: "text-ws-personal",
      tint: "bg-ws-personal/10",
      bar: "bg-ws-personal",
    },
  },
  {
    id: "shipments",
    label: "Shipments",
    href: "/app/shipments",
    icon: Truck,
    match: ["/app/shipments", "/shipments"],
    accent: {
      dot: "bg-ws-shipments",
      text: "text-ws-shipments",
      tint: "bg-ws-shipments/10",
      bar: "bg-ws-shipments",
    },
  },
  {
    id: "ticketing",
    label: "Ticketing",
    href: "/ticketing",
    icon: Ticket,
    match: ["/ticketing"],
    accent: {
      dot: "bg-ws-ticketing",
      text: "text-ws-ticketing",
      tint: "bg-ws-ticketing/10",
      bar: "bg-ws-ticketing",
    },
  },
  {
    id: "business",
    label: "Business Suite",
    href: "/app/business",
    icon: Building2,
    match: ["/app/business", "/business"],
    accent: {
      dot: "bg-ws-business",
      text: "text-ws-business",
      tint: "bg-ws-business/10",
      bar: "bg-ws-business",
    },
  },
  {
    id: "services",
    label: "Services",
    href: "/services",
    icon: Layers,
    match: ["/app/services", "/services", "/vtu"],
    accent: {
      dot: "bg-ws-services",
      text: "text-ws-services",
      tint: "bg-ws-services/10",
      bar: "bg-ws-services",
    },
  },
  {
    id: "marketplace",
    label: "Marketplace",
    href: "/app/marketplace",
    icon: Store,
    match: ["/app/marketplace", "/app/vendor", "/marketplace", "/orders"],
    accent: {
      dot: "bg-ws-marketplace",
      text: "text-ws-marketplace",
      tint: "bg-ws-marketplace/10",
      bar: "bg-ws-marketplace",
    },
  },
];

/** The five thumb-reachable journeys. Business Suite lives in the drawer. */
export const BOTTOM_TAB_IDS: WorkspaceId[] = [
  "personal",
  "shipments",
  "ticketing",
  "services",
  "marketplace",
];

export const BOTTOM_TABS: Workspace[] = BOTTOM_TAB_IDS.map(
  (id) => WORKSPACES.find((workspace) => workspace.id === id)!,
);

export type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const SECONDARY_LINKS: NavLink[] = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Help", href: "/support", icon: LifeBuoy },
];

export const ADMIN_LINK: NavLink = { label: "Admin", href: "/admin", icon: Shield };

/** localStorage key for the desktop rail preference. */
export const NAV_COLLAPSE_KEY = "cloudie.nav.collapsed";

/** The admin accent is red so it never reads as another workspace. */
export const ADMIN_ACCENT: AccentClasses = {
  dot: "bg-ws-admin",
  text: "text-ws-admin",
  tint: "bg-ws-admin/10",
  bar: "bg-ws-admin",
};

/** `NeonUser.role` is lower-case; legacy Convex rows use upper-case. */
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").toLowerCase() === "admin";
}
