// The admin screens are written against `adminApi.adminDashboard`'s nested
// shape (`users.active`, `points.velocity24h`, `kyc.pending`, …). The Neon
// reports endpoint returns a flat counter payload, and the shim maps one onto
// the other. When that mapping loses a field the render crashes with
// "undefined is not an object (evaluating 'users.active.toLocaleString')", so
// this test walks the fields the dashboard actually formats.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { useQuery } from "@/lib/neonClient";

const originalFetch = globalThis.fetch;

const reports = {
  totalUsers: 12,
  users: 12,
  activeUsers: 9,
  suspendedUsers: 1,
  totalShipments: 7,
  shipments: 7,
  totalOrders: 4,
  orders: 4,
  pendingShipments: 2,
  tenants: 3,
  walletBalanceNgn: 250000,
};

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/admin/reports") ? reports : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function DashboardProbe() {
  const data = useQuery("adminApi:adminDashboard");
  if (data === undefined) return <p>loading</p>;
  return (
    <dl>
      <dd data-testid="users-total">{data.users.total.toLocaleString()}</dd>
      <dd data-testid="users-active">{data.users.active.toLocaleString()}</dd>
      <dd data-testid="users-suspended">{data.users.suspended.toLocaleString()}</dd>
      <dd data-testid="users-admins">{data.users.admins.toLocaleString()}</dd>
      <dd data-testid="points-velocity">{data.points.velocity24h.toLocaleString()}</dd>
      <dd data-testid="shipments-delivered">{data.shipments.delivered.toLocaleString()}</dd>
      <dd data-testid="orders-escrow">{data.marketplace.escrowPending.toLocaleString()}</dd>
      <dd data-testid="kyc-pending">{data.kyc.pending.toLocaleString()}</dd>
      <dd data-testid="tenants-locked">{data.tenants.locked.toLocaleString()}</dd>
      <dd data-testid="activity-ledger">{data.activity.ledger7d.toLocaleString()}</dd>
    </dl>
  );
}

function RiskProbe() {
  const risk = useQuery("adminApi:getFinancialRisk", { hours: 24, limit: 5 });
  if (risk === undefined) return <p>loading risk</p>;
  return <p data-testid="risk">{`${risk.alerts.length} alerts, ${risk.scannedTransactions} scanned`}</p>;
}

describe("admin dashboard shim", () => {
  test("every field the dashboard formats is present and numeric", async () => {
    render(<DashboardProbe />);

    expect((await screen.findByTestId("users-total")).textContent).toBe("12");
    expect(screen.getByTestId("users-active").textContent).toBe("9");
    expect(screen.getByTestId("users-suspended").textContent).toBe("1");
    // Fields the Neon reports endpoint does not supply still render as numbers.
    expect(screen.getByTestId("users-admins").textContent).toBe("0");
    expect(screen.getByTestId("points-velocity").textContent).toBe("0");
    expect(screen.getByTestId("shipments-delivered").textContent).toBe("0");
    expect(screen.getByTestId("orders-escrow").textContent).toBe("0");
    expect(screen.getByTestId("kyc-pending").textContent).toBe("0");
    expect(screen.getByTestId("tenants-locked").textContent).toBe("0");
    expect(screen.getByTestId("activity-ledger").textContent).toBe("0");
  });

  test("the financial risk card receives alerts and a scan count", async () => {
    render(<RiskProbe />);
    expect((await screen.findByTestId("risk")).textContent).toBe("0 alerts, 0 scanned");
  });
});

/**
 * The reports endpoint used to fabricate metrics: it reported total users as
 * the active count and hard-coded suspended users to zero. The API now counts
 * each metric from its own predicate, so an admin must never see the whole user
 * base described as active, and a real suspended count must not be masked.
 */
describe("admin dashboard metric accuracy", () => {
  test("active is never inferred from the total user count", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          totalUsers: 40,
          activeUsers: 25,
          suspendedUsers: 11,
          terminatedUsers: 4,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      render(<DashboardProbe />);
      expect((await screen.findByTestId("users-total")).textContent).toBe("40");
      expect(screen.getByTestId("users-active").textContent).toBe("25");
      expect(screen.getByTestId("users-suspended").textContent).toBe("11");
    } finally {
      globalThis.fetch = previous;
      cleanup();
    }
  });

  test("a missing active count does not fall back to the total", async () => {
    const previous = globalThis.fetch;
    // Legacy payload: only a total. Active must not silently become the total.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ totalUsers: 40 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      render(<DashboardProbe />);
      expect((await screen.findByTestId("users-total")).textContent).toBe("40");
      expect(screen.getByTestId("users-active").textContent).toBe("0");
    } finally {
      globalThis.fetch = previous;
      cleanup();
    }
  });
});
