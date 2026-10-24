import { useSession } from "@/hooks/useSession";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * The one and only auth guard.
 *
 * It reads the same provider the shell does, so the two cannot disagree about
 * whether the session has resolved. `loading` renders a spinner and keeps the
 * requested URL; only an explicit `anon` from the API redirects to `/login`,
 * with the intended path preserved in `returnTo`.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Checking your session…</span>
      </main>
    );
  }

  if (status === "anon") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
