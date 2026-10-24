import { createContext, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { bankTheme, bankThemeVars, type BankTheme } from "@/lib/tenantBankTheme";
import { Lock, LogOut, Mail } from "lucide-react";

/*
 * `BankTheme` is exported from the shared tenant design-kit helper so both
 * portal generations (this one and `/site/:siteId/*`) read a tenant's branding
 * identically. Everything below is styled from those values — no Cloudie
 * palette classes are used inside the tenant surface; the only Cloudie mark is
 * the muted footer.
 */

export type PortalData = NonNullable<FunctionReturnType<typeof api.tenantPortal.myPortal>>;

type PortalContextValue = {
  subdomain: string;
  data: PortalData;
  theme: BankTheme;
};

const PortalContext = createContext<PortalContextValue | null>(null);

export function usePortal(): PortalContextValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error("usePortal must be used inside TenantPortalShell");
  return value;
}

export function currencySymbol(currency: string) {
  switch (currency) {
    case "NGN":
      return "₦";
    case "GBP":
      return "£";
    case "EUR":
      return "€";
    case "USD":
    default:
      return "$";
  }
}

export function money(minor: number, currency: string) {
  return `${currencySymbol(currency)}${(minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function emptyStateVars(theme: BankTheme): CSSProperties {
  return bankThemeVars(theme);
}

/** The only Cloudie attribution allowed on a tenant surface. */
function PoweredBy() {
  return (
    <p className="mt-8 text-center text-[10px] font-medium tracking-wide text-[var(--t-muted)] opacity-55">
      Powered by Cloudie
    </p>
  );
}

function TenantMark({ logo, name, primary, radius }: { logo?: string | null; name: string; primary: string; radius: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden text-sm font-bold"
      style={{ background: primary, color: "#fff", borderRadius: radius }}
    >
      {logo ? (
        <img src={logo} alt={name} className="h-full w-full object-contain" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function TenantPortalShell({
  children,
  mode = "member",
}: {
  children: ReactNode;
  /** `member` pages redirect signed-out visitors to this tenant's login. */
  mode?: "public" | "member";
}) {
  const { subdomain = "" } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const data = useQuery(api.tenantPortal.myPortal, { subdomain });

  const theme = useMemo(
    () => bankTheme((data?.tenant.branding ?? null) as never),
    [data?.tenant.branding],
  );

  // Inject the tenant palette at the document root so the browser chrome,
  // overscroll and any portalled UI (dialogs) inherit the brand too.
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const fontFamily = data.tenant.fontFamily;
    const entries = Object.entries({
      ...bankThemeVars(theme),
      "--t-muted": theme.muted,
      "--primary": theme.primary,
      "--primary-foreground": "#ffffff",
      "--background": theme.surface,
      "--foreground": theme.text,
      "--card": theme.panel,
      "--card-foreground": theme.text,
      "--border": theme.border,
      "--input": theme.inputBg,
      "--ring": theme.primary,
      "--accent": theme.accent,
      "--radius": theme.radius,
      ...(fontFamily ? { "--font-sans": `"${fontFamily}", system-ui, sans-serif` } : {}),
    }) as [string, string][];
    const previous = entries.map(([key]) => [key, root.style.getPropertyValue(key)] as const);
    const previousColorScheme = root.style.colorScheme;
    const previousFontFamily = root.style.fontFamily;
    for (const [key, value] of entries) root.style.setProperty(key, value);
    root.style.colorScheme = theme.isDark ? "dark" : "light";
    if (fontFamily) root.style.fontFamily = `"${fontFamily}", system-ui, sans-serif`;
    return () => {
      for (const [key, value] of previous) {
        if (value) root.style.setProperty(key, value);
        else root.style.removeProperty(key);
      }
      root.style.colorScheme = previousColorScheme;
      root.style.fontFamily = previousFontFamily;
    };
  }, [data, theme]);

  useEffect(() => {
    if (data?.tenant.siteName) document.title = data.tenant.siteName;
  }, [data?.tenant.siteName]);

  const font = data?.tenant.fontFamily;

  if (data === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f6f7f9] px-6">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Site not found</p>
          <p className="mt-1 text-xs text-slate-500">
            There is no tenant site at <span className="font-mono">{subdomain}</span>.
          </p>
        </div>
        <PoweredBy />
      </div>
    );
  }

  const { tenant, viewer, membership } = data;
  const isMember = Boolean(membership?.isMember);
  const tenantStatus = String(
    (tenant as typeof tenant & { status?: string; lifecycleStatus?: string }).status ??
      (tenant as typeof tenant & { lifecycleStatus?: string }).lifecycleStatus ??
      "",
  ).toUpperCase();
  const suspended =
    !tenant.isAvailable || tenantStatus === "SUSPENDED" || tenantStatus === "LOCKED";

  const vars = {
    ...bankThemeVars(theme),
    "--t-muted": theme.muted,
    fontFamily: font ? `"${font}", ${theme.isDark ? "system-ui" : "system-ui"}, sans-serif` : undefined,
  } as CSSProperties;

  // Suspended / locked: a single maintenance card, tenant name only.
  if (suspended) {
    return (
      <div
        style={vars}
        className="flex min-h-screen flex-col items-center justify-center bg-[var(--bank-surface)] px-6 text-[var(--bank-text)]"
      >
        <div
          className="w-full max-w-md border p-8 text-center"
          style={{
            background: theme.panel,
            borderColor: theme.border,
            borderRadius: theme.radius,
          }}
        >
          <TenantMark logo={tenant.branding?.logo} name={tenant.displayName} primary={theme.primary} radius={theme.radius} />
          <div className="mt-4 flex justify-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: theme.panelMuted, color: theme.muted }}
            >
              <Lock className="h-5 w-5" />
            </span>
          </div>
          <h1 className="mt-4 text-lg font-semibold">{tenant.displayName}</h1>
          <p className="mt-2 text-sm" style={{ color: theme.muted }}>
            This site is temporarily unavailable. Please contact the site owner.
          </p>
          {tenant.supportEmail && (
            <a
              href={`mailto:${tenant.supportEmail}`}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium underline"
              style={{ color: theme.primary }}
            >
              <Mail className="h-3.5 w-3.5" /> {tenant.supportEmail}
            </a>
          )}
        </div>
        <PoweredBy />
      </div>
    );
  }

  // Member-only routes: signed-out or non-member visitors go to this tenant's login.
  if (mode === "member" && (!viewer || !isMember)) {
    return <Navigate to={`/t/${tenant.subdomain}/login`} replace />;
  }

  const navItems = [
    { to: `/t/${tenant.subdomain}/dashboard`, label: "Dashboard" },
    { to: `/t/${tenant.subdomain}/ledger`, label: "Ledger" },
    { to: `/t/${tenant.subdomain}/kyc`, label: "Verification" },
    { to: `/t/${tenant.subdomain}/settings`, label: "Settings" },
  ];

  return (
    <PortalContext.Provider value={{ subdomain: tenant.subdomain, data, theme }}>
      <div
        style={vars}
        className="flex min-h-screen flex-col bg-[var(--bank-surface)] text-[var(--bank-text)]"
      >
        <header
          className="sticky top-0 z-30 border-b backdrop-blur"
          style={{
            background: `${theme.panel}e6`,
            borderColor: theme.border,
          }}
        >
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Link to={`/t/${tenant.subdomain}/dashboard`} className="flex min-w-0 items-center gap-2.5">
              <TenantMark
                logo={tenant.branding?.logo}
                name={tenant.displayName}
                primary={theme.primary}
                radius={theme.radius}
              />
              <span className="truncate text-sm font-semibold">{tenant.displayName}</span>
            </Link>

            {viewer && isMember && (
              <nav className="ml-2 hidden items-center gap-1 md:flex">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className="rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    style={({ isActive }) => ({
                      color: isActive ? theme.primary : theme.muted,
                      background: isActive ? theme.panelMuted : "transparent",
                    })}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}

            <div className="ml-auto flex items-center gap-2">
              {viewer ? (
                <>
                  <span className="hidden text-[11px] sm:block" style={{ color: theme.muted }}>
                    {viewer.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void signOut().then(() => navigate(`/t/${tenant.subdomain}/login`));
                    }}
                    className="flex h-8 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors"
                    style={{ color: theme.muted, border: `1px solid ${theme.border}` }}
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </>
              ) : (
                <Link
                  to={`/t/${tenant.subdomain}/login`}
                  className="rounded px-3 py-1.5 text-xs font-semibold"
                  style={{ background: theme.primary, color: "#fff", borderRadius: theme.radius }}
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>

          {viewer && isMember && (
            <nav
              className="flex gap-1 overflow-x-auto border-t px-3 py-2 md:hidden"
              style={{ borderColor: theme.divider }}
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium"
                  style={({ isActive }) => ({
                    color: isActive ? theme.primary : theme.muted,
                    background: isActive ? theme.panelMuted : "transparent",
                  })}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>

        <footer className="px-4 pb-6">
          <PoweredBy />
        </footer>
      </div>
    </PortalContext.Provider>
  );
}
