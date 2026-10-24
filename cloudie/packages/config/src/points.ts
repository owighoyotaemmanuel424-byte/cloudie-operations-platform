import type { WorkspaceId } from "./workspaces.js";

export const POINTS_COST = {
  SHIPMENT_CREATE: 10,
  SHIPMENT_TRACK_UPDATE: 2,
  PDF_GENERATE: 15,
  EMAIL_SEND: 1,
  IMAGE_RENDER: 3,
  TENANT_MONTHLY: 200,
} as const;

export type BillableAction = keyof typeof POINTS_COST;
export const ACTION_WORKSPACE: Record<BillableAction, WorkspaceId> = {
  SHIPMENT_CREATE: "SHIPMENTS",
  SHIPMENT_TRACK_UPDATE: "SHIPMENTS",
  PDF_GENERATE: "TICKETING",
  EMAIL_SEND: "SERVICES",
  IMAGE_RENDER: "SERVICES",
  TENANT_MONTHLY: "BUSINESS",
};
