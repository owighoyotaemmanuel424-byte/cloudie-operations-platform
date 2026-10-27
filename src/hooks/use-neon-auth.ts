import { useCallback } from "react";
import { neonApi } from "@/lib/neonApi";
import { useSession } from "./useSession";

/**
 * Backwards-compatible alias for the shared session.
 *
 * Kept so older imports do not create a second, independent auth state (which
 * is exactly how a shell can decide "signed out" while the page is signed in).
 * New code should use `useSession` or `useAuth`.
 */
export function useNeonAuth() {
  const { user, isAuthenticated, isLoading, setUser, signOut, refresh } = useSession();

  const login = useCallback(
    async (email: string, password: string) => {
      const next = await neonApi.login({ email, password });
      setUser(next);
      return next;
    },
    [setUser],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const next = await neonApi.register({ name, email, password });
      setUser(next);
      return next;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return { user, isAuthenticated, isLoading, login, register, logout, refresh };
}
