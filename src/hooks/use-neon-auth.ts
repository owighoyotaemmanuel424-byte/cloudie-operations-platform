import { useCallback, useEffect, useState } from "react";
import { getCachedNeonUser, getNeonToken, neonApi, type NeonUser } from "@/lib/neonApi";

/**
 * Neon-backed auth state for incremental migration.
 * This is deliberately separate from use-auth until the app's Convex data
 * dependencies are migrated, so existing routes are not silently broken.
 */
export function useNeonAuth() {
  const [user, setUser] = useState<NeonUser | null>(() => getCachedNeonUser());
  const [isLoading, setIsLoading] = useState(() => Boolean(getNeonToken()));

  const refresh = useCallback(async () => {
    if (!getNeonToken()) {
      setUser(null);
      setIsLoading(false);
      return null;
    }
    setIsLoading(true);
    try {
      const current = await neonApi.me();
      setUser(current);
      return current;
    } catch {
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const next = await neonApi.login({ email, password });
    setUser(next);
    return next;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const next = await neonApi.register({ name, email, password });
    setUser(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    try { await neonApi.logout(); } finally { setUser(null); }
  }, []);

  return { user, isAuthenticated: Boolean(user), isLoading, login, register, logout, refresh };
}
