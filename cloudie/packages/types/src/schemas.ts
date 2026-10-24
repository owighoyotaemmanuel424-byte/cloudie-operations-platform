import { z } from "zod";
export const workspaceTypeSchema = z.enum(["PERSONAL", "SHIPMENTS", "TICKETING", "BUSINESS", "SERVICES"]);
export const ledgerChargeSchema = z.object({ action: z.enum(["SHIPMENT_CREATE", "SHIPMENT_TRACK_UPDATE", "PDF_GENERATE", "EMAIL_SEND", "IMAGE_RENDER", "TENANT_MONTHLY"]), description: z.string().trim().min(3).max(240), workspace: workspaceTypeSchema.optional(), metadata: z.record(z.unknown()).optional() });
export const shipmentCreateSchema = z.object({ senderInfo: z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(400), phone: z.string().trim().min(5).max(30) }), recipientInfo: z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(400), phone: z.string().trim().min(5).max(30) }) });
export const adminReasonSchema = z.object({ reason: z.string().trim().min(10).max(500) });
export const cryptoDepositRequestSchema = z.object({ currency: z.enum(["BTC", "ETH", "USDT"]), idempotencyKey: z.string().trim().min(16).max(128) });
export type LedgerChargeRequest = z.infer<typeof ledgerChargeSchema>;
export type ShipmentCreateRequest = z.infer<typeof shipmentCreateSchema>;
