// P1 regression: an audit-trail outage must never render as "no records".
//
// The failure used to be disguised twice — the API answered `{ logs: [] }` with
// a 200, and the shim swallowed the rejection into `{ logs: [] }` — so an
// administrator looking at the page during an outage was told the trail was
// empty. The three states are: `undefined` loading, `null` unavailable,
// array = real records.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { useQuery } from "@/lib/neonClient";

const originalFetch = globalThis.fetch;

let auditRequest: { status: number; body: unknown };

beforeEach(() => {
  auditRequest = { status: 200, body: { logs: [] } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/audit-logs")) {
      return new Response(JSON.stringify(auditRequest.body), {
        status: auditRequest.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function AuditProbe() {
  const logs = useQuery("admin:getAuditLogs", { limit: 100 });
  if (logs === undefined) return <p>loading</p>;
  if (logs === null) return <p>unavailable</p>;
  return <p>{`records:${logs.length}`}</p>;
}

describe("audit log read state", () => {
  test("a failed read resolves to unavailable, not to an empty list", async () => {
    auditRequest = { status: 503, body: { error: "Audit log storage is unavailable" } };

    render(<AuditProbe />);

    expect(await screen.findByText("unavailable")).toBeTruthy();
    expect(screen.queryByText("records:0")).toBeNull();
    expect(screen.queryByText("loading")).toBeNull();
  });

  test("a successful read still resolves to the records", async () => {
    auditRequest = {
      status: 200,
      body: { logs: [{ id: "a1", action: "USER_SUSPENDED" }, { id: "a2", action: "VENDOR_APPROVED" }] },
    };

    render(<AuditProbe />);

    expect(await screen.findByText("records:2")).toBeTruthy();
  });
});

/* ── Page rendering: outage copy vs genuinely-empty copy ─────────────────── */

type PageLogs = Array<Record<string, unknown>> | null | undefined;
let pageLogs: PageLogs;

mock.module("convex/react", () => ({
  useQuery: () => pageLogs,
}));

const { default: AdminAuditLogs } = await import("@/pages/AdminAuditLogs");

const OUTAGE_COPY = "Audit log storage is unavailable";
const EMPTY_COPY = "No audit records match your filters.";

describe("audit log page states", () => {
  test("an outage shows the outage notice instead of an empty trail", async () => {
    pageLogs = null;
    render(<AdminAuditLogs />);

    expect(await screen.findByText(OUTAGE_COPY)).toBeTruthy();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  test("a genuinely empty trail still shows the empty state", async () => {
    pageLogs = [];
    render(<AdminAuditLogs />);

    expect(await screen.findByText(EMPTY_COPY)).toBeTruthy();
    expect(screen.queryByText(OUTAGE_COPY)).toBeNull();
  });
});
