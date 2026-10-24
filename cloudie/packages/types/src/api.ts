export type ApiErrorCode = "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "INSUFFICIENT_POINTS" | "IDEMPOTENCY_CONFLICT" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";
export type ApiError = { error: { code: ApiErrorCode; message: string; requestId?: string } };
export type ApiSuccess<T> = { data: T };
export type PointsUpdateEvent = { balance: number; delta: number; description: string; ledgerId: string };
export type ShipmentUpdateEvent = { trackingNumber: string; status: string; event: { location?: string; note?: string; occurredAt: string } };
