import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, KeyRound, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE, SectionLabel } from "@/platform/ui";
import { PlatformError, confirmPasswordReset, requestPasswordReset } from "@/platform/engine";

export default function PasswordResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialToken = params.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  const mode: "request" | "confirm" = token ? "confirm" : "request";

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
      if (result.devToken) setDevToken(result.devToken);
      toast.success("Reset link issued", { description: "Check your inbox for the reset link." });
    } catch (cause) {
      const message = cause instanceof PlatformError ? cause.message : "Something went wrong. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function submitConfirm(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token.trim(), password);
      setDone(true);
      toast.success("Password updated", { description: "Sign in with your new password." });
    } catch (cause) {
      const message = cause instanceof PlatformError ? cause.message : "Something went wrong. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute inset-0 grid-field opacity-20" aria-hidden />
        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-foreground/15">
            <KeyRound className="h-4 w-4" />
          </span>
          <span className="font-display text-[17px] font-semibold">Cloudie Operations</span>
        </Link>

        <div className="relative max-w-md">
          <SectionLabel className="text-primary-foreground/70">Account recovery</SectionLabel>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">
            Get back into your workspaces.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-primary-foreground/80">
            Request a reset link, confirm it with a new password, and your session revokes everywhere so
            no stale tokens survive the change.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "Reset tokens are hashed at rest and expire in 60 minutes",
              "Every active session is revoked on confirmation",
              "Delivery uses the configured mail transport or webhook",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] text-primary-foreground/90">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative overflow-hidden rounded-2xl">
          <img
            src="https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?auto=format&fit=crop&w=900&q=70"
            alt="Container terminal at dusk"
            className="h-36 w-full object-cover opacity-80"
            loading="lazy"
          />
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="w-full max-w-md"
        >
          <Link to="/auth" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground lg:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>

          <h2 className="font-display text-2xl font-semibold">
            {done ? "Password updated" : mode === "request" ? "Reset your password" : "Choose a new password"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {done
              ? "You can now sign in with your new password."
              : mode === "request"
                ? "Enter the email on your account and we will issue a reset link."
                : "Enter the token from your reset email and a new password."}
          </p>

          {done ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs text-primary">
                Your password has been changed and all sessions revoked.
              </div>
              <Button className="w-full" size="lg" onClick={() => navigate("/auth", { replace: true })}>
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : mode === "request" ? (
            <>
              {sent ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs text-primary">
                    If that account exists, a reset link has been issued. Check your inbox.
                  </div>
                  {devToken ? (
                    <div className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs">
                      <p className="font-medium text-foreground">Development token (not sent by email in this environment):</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{devToken}</p>
                      <button
                        type="button"
                        className="mt-2 text-[11px] text-primary hover:underline"
                        onClick={() => setToken(devToken)}
                      >
                        Use this token to continue →
                      </button>
                    </div>
                  ) : null}
                  <Button variant="outline" className="w-full" onClick={() => { setSent(false); setDevToken(null); }}>
                    Send another link
                  </Button>
                </div>
              ) : (
                <form onSubmit={submitRequest} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@company.com"
                        className="pl-9"
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  {error ? (
                    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </p>
                  ) : null}

                  <Button type="submit" className="w-full" size="lg" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Issue reset link
                    {!busy ? <ArrowRight className="h-4 w-4" /> : null}
                  </Button>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={submitConfirm} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token">Reset token</Label>
                <Input
                  id="token"
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste the token from your email"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm"
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {error ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update password
                {!busy ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
              <button
                type="button"
                className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => { setToken(""); setDevToken(null); setSent(false); }}
              >
                ← Back to request a new link
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground">Back to sign in</Link>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
