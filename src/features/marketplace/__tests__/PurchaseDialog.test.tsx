// Bun's built-in test runner with happy-dom registered by src/__tests__/setup.ts.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { fmtNaira, fmtPoints, naira, points } from "@/components/money/FundsGate";
import { PurchaseDialog } from "../PurchaseDialog";
import type { MarketplaceOrder, MarketplaceOrderDraft } from "../orderState";

const draft: MarketplaceOrderDraft = {
  productId: "package-1",
  productName: "Starter points bundle",
  vendorName: "Verified Vendor",
  quantity: 1,
  price: naira(450000),
  pointsReward: points(5000),
  walletBefore: naira(1000000),
  walletAfter: naira(550000),
};

function makeOrder(status: MarketplaceOrder["status"]): MarketplaceOrder {
  if (status === "review") return { status, draft };
  if (status === "pending") return { status, reference: "order-abc123", draft };
  if (status === "success") return { status, reference: "order-abc123", draft, pointsCredited: points(5000), walletAfter: naira(550000) };
  if (status === "failed") return { status, reference: "order-abc123", draft, reason: "Insufficient wallet balance.", charged: false };
  return { status: "failed_ambiguous", reference: "order-abc123", draft, reason: "Delivery is still being confirmed." };
}

function renderDialog(status: MarketplaceOrder["status"]) {
  const onOpenChange = mock((_open: boolean) => {});
  const onConfirm = mock(() => {});
  const onRetry = mock(() => {});
  const onRefresh = mock(() => {});
  const onContactSupport = mock((_reference: string) => {});
  const view = render(
    <PurchaseDialog
      open
      order={makeOrder(status)}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onRetry={onRetry}
      onRefresh={onRefresh}
      onContactSupport={onContactSupport}
    />,
  );
  return { ...view, onOpenChange, onConfirm, onRetry, onRefresh, onContactSupport };
}

function expectNoMixedCurrencyAndPoints(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const violations: string[] = [];
  while (walker.nextNode()) {
    const value = walker.currentNode.textContent ?? "";
    const hasNaira = value.includes("₦");
    const hasPoints = /point/i.test(value);
    if (hasNaira && hasPoints) violations.push(value);
  }
  expect(violations).toEqual([]);
}

describe("PurchaseDialog", () => {
  afterEach(() => cleanup());

  test("review shows package, vendor, typed currency values, and enabled confirmation", () => {
    renderDialog("review");
    expect(screen.getByText("Starter points bundle")).toBeTruthy();
    expect(screen.getByText("Vendor: Verified Vendor")).toBeTruthy();
    expect(fmtNaira(draft.price)).toBe("₦4,500.00");
    expect(fmtPoints(draft.pointsReward, { sign: true })).toBe("+5,000 points");
    expect(screen.getByText("₦4,500.00")).toBeTruthy();
    expect(screen.getByText("+5,000 points").classList.contains("text-success")).toBe(true);
    expect(screen.getByRole("button", { name: "Confirm purchase" }).hasAttribute("disabled")).toBe(false);
    expectNoMixedCurrencyAndPoints(document.body);
  });

  test("pending keeps the order reference monospaced, closes safely, and refreshes", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onRefresh } = renderDialog("pending");
    const reference = screen.getByText("order-abc123");
    expect(reference.classList.contains("font-mono")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close safely" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("success renders a receipt with paid amount, wallet balance, signed points, and no toast", () => {
    const { container } = renderDialog("success");
    expect(fmtNaira(draft.price)).toBe("₦4,500.00");
    expect(fmtPoints(points(5000), { sign: true })).toBe("+5,000 points");
    expect(screen.getAllByText("₦4,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦5,500.00").length).toBeGreaterThan(0);
    const credited = screen.getAllByText("+5,000 points");
    expect(credited.some((element: HTMLElement) => element.classList.contains("text-success"))).toBe(true);
    expect(screen.getByText("order-abc123")).toBeTruthy();
    expectNoMixedCurrencyAndPoints(container);
    expect(screen.queryByRole("status", { name: /success/i })).toBeNull();
  });

  test("failed explicitly confirms no charge and exposes retry and support reference", async () => {
    const user = userEvent.setup();
    const { onRetry } = renderDialog("failed");
    expect(screen.getByText("You were not charged.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Contact support.*order-abc123/i })).toBeTruthy();
  });

  test("ambiguous failure never claims no charge and explains delayed delivery", () => {
    renderDialog("failed_ambiguous");
    expect(screen.queryByText("You were not charged.")).toBeNull();
    expect(screen.getByText(/Your payment was received, but points delivery is delayed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Contact support.*order-abc123/i })).toBeTruthy();
  });

  test("dialog has an accessible name, receives focus, and closes on Escape", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog("review");
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
