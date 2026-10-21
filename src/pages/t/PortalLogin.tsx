import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TenantPortalShell, usePortal } from "@/components/tenant/TenantPortalShell";
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";

export default function PortalLogin() {
  return (
    <TenantPortalShell mode="public">
      <LoginBody />
    </TenantPortalShell>
  );
}

function LoginBody() {
  const { data, theme } = usePortal();
  const { tenant, viewer, membership } = data;
  const navigate = useNavigate();
  const { signIn, signOut } = useAuthActions();
  const join = useMutation(api.tenantPortal.joinPortal);

  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const dashboard = `/t/${tenant.subdomain}/dashboard`;
  const alreadyMember = Boolean(viewer && membership?.isMember);
  if (alreadyMember) return <Navigate to={dashboard} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (createMode && name.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", {
        flow: createMode ? "signUp" : "signIn",
        email: email.trim(),
        password,
        ...(createMode ? { name: name.trim() } : {}),
      });
      if (createMode) {
        // A fresh account joins this tenant so the portal has a customer to show.
        await join({ tenantId: tenant._id }).catch(() => undefined);
      }
      navigate(dashboard, { replace: true });
    } catch (err) {
      const text = err instanceof Error ? err.message : "";
      setError(
        /too many|rate limit/i.test(text)
          ? "Too many attempts. Wait a moment and try again."
          : /invalid|credential|password/i.test(text)
            ? "That email and password don't match."
            : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function joinSite() {
    setJoining(true);
    try {
      await join({ tenantId: tenant._id });
      navigate(dashboard, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join this site.");
    } finally {
      setJoining(false);
    }
  }

  const inputStyle = {
    background: theme.inputBg,
    borderColor: theme.border,
    color: theme.text,
    borderRadius: theme.radius,
  } as const;

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-6">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden text-xl font-bold"
            style={{ background: theme.primary, color: "#fff", borderRadius: theme.radius }}
          >
            {tenant.branding?.logo ? (
              <img src={tenant.branding.logo} alt={tenant.displayName} className="h-full w-full object-contain" />
            ) : (
              tenant.displayName.slice(0, 1).toUpperCase()
            )}
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">
            {createMode ? `Create your ${tenant.displayName} account` : `Sign in to ${tenant.displayName}`}
          </h1>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            {tenant.branding?.tagline ?? "Access your accounts and manage your money."}
          </p>
        </div>

        <div
          className="mt-6 border p-5 shadow-sm"
          style={{ background: theme.panel, borderColor: theme.border, borderRadius: theme.radius }}
        >
          {viewer && !alreadyMember ? (
            <div className="space-y-3 text-center">
              <ShieldCheck className="mx-auto h-7 w-7" style={{ color: theme.primary }} />
              <p className="text-sm font-medium">You're signed in as {viewer.email}</p>
              <p className="text-xs" style={{ color: theme.muted }}>
                This account isn't a customer of {tenant.displayName} yet. Join to view your ledger,
                balances and verification status here.
              </p>
              <button
                type="button"
                onClick={() => void joinSite()}
                disabled={joining}
                className="flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: theme.primary, borderRadius: theme.radius }}
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Join {tenant.displayName}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-[11px] underline"
                style={{ color: theme.muted }}
              >
                Use a different account
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5">
              {createMode && (
                <div>
                  <label htmlFor="portal-name" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                    Full name
                  </label>
                  <input
                    id="portal-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border px-3 py-2.5 text-sm outline-none focus:ring-2"
                    style={inputStyle}
                    placeholder="Ada Lovelace"
                    required
                  />
                </div>
              )}
              <div>
                <label htmlFor="portal-email" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                  Email
                </label>
                <input
                  id="portal-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border px-3 py-2.5 text-sm outline-none focus:ring-2"
                  style={inputStyle}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div>
                <label htmlFor="portal-password" className="mb-1 block text-[11px] font-medium" style={{ color: theme.muted }}>
                  Password
                </label>
                <input
                  id="portal-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border px-3 py-2.5 text-sm outline-none focus:ring-2"
                  style={inputStyle}
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <p className="flex items-start gap-1.5 rounded px-2.5 py-2 text-[11px]" style={{ background: "rgba(185,28,28,0.08)", color: "#b91c1c" }}>
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ background: theme.primary, borderRadius: theme.radius }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? (createMode ? "Creating account" : "Signing in") : createMode ? "Create account" : "Sign in"}
              </button>

              <div className="flex items-center justify-between pt-1 text-[11px]" style={{ color: theme.muted }}>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMode((v) => !v);
                    setError("");
                  }}
                  className="underline"
                >
                  {createMode ? "I already have an account" : "Create an account"}
                </button>
                <Link to={`/auth?returnTo=${encodeURIComponent(dashboard)}`} className="underline">
                  Forgot password?
                </Link>
              </div>
            </form>
          )}
        </div>

        {tenant.supportEmail && (
          <p className="mt-4 text-center text-[11px]" style={{ color: theme.muted }}>
            Need help? Contact {tenant.supportEmail}
          </p>
        )}
      </div>
    </div>
  );
}
