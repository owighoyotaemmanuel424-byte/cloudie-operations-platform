import { motion } from "framer-motion";
import { ArrowRight, LayoutGrid, Loader2, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE, SectionLabel } from "@/platform/ui";
import { PlatformError, signIn, signUp } from "@/platform/engine";

export default function AuthPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "register">(params.get("mode") === "register" ? "register" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnTo = params.get("returnTo") || "/app/personal";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        await signIn(email, password);
        toast.success("Signed in", { description: "Your workspace context is restored." });
      } else {
        await signUp({ name, email, password, referralCode: referral });
        toast.success("Workspace created", { description: "1,000 starter points credited." });
      }
      navigate(returnTo, { replace: true });
    } catch (cause) {
      const message = cause instanceof PlatformError ? cause.message : "Something went wrong. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function useDemo() {
    // Accounts are real now, so the shortcut creates a throwaway demo workspace
    // instead of pointing at a shared credential that no longer exists.
    setMode("register");
    setName("Demo Operator");
    setEmail(`demo-${Date.now().toString(36)}@cloudie.test`);
    setPassword("cloudie123");
    setError(null);
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="pointer-events-none absolute inset-0 grid-field opacity-20" aria-hidden />
        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-foreground/15">
            <LayoutGrid className="h-4 w-4" />
          </span>
          <span className="font-display text-[17px] font-semibold">Cloudie Operations</span>
        </Link>

        <div className="relative max-w-md">
          <SectionLabel className="text-primary-foreground/70">Single sign-on</SectionLabel>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">
            Five workspaces open behind one session.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-primary-foreground/80">
            Sign in once and your balance, shipments, travel documents, tenant portals and campaigns travel with you.
            Session tokens are bound to the account — no cross-workspace identity spoofing.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              "Verified points balance on every charge",
              "Resource-level ownership on every record",
              "Live updates pushed over the event channel",
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
          <Link to="/" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground lg:hidden">
            ← Back to overview
          </Link>

          <div className="flex rounded-xl border border-border bg-surface p-1">
            {(["signin", "register"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option);
                  setError(null);
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  mode === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <h2 className="mt-7 font-display text-2xl font-semibold">
            {mode === "signin" ? "Back to your workspaces" : "Open a new workspace"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Your session carries every module and your points balance."
              : "New accounts start with 1,000 points to spend across all five workspaces."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" ? (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Amara Okonjo"
                    className="pl-9"
                    autoComplete="name"
                  />
                </div>
              </div>
            ) : null}

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

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                />
              </div>
            </div>

            {mode === "register" ? (
              <div className="space-y-1.5">
                <Label htmlFor="referral">Referral code (optional)</Label>
                <Input
                  id="referral"
                  value={referral}
                  onChange={(event) => setReferral(event.target.value.toUpperCase())}
                  placeholder="CLD-4K2Q"
                />
              </div>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "signin" ? "Sign in" : "Create workspace"}
              {!busy ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </form>

          <button
            type="button"
            onClick={useDemo}
            className="mt-4 w-full rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="font-medium text-foreground">Create a demo workspace</span> · opens a real account
            with 1,000 starter points and an empty ledger.
          </button>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            By continuing you accept the platform terms. Sessions are HttpOnly cookies and expire after 8 hours.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
