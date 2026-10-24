import { describe, expect, it } from "vitest";
import { POINTS_COST } from "@cloudie/config/points";

describe("point costs", () => {
  it("keeps every billable action positive and integer-valued", () => {
    for (const cost of Object.values(POINTS_COST)) expect(Number.isSafeInteger(cost) && cost > 0).toBe(true);
  });
  it("matches the published cost schedule", () => {
    expect(POINTS_COST).toEqual({ SHIPMENT_CREATE: 10, SHIPMENT_TRACK_UPDATE: 2, PDF_GENERATE: 15, EMAIL_SEND: 1, IMAGE_RENDER: 3, TENANT_MONTHLY: 200 });
  });
});
