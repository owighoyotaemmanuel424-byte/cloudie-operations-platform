/**
 * Cloudie Platform — shared domain model.
 *
 * Mirrors the architecture specification: five customer workspaces drawing on
 * a single points ledger, with resource ownership enforced at the service
 * layer (see `engine.ts`).
 */

export type Workspace = "personal" | "shipments" | "ticketing" | "business" | "services";

export const WORKSPACES: {
  id: Workspace;
  label: string;
  tagline: string;
  description: string;
  route: string;
}[] = [
  {
    id: "personal",
    label: "Personal",
    tagline: "Balance & marketplace",
    description: "Points balance, transaction ledger, vendor marketplace, live order chat and referrals.",
    route: "/app/personal",
  },
  {
    id: "shipments",
    label: "Shipments",
    tagline: "Create & track",
    description: "One-form shipment creation, live parcel status tracking and public tracking links.",
    route: "/app/shipments",
  },
  {
    id: "ticketing",
    label: "Ticketing",
    tagline: "Travel documents",
    description: "Flight and hotel booking manager, invoice composer and print-ready receipts.",
    route: "/app/ticketing",
  },
  {
    id: "business",
    label: "Business Suite",
    tagline: "Tenant portals",
    description: "Deploy customer banking and investment portals, configure KYC and manage portal users.",
    route: "/app/business",
  },
  {
    id: "services",
    label: "Services",
    tagline: "Outreach & studio",
    description: "Template-based email campaigns, send-log monitoring and the graphics rendering studio.",
    route: "/app/services",
  },
];

export type Role = "customer" | "admin";

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  points: number;
  referralCode: string;
  referredBy: string | null;
  phone: string | null;
  createdAt: number;
};

export type Session = {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export type LedgerType = "credit" | "debit" | "refund" | "bonus";

export type LedgerEntry = {
  id: string;
  userId: string;
  type: LedgerType;
  points: number; // signed
  balanceAfter: number;
  reason: string;
  workspace: Workspace;
  reference: string | null;
  createdAt: number;
};

export type ShipmentStatus =
  | "registered"
  | "in_transit"
  | "customs"
  | "out_for_delivery"
  | "delivered"
  | "on_hold";

export const SHIPMENT_STEPS: { id: ShipmentStatus; label: string }[] = [
  { id: "registered", label: "Registered" },
  { id: "in_transit", label: "In transit" },
  { id: "customs", label: "Customs clearance" },
  { id: "out_for_delivery", label: "Out for delivery" },
  { id: "delivered", label: "Delivered" },
];

export type ShipmentEvent = {
  id: string;
  status: ShipmentStatus;
  label: string;
  location: string;
  note: string | null;
  at: number;
};

export type Shipment = {
  id: string;
  code: string;
  publicToken: string;
  userId: string;
  service: "express" | "economy" | "freight";
  origin: string;
  destination: string;
  recipientName: string;
  recipientPhone: string;
  contents: string;
  weightKg: number;
  declaredValue: number;
  costPoints: number;
  status: ShipmentStatus;
  createdAt: number;
  events: ShipmentEvent[];
};

export type DocumentKind = "flight" | "hotel" | "invoice" | "customs" | "receipt";

export type TravelDocument = {
  id: string;
  publicToken: string;
  userId: string;
  kind: DocumentKind;
  title: string;
  passenger: string;
  reference: string;
  lines: { label: string; value: string }[];
  total: number | null;
  currency: string;
  pointsCharged: number;
  createdAt: number;
};

export type Campaign = {
  id: string;
  userId: string;
  template: string;
  subject: string;
  body: string;
  recipients: string[];
  pointsCharged: number;
  status: "sent" | "queued" | "failed" | "partial";
  sentAt: number;
  opens: number;
  deliveryState?: "queued" | "sending" | "sent" | "partial" | "failed" | "skipped";
  sentCount?: number;
  failedCount?: number;
  deliveryError?: string | null;
};

export type SitePlan = "starter" | "growth" | "scale";

export type TenantPortalUser = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff" | "viewer";
  invitedAt: number;
};

export type TenantSite = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  plan: SitePlan;
  status: "live" | "pending_renewal" | "suspended";
  kycRequired: boolean;
  kycLevel: "basic" | "enhanced";
  bankingEnabled: boolean;
  investmentEnabled: boolean;
  renewalPoints: number;
  renewsAt: number;
  users: TenantPortalUser[];
  createdAt: number;
};

export type PointPack = {
  id: string;
  label: string;
  points: number;
  priceNgn: number;
  bonus: number;
  crypto: string;
};

export const POINT_PACKS: PointPack[] = [
  { id: "pack-1", label: "Depot", points: 1000, priceNgn: 12000, bonus: 0, crypto: "USDT" },
  { id: "pack-2", label: "Waybill", points: 2500, priceNgn: 28000, bonus: 150, crypto: "USDT" },
  { id: "pack-3", label: "Consignment", points: 6000, priceNgn: 64000, bonus: 600, crypto: "BTC" },
  { id: "pack-4", label: "Fleet", points: 15000, priceNgn: 150000, bonus: 2250, crypto: "ETH" },
];

export type Listing = {
  id: string;
  vendor: string;
  title: string;
  detail: string;
  points: number;
  tag: string;
  rating: number;
};

export const MARKETPLACE_LISTINGS: Listing[] = [
  {
    id: "lst-1",
    vendor: "Lekki Freight Co.",
    title: "Lagos → Accra freight slot",
    detail: "40ft shared container, 3-day clearance window",
    points: 2400,
    tag: "Freight",
    rating: 4.8,
  },
  {
    id: "lst-2",
    vendor: "Kano Print House",
    title: "Waybill booklet · 200 pages",
    detail: "Carbonless 3-ply, branded with your logo",
    points: 640,
    tag: "Print",
    rating: 4.6,
  },
  {
    id: "lst-3",
    vendor: "AeroDesk",
    title: "Same-day courier retainer",
    detail: "25 pickups inside Lagos mainland",
    points: 1500,
    tag: "Courier",
    rating: 4.9,
  },
  {
    id: "lst-4",
    vendor: "Studio Mono",
    title: "Campaign artwork pack",
    detail: "Five email headers, two social kits",
    points: 380,
    tag: "Design",
    rating: 4.7,
  },
];

export type OrderStatus = "vendor_contacted" | "in_progress" | "delivered";

export type Order = {
  id: string;
  userId: string;
  listingId: string;
  vendor: string;
  title: string;
  points: number;
  status: OrderStatus;
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  orderId: string;
  from: "customer" | "vendor";
  body: string;
  at: number;
};

export type Notification = {
  id: string;
  userId: string;
  workspace: Workspace;
  title: string;
  body: string;
  read: boolean;
  at: number;
};

export type Settings = {
  brandName: string;
  supportEmail: string;
  usdRate: number; // naira per USD, display only
};

export type EventBusMessage = {
  id: string;
  channel: "ledger" | "shipment" | "document" | "business" | "services" | "chat";
  summary: string;
  at: number;
};
