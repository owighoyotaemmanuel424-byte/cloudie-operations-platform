/**
 * Reaching the signed-in dashboard — the join across four files that no
 * compiler checks.
 *
 * WHY THIS EXISTS. The landing page is public and `/dashboard` is not, so the
 * path from one to the other is a chain of independent decisions:
 *
 *   Landing.tsx   the visitor is offered a link to `/dashboard` at all
 *   main.tsx      `/dashboard` is registered INSIDE the `RequireAuth` layout
 *   RequireAuth   a signed-out visitor is sent to `/login?returnTo=<intended>`
 *   Auth.tsx      the `returnTo` is honoured after sign-in, and the fallback
 *                 (used when there is no returnTo) is the dashboard too
 *
 * Every link in that chain fails silently and independently. A landing page
 * whose only call to action is `/auth` strands a signed-in user on a sign-in
 * form; a dashboard route declared outside `RequireAuth` renders the workspace
 * to anybody; a renamed `returnTo` parameter or a fallback that points at the
 * landing page turns "sign in" into a loop back to the marketing site. Nothing
 * at runtime compares them, so each is pinned here against the real sources —
 * the same source-level style as `vtuNavigation.test.ts`.
 *
 * The one genuinely behavioural assertion is the redirect resolver, which is
 * lifted out of `Auth.tsx` and executed, so the `//host` and `http://` guards
 * are tested rather than described.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const LANDING_PATH = "src/pages/Landing.tsx";
const ENTRY_PATH = "src/main.tsx";
const GUARD_PATH = "src/components/RequireAuth.tsx";
const AUTH_PATH = "src/pages/Auth.tsx";

const landing = readFileSync(LANDING_PATH, "utf8");
const entry = readFileSync(ENTRY_PATH, "utf8");
const guard = readFileSync(GUARD_PATH, "utf8");
const auth = readFileSync(AUTH_PATH, "utf8");

/** Every occurrence of `needle`, so counts can be asserted rather than guessed. */
function count(source: string, needle: string): number {
  let total = 0;
  let at = source.indexOf(needle);
  while (at !== -1) {
    total++;
    at = source.indexOf(needle, at + needle.length);
  }
  return total;
}

/**
 * `resolveRedirectAfterAuth` as shipped, with the TypeScript parameter
 * annotation stripped so the body can run unchanged in a JavaScript harness.
 */
const resolveRedirectAfterAuth = (() => {
  const marker = "function resolveRedirectAfterAuth(";
  const start = auth.indexOf(marker);
  if (start === -1) {
    throw new Error(`${AUTH_PATH} no longer defines resolveRedirectAfterAuth`);
  }
  const end = auth.indexOf("\n}\n", start);
  if (end === -1) {
    throw new Error(`${AUTH_PATH} resolveRedirectAfterAuth is malformed`);
  }
  const body = auth
    .slice(start, end + 3)
    .replace("returnTo: string | null,", "returnTo,");
  return new Function(`${body}\nreturn resolveRedirectAfterAuth;`)() as (
    returnTo: string | null,
    fallback?: string,
  ) => string;
})();

describe("landing page offers a direct route into the dashboard", () => {
  test("links to /dashboard, not only to /auth", () => {
    expect(count(landing, 'to="/dashboard"')).toBeGreaterThanOrEqual(2);
  });

  test("the dashboard link is present in both the desktop and mobile headers", () => {
    // The desktop row is hidden below `lg`; the chip strip is the only header
    // navigation a phone sees. Offering the dashboard in one and not the other
    // repeats the mobile-blind-spot bug the VTU nav guard exists to prevent.
    const desktopNav = landing.indexOf('aria-label="Page sections"');
    const mobileStrip = landing.indexOf("lg:hidden");
    expect(desktopNav).toBeGreaterThan(-1);
    expect(mobileStrip).toBeGreaterThan(-1);
    const desktopBlock = landing.slice(desktopNav, mobileStrip);
    const mobileBlock = landing.slice(
      mobileStrip,
      landing.indexOf("</header>"),
    );
    expect(desktopBlock).toContain('to="/dashboard"');
    expect(mobileBlock).toContain('to="/dashboard"');
  });

  test("the hero call to action reaches the dashboard", () => {
    const hero = landing.slice(
      landing.indexOf("{/* Hero */}"),
      landing.indexOf("{/* Stats */}"),
    );
    expect(hero).toContain('to="/dashboard"');
  });

  test("the footer lists it as well", () => {
    expect(landing).toContain(
      '{ label: "Open dashboard", href: "/dashboard" }',
    );
  });
});

