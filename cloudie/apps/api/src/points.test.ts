import { describe, expect, it } from "vitest";
import { POINTS_COST } from "@cloudie/config/points";
describe("billable action costs", () => {
  it("uses the specified cost schedule", () => { expect(POINTS_COST).toEqual({ SHIPMENT_CREATE: 10, SHIPMENT_TRACK_UPDATE: 2, PDF_GENERATE: 15, EMAIL_SEND: 1, IMAGE_RENDER: 3, TENANT_MONTHLY: 200 }); });
  it("contains only positive safe integer costs", () => { for (const value of Object.values(POINTS_COST)) expect(Number.isSafeInteger(value) && value > 0).toBe(true); });
});
