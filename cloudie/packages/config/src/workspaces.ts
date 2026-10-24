export const WORKSPACES = [
  { id: "PERSONAL", label: "Personal", href: "/app/personal" },
  { id: "SHIPMENTS", label: "Shipments", href: "/app/shipments" },
  { id: "TICKETING", label: "Ticketing", href: "/app/ticketing" },
  { id: "BUSINESS", label: "Business Suite", href: "/app/business" },
  { id: "SERVICES", label: "Services", href: "/app/services" },
] as const;

export type WorkspaceId = (typeof WORKSPACES)[number]["id"];