describe("/dashboard resolves to the real, guarded route", () => {
  test("the customer route table is wrapped in RequireAuth", () => {
    const layout = entry.indexOf(
      "<Route element={<RequireAuth><AppShell /></RequireAuth>}>",
    );
    expect(layout).toBeGreaterThan(-1);

    // Everything the layout wraps lives between it and the admin tree.
    const adminStart = entry.indexOf("{/* Admin routes");
    expect(adminStart).toBeGreaterThan(layout);
    const customerRoutes = entry.slice(layout, adminStart);

    expect(customerRoutes).toContain('path="/dashboard"');
    expect(customerRoutes).toContain("<Dashboard />");
  });

  test("RequireAuth runs before the app shell, never the other way round", () => {
    expect(entry).toContain("<RequireAuth><AppShell /></RequireAuth>");
    expect(
      entry.indexOf("<RequireAuth><AppShell /></RequireAuth>"),
    ).toBeLessThan(entry.indexOf("<Dashboard />"));
  });
});

describe("a signed-out visitor is returned to the dashboard after signing in", () => {
  test("RequireAuth parks the intended path in returnTo", () => {
    expect(guard).toContain(
      "const returnTo = `${location.pathname}${location.search}`;",
    );
    // `/login` is the canonical sign-in route; `/auth` remains a legacy alias.
    // Both honour returnTo, but the guard must send visitors to `/login`.
    expect(guard).toContain(
      "to={`/login?returnTo=${encodeURIComponent(returnTo)}`}",
    );
  });

  test("the redirect waits for auth to settle", () => {
    // Three states: the pending state is handled before either verdict.
    const loading = guard.indexOf('if (status === "loading")');
    const redirect = guard.indexOf('if (status === "anon")');
    expect(loading).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(loading);
  });

  test("the /auth route's own fallback is the dashboard, not the landing page", () => {
    expect(entry).toContain(
      '<Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />',
    );
  });

  test("Auth.tsx navigates to the resolved destination", () => {
    // One navigate for the already-signed-in visitor, one after a successful
    // sign-in. Dropping either strands the user on the form.
    expect(
      count(auth, "navigate(redirect, { replace: true })"),
    ).toBeGreaterThanOrEqual(2);
    expect(auth).toContain(
      'if (!authLoading && isAuthenticated && mode !== "forgot")',
    );
  });

  test("clicking the dashboard while signed out makes the round trip", () => {
    // What RequireAuth builds for `/dashboard`…
    const intended = "/dashboard";
    const search = `/auth?returnTo=${encodeURIComponent(intended)}`;
    // …what the auth page reads back out of it…
    const returnTo = new URL(search, "https://example.test").searchParams.get(
      "returnTo",
    );
    // …and where it lands. Both the remembered path and the no-returnTo
    // fallback must be the dashboard.
    expect(resolveRedirectAfterAuth(returnTo, "/dashboard")).toBe("/dashboard");
    expect(resolveRedirectAfterAuth(null, "/dashboard")).toBe("/dashboard");
  });

  test("the returnTo is not an open redirect", () => {
    expect(resolveRedirectAfterAuth("//evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(resolveRedirectAfterAuth("https://evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(resolveRedirectAfterAuth("/vtu/airtime", "/dashboard")).toBe(
      "/vtu/airtime",
    );
  });
});
