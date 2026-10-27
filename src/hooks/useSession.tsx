import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CSRF_HEADER,
  NeonApiError,
  clearNeonSession,
  ensureCsrfToken,
  getCachedNeonUser,
  getCsrfToken,
  neonApi,
  type NeonUser,
} from "@/lib/neonApi";

/**
 * The one source of truth for "who is signed in".
 *
 * Three states, never two:
 *   loading — the Neon session has not resolved yet. Render skeleton, never
 *             redirect and never sign out.
 *   authed  — `/api/me` (or a warm cache) returned a user.
 *   anon    — the API explicitly answered 401.
 *
 * This lives in a provider mounted *above* the router, so a route change, a
 * resize, a drawer open/close or a tab focus cannot remount it and wipe auth
 * state. There is exactly one `/api/me` call per page load; the promise is
 * memoised at module scope, which also collapses React StrictMode's double
 * mount into a single request.
 */
export type SessionStatus = "loading" | "authed" | "anon";

export type SessionUser = NeonUser;

export type SessionValue = {
  status: SessionStatus;
  user: SessionUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Re-reads the session from the API. Only call this deliberately. */
  refresh: () => Promise<SessionUser | null>;
  /** Records a user returned by login/register/profile. */
  setUser: (user: SessionUser | null) => void;
  /** The only supported way to end a session. */
  signOut: () => Promise<{ ok: boolean; error?: string }>;
};

/**
 * Stable cache key. It deliberately contains no route or workspace value: the
 * session does not change when the user navigates, so a route-keyed key would
 * make every navigation look like a cache miss and refetch `/api/me`.
 */
export const SESSION_QUERY_KEY = ["session", "current-user"] as const;

export const CSRF_HEADER_NAME = CSRF_HEADER;

/** Headers the Neon API requires on sign-out (double-submit CSRF). */
export async function logoutCsrfHeaders(): Promise<Record<string, string>> {
  const existing = getCsrfToken();
  const token = existing ?? (await ensureCsrfToken());
  return token ? { [CSRF_HEADER]: token } : {};
}

/**
 * Ends the server session, then clears the local one.
 *
 * Returns a result instead of throwing because sign-out is the one nav action
 * that must complete even when the network does not: the caller navigates to
 * `/login` either way, but reports the failure rather than pretending it
 * worked.
 */
export async function signOutSession(): Promise<{ ok: boolean; error?: string }> {
  let error: string | undefined;
  try {
    // The double-submit token must be read *before* the request: the Neon API
    // answers 403 for a cookie session without a matching header, and a silent
    // local-only "sign out" would leave the server session alive.
    const headers = await logoutCsrfHeaders();
    await neonApi.request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      body: "{}",
      headers,
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Sign out failed";
  } finally {
    // Local cache is cleared even on failure: leaving a token behind would let
    // the shell look signed in after the user asked to leave.
    clearNeonSession();
  }
  return error ? { ok: false, error } : { ok: true };
}

type Resolved = { status: "authed"; user: SessionUser } | { status: "anon" };

let inFlightSession: Promise<Resolved> | null = null;

async function readSession(): Promise<Resolved> {
  try {
    const user = await neonApi.me();
    return { status: "authed", user };
  } catch (caught) {
    // Only an explicit 401 means "signed out". A flaky network, a cold Render
    // instance or a 5xx must never end the session, so fall back to the cached
    // user instead of bouncing the person to /login.
    if (caught instanceof NeonApiError && caught.status === 401) {
      return { status: "anon" };
    }
    const cached = getCachedNeonUser();
    return cached ? { status: "authed", user: cached } : { status: "anon" };
  }
}

/** One request per page load, shared by every consumer of the provider. */
function currentSession(): Promise<Resolved> {
  if (!inFlightSession) {
    inFlightSession = readSession().finally(() => {
      inFlightSession = null;
    });
  }
  return inFlightSession;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const cached = getCachedNeonUser();
  const [state, setState] = useState<{ status: SessionStatus; user: SessionUser | null }>(() =>
    cached ? { status: "authed", user: cached } : { status: "loading", user: null },
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // A page load with no bearer token can still be a valid cookie session
    // (same-origin deployments). Ask once; a 401 resolves to anon.
    void currentSession().then((result) => {
      if (!mounted.current) return;
      if (result.status === "authed") {
        setState({ status: "authed", user: result.user });
        return;
      }
      // A slow first read must not overturn a sign-in that happened while it
      // was in flight — that is the same accidental-logout bug in a race.
      setState((current) =>
        current.status === "authed" ? current : { status: "anon", user: null },
      );
    });

    // Keep auth changes made elsewhere (login page, another tab) in sync
    // without polling. A null detail never signs anybody out here — sign-out is
    // the explicit path below.
    const onAuthChange = () => {
      const next = getCachedNeonUser();
      if (next) setState({ status: "authed", user: next });
    };
    window.addEventListener("cloudie-auth-change", onAuthChange);
    return () => {
      mounted.current = false;
      window.removeEventListener("cloudie-auth-change", onAuthChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await currentSession();
    if (!mounted.current) return result.status === "authed" ? result.user : null;
    if (result.status === "authed") {
      setState({ status: "authed", user: result.user });
      return result.user;
    }
    setState({ status: "anon", user: null });
    return null;
  }, []);

  const setUser = useCallback((user: SessionUser | null) => {
    setState(user ? { status: "authed", user } : { status: "anon", user: null });
  }, []);

  const signOut = useCallback(async () => {
    const result = await signOutSession();
    if (mounted.current) setState({ status: "anon", user: null });
    return result;
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status: state.status,
      user: state.user,
      isAuthenticated: state.status === "authed" && Boolean(state.user),
      isLoading: state.status === "loading",
      refresh,
      setUser,
      signOut,
    }),
    [state, refresh, setUser, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside <SessionProvider> (mounted above the router).");
  }
  return value;
}
