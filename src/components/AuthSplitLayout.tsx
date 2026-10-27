import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Activity, Coins, Eye, EyeOff, LayoutGrid, CircleAlert, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion";
import { usePlatformConfig } from "@/hooks/use-platform-config";
import logo from "@/assets/logo.svg";

/**
 * Split-screen authentication shell shared by `/login` and `/register`.
 *
 * Left (45%) is the brand panel — one quiet emerald wash over the black
 * surface, a tilted preview of the product, and the three proofs the product
 * actually stands behind. Right (55%) holds a single 400px card, vertically
 * centred, so the form never stretches on wide screens.
 *
 * On small screens the brand panel collapses to a 120px logo header and the
 * card takes the full width: nothing about the form changes, only its frame.
 */

const PROOFS = [
  { icon: Coins, text: "Pay per action, not per month" },
  { icon: Activity, text: "Real-time balance" },
  { icon: LayoutGrid, text: "Works across 5 workspaces" },
] as const;

/**
 * Where an authenticated user lands. A same-origin `returnTo` wins so a deep
 * link survives the sign-in detour; anything else falls back to the app root.
 */
export function resolveAuthRedirect(returnTo: string | null, fallback = "/dashboard"): string {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

/**
 * Turns a transport/API failure into something a person can act on.
 * Never surfaces raw stack text or database detail.
 */
export function describeAuthError(err: unknown, mode: "login" | "register"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const text = `${raw} ${(err as { cause?: { message?: string } })?.cause?.message ?? ""}`;

  if (/failed to fetch|networkerror|load failed|econnrefused/i.test(text)) {
    return "Can't reach the server right now. Check your connection and try again.";
  }
  if (/too many|rate limit|429/i.test(text)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (mode === "register" && /already|exists|duplicate|unique/i.test(text)) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (mode === "login" && /invalid|credential|password|unauthorized|401/i.test(text)) {
    return "Incorrect email or password.";
  }
  if (mode === "register" && /password/i.test(text)) {
    return "Passwords must be at least 8 characters.";
  }
  if (/invalid.*details|validation/i.test(text)) {
    return mode === "login"
      ? "Sign-in failed. Check your details and try again."
      : "Those registration details aren't valid. Check the fields and try again.";
  }
  const status = (err as { status?: number })?.status;
  if (status === 503 || /schema is missing|schema_missing|not ready|finish the neon migration|provision/i.test(text)) {
    return "Cloudie isn't fully set up yet — the service isn't ready. Please try again shortly.";
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 ||
      /internal server error|service unavailable|server error|bad gateway/i.test(text)) {
    // The API answered, but something behind it failed. Saying so is accurate;
    // guessing at the user's details would blame them for a server problem.
    return mode === "login"
      ? "The service hit a problem signing you in. Please try again in a moment."
      : "The service hit a problem creating your account. Please try again in a moment.";
  }
  return mode === "login"
    ? "We couldn't sign you in. Please try again."
    : "We couldn't create your account. Please try again.";
}

/* ── Product preview ────────────────────────────────────────────── */

const PREVIEW_ROWS = [
  { label: "MTN airtime", meta: "Today · 09:41", amount: "-420 pts", tone: "text-muted-foreground" },
  { label: "Electricity top-up", meta: "Today · 08:12", amount: "-1,150 pts", tone: "text-muted-foreground" },
  { label: "Wallet credit", meta: "Yesterday", amount: "+500 pts", tone: "text-success" },
] as const;

const PREVIEW_BARS = [38, 54, 42, 68, 50, 82, 61, 74] as const;

/** A static, tilted render of the dashboard — the product's own visual language. */
function ProductPreview() {
  return (
    <div className="relative mt-8 w-full max-w-md">
      <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-primary/10 blur-2xl" aria-hidden />
      <div className="group relative -rotate-3 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-rotate-1">
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-2xl shadow-black/60">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-border/70 bg-surface px-4 py-2.5">
            <span className="size-2 rounded-full bg-border" aria-hidden />
            <span className="size-2 rounded-full bg-border" aria-hidden />
            <span className="size-2 rounded-full bg-border" aria-hidden />
            <span className="ml-2 truncate text-[10px] font-medium text-muted-foreground">
              Workspace · Overview
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              Live
            </span>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-xl border border-border/70 bg-surface p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Points balance
              </p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="font-display text-2xl font-bold tabular-nums text-foreground">
                  1,840<span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
                </p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  +500
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Airtime", value: "38" },
                { label: "Data", value: "21" },
                { label: "Bills", value: "12" },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl border border-border/70 bg-surface p-2.5">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{tile.label}</p>
                  <p className="mt-0.5 font-display text-sm font-bold tabular-nums text-foreground">{tile.value}</p>
                </div>
              ))}
            </div>

            <div className="flex h-16 items-end gap-1.5" aria-hidden>
              {PREVIEW_BARS.map((height, index) => (
                <span
                  key={index}
                  className={cn(
                    "flex-1 rounded-sm transition-colors",
                    index === PREVIEW_BARS.length - 2 ? "bg-primary" : "bg-primary/30",
                  )}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              {PREVIEW_ROWS.map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="size-6 shrink-0 rounded-lg border border-border/70 bg-surface" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-foreground">{row.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{row.meta}</span>
                  </span>
                  <span className={cn("shrink-0 text-[11px] font-semibold tabular-nums", row.tone)}>
                    {row.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Floating confirmation chip — depth, and a second read of the balance. */}
        <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-border/80 bg-card px-3 py-2 shadow-xl shadow-black/60 sm:block">
          <p className="text-[10px] font-semibold text-foreground">Payment confirmed</p>
          <p className="text-[10px] text-muted-foreground">Airtime delivered in 2.1s</p>
        </div>
      </div>
    </div>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────── */

/**
 * Server-side failure surface. Always `role="alert"` so a screen reader
 * announces it the moment it replaces the previous message.
 */
export function AlertStrip({
  children,
  tone = "error",
  className,
}: {
  children: ReactNode;
  tone?: "error" | "info";
  className?: string;
}) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** Success state: shown while the app hands the user over to the product. */
export function RedirectSkeleton({ title, hint }: { title: string; hint: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="space-y-3 animate-pulse">
        <div className="h-3 w-1/3 rounded-full bg-muted" />
        <div className="h-11 w-full rounded-xl bg-muted" />
        <div className="h-3 w-1/4 rounded-full bg-muted" />
        <div className="h-11 w-full rounded-xl bg-muted" />
        <div className="h-11 w-full rounded-xl bg-primary/70" />
      </div>
      <p className="sr-only">Redirecting…</p>
    </div>
  );
}

export interface AuthFieldProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  inputMode?: "text" | "email";
  disabled?: boolean;
  /** Renders the show/hide affordance for password fields. */
  withReveal?: boolean;
  optional?: boolean;
}

/**
 * One labelled input. Validation itself lives in the page (one validator per
 * field, reused for submit), so this component only reports the result and
 * only on blur — a field never scolds you while you are still typing.
 */
export function AuthField({
  id,
  label,
  value,
  onValueChange,
  onBlur,
  error,
  hint,
  type = "text",
  autoComplete,
  placeholder,
  inputMode,
  disabled,
  withReveal,
  optional,
}: AuthFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const inputType = withReveal ? (revealed ? "text" : "password") : type;
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </Label>
        {optional && <span className="text-[11px] text-muted-foreground">Optional</span>}
      </div>

      <div className="relative">
        <Input
          id={id}
          name={id}
          type={inputType}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          onChange={(event) => onValueChange(event.target.value)}
          onBlur={onBlur}
          className={cn("rounded-xl pr-10", error && "border-destructive focus-visible:border-destructive")}
        />
        {withReveal && (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground sm:h-9 sm:w-9"
          >
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ── OAuth row ──────────────────────────────────────────────────── */

const GOOGLE_PATHS = [
  { fill: "#4285F4", d: "M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" },
  { fill: "#34A853", d: "M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" },
  { fill: "#FBBC05", d: "M3.97 10.72A5.41 5.41 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" },
  { fill: "#EA4335", d: "M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" },
] as const;

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      {GOOGLE_PATHS.map((path) => (
        <path key={path.fill} fill={path.fill} d={path.d} />
      ))}
    </svg>
  );
}

export type OAuthProvider = "google" | "github";

/**
 * "or" divider + the two providers, side by side. The marks keep their
 * official brand colours on purpose: they are logos, not UI colour.
 */
function OAuthRow({
  onProvider,
  disabled,
}: {
  onProvider: (provider: OAuthProvider) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onProvider("google")}
          className="h-11 w-full gap-2 rounded-xl text-sm font-medium sm:h-9"
        >
          <GoogleMark />
          Google
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => onProvider("github")}
          className="h-11 w-full gap-2 rounded-xl text-sm font-medium sm:h-9"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden focusable="false" fill="currentColor">
            <path d="M12 1.5A10.5 10.5 0 0 0 8.68 22c.53.1.72-.23.72-.5v-1.76c-2.92.63-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.55-1.17-1.55-.96-.65.07-.64.07-.64 1.06.08 1.62 1.09 1.62 1.09.94 1.6 2.47 1.14 3.07.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.2 0-1.15.41-2.09 1.09-2.83-.11-.27-.47-1.34.1-2.8 0 0 .88-.28 2.9 1.08a10 10 0 0 1 5.28 0c2.01-1.36 2.9-1.08 2.9-1.08.57 1.46.21 2.53.1 2.8.68.74 1.09 1.68 1.09 2.83 0 4.04-2.46 4.93-4.8 5.19.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z" />
          </svg>
          GitHub
        </Button>
      </div>
    </div>
  );
}

/* ── Layout ─────────────────────────────────────────────────────── */

export function AuthSplitLayout({
  title,
  description,
  form,
  onProvider,
  switchNode,
  footer,
  pending = false,
}: {
  title: string;
  description: string;
  /** The page's `<form>` — fields, alert strip, primary button. */
  form: ReactNode;
  onProvider: (provider: OAuthProvider) => void;
  /** "New here? Create an account" style link, rendered under the OAuth row. */
  switchNode: ReactNode;
  footer?: ReactNode;
  /** True while the redirect skeleton owns the card: providers are inert. */
  pending?: boolean;
}) {
  const { brand } = usePlatformConfig();

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      {/* Mobile: the brand panel collapses to a logo-only header. */}
      <header className="flex h-[120px] shrink-0 items-center border-b border-border/70 bg-surface px-5 lg:hidden">
        <img src={logo} alt={brand.name} className="h-11 w-11 rounded-2xl" width={44} height={44} />
      </header>

      {/* Desktop: brand panel, 45%. */}
      <aside className="relative hidden w-[45%] shrink-0 flex-col justify-between overflow-hidden border-r border-border/60 bg-surface p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/[0.03] to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 text-border/40 opacity-50 [background-image:repeating-linear-gradient(90deg,currentColor_0_1px,transparent_1px_72px),repeating-linear-gradient(0deg,currentColor_0_1px,transparent_1px_72px)]"
        />

        <div className="relative flex items-center gap-2.5">
          <img src={logo} alt="" aria-hidden className="h-9 w-9 rounded-xl" width={36} height={36} />
          <span className="font-display text-base font-bold tracking-tight text-foreground">{brand.name}</span>
        </div>

        <Reveal className="relative">
          <p className="max-w-sm font-display text-[2rem] font-bold leading-[1.1] tracking-tight text-foreground">
            One balance for every service you sell.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{brand.tagline}</p>
          <ProductPreview />
        </Reveal>

        <StaggerGroup className="relative space-y-3">
          {PROOFS.map((proof) => (
            <StaggerItem key={proof.text} className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <proof.icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">{proof.text}</span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </aside>

      {/* Right: form card, 55%, vertically centred, 400px max. */}
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:w-[55%]">
        <div className="w-full max-w-[400px]">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-lg shadow-black/20 sm:p-7">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>

            <div className="mt-6">{form}</div>

            {!pending && (
              <>
                <div className="mt-6">
                  <OAuthRow onProvider={onProvider} />
                </div>

                <div className="mt-6 border-t border-border/60 pt-5 text-center text-sm text-muted-foreground">
                  {switchNode}
                </div>
              </>
            )}
          </div>

          {footer && (
            <p className="mt-5 text-center text-xs text-muted-foreground">{footer}</p>
          )}
        </div>
      </main>
    </div>
  );
}
