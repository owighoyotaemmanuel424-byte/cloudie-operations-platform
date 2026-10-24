// Bun's runner with happy-dom registered by src/__tests__/setup.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionProvider, signOutSession } from "@/hooks/useSession";
import { AppShell } from "../AppShell";

const USER = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "user" as const,
};

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(options: { role?: string; meStatus?: number } = {}) {
  calls = [];
  const role = options.role ?? "user";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/me")) {
      if (options.meStatus && options.meStatus !== 200) {
        return jsonResponse({ error: "Authentication required" }, options.meStatus);
      }
      return jsonResponse({ user: { ...USER, role } });
    }
    if (url.includes("/api/auth/csrf")) return new Response(null, { status: 204 });
    if (url.includes("/api/auth/logout")) return jsonResponse({ ok: true });
    return jsonResponse({});
  }) as unknown as typeof fetch;
}

const meCalls = () => calls.filter((call) => call.url.endsWith("/api/me")).length;
const logoutCalls = () => calls.filter((call) => call.url.includes("/api/auth/logout")).length;

function seedSession() {
  sessionStorage.setItem("cloudie_api_token", "test-bearer-token");
  sessionStorage.setItem("cloudie_api_user", JSON.stringify(USER));
}

function renderShell(path: string) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/app" element={<div>personal content</div>} />
            <Route path="/app/shipments" element={<div>shipments content</div>} />
            <Route path="/app/shipments/:id" element={<div>shipment detail content</div>} />
            <Route path="/app/marketplace" element={<div>marketplace content</div>} />
            <Route path="*" element={<div>page content</div>} />
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  document.cookie = "cloudie_csrf=; Max-Age=0; path=/";
  installFetch();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("navigation shell", () => {
  test("keeps the session across drawer open/close and two workspace changes", async () => {
    seedSession();
    const user = userEvent.setup();
    renderShell("/app");

    await screen.findByText("personal content");
    expect(meCalls()).toBe(1);

    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("link", { name: "Shipments" }));
    await screen.findByText("shipments content");

    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    const secondDrawer = await screen.findByRole("dialog");
    await user.click(within(secondDrawer).getByRole("link", { name: "Marketplace" }));
    await screen.findByText("marketplace content");

    await user.keyboard("{Escape}");

    // Not one extra session read, and never a bounce to /login.
    expect(meCalls()).toBe(1);
    expect(screen.queryByText("login page")).toBeNull();
    expect(logoutCalls()).toBe(0);
  });

  test("derives the active workspace from a deep link on first render", async () => {
    seedSession();
    renderShell("/app/shipments/abc");

    await screen.findByText("shipment detail content");

    const shipmentLinks = screen.getAllByRole("link", { name: "Shipments" });
    expect(shipmentLinks.length).toBeGreaterThan(0);
    for (const link of shipmentLinks) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }

    const personalLinks = screen.getAllByRole("link", { name: "Personal" });
    for (const link of personalLinks) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  test("hides the admin link from non-admins and shows it to admins", async () => {
    seedSession();
    installFetch({ role: "user" });
    const view = renderShell("/app");
    await screen.findByText("personal content");
    expect(screen.queryByRole("link", { name: /admin/i })).toBeNull();
    view.unmount();
    cleanup();

    installFetch({ role: "admin" });
    renderShell("/app");
    await screen.findByText("personal content");
    expect(screen.getByRole("link", { name: /admin/i })).toBeTruthy();
  });

  test("sign out is the only nav control that ends a session", async () => {
    seedSession();
    const user = userEvent.setup();
    renderShell("/app");
    await screen.findByText("personal content");

    const primary = screen.getByRole("navigation", { name: "Primary" });
    for (const link of within(primary).getAllByRole("link")) {
      await user.click(link);
    }

    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    await user.keyboard("{Escape}");

    // The test viewport is 1024px, below the 1280px auto-collapse threshold, so
    // the rail is an icon rail and the manual toggle is withheld entirely.
    expect(screen.queryByRole("button", { name: /collapse sidebar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /expand sidebar/i })).toBeNull();

    expect(logoutCalls()).toBe(0);
    expect(screen.queryByText("login page")).toBeNull();
  });

  test("the logout request carries the Neon CSRF header", async () => {
    seedSession();
    document.cookie = "cloudie_csrf=csrf-test-token; path=/";

    const result = await signOutSession();
    expect(result.ok).toBe(true);

    const logout = calls.find((call) => call.url.includes("/api/auth/logout"));
    expect(logout).toBeTruthy();
    const headers = new Headers(logout!.init?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test-token");
    expect(logout!.init?.method).toBe("POST");
  });

  test("the account menu sign out reaches /login and reports the request", async () => {
    seedSession();
    const user = userEvent.setup();
    renderShell("/app");
    await screen.findByText("personal content");

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    const signOut = await screen.findByRole("menuitem", { name: /sign out/i });
    await user.click(signOut);

    await screen.findByText("login page");
    expect(logoutCalls()).toBe(1);
  });

  test("never prints naira and points in the same text node", async () => {
    seedSession();
    renderShell("/app");
    await screen.findByText("personal content");

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const violations: string[] = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.textContent ?? "";
      if (value.includes("₦") && /point/i.test(value)) violations.push(value);
    }
    expect(violations).toEqual([]);
  });

  test("holds a skeleton while the session is unresolved instead of redirecting", async () => {
    // Token but no cached user: the shell must wait, not bounce to /login.
    sessionStorage.setItem("cloudie_api_token", "test-bearer-token");
    renderShell("/app");

    expect(screen.getByText(/loading your workspace/i)).toBeTruthy();
    expect(screen.queryByText("login page")).toBeNull();

    await waitFor(() => expect(screen.getByText("personal content")).toBeTruthy());
  });
});
