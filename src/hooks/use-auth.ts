import { useCallback } from "react";
import { neonApi } from "@/lib/neonApi";
import { useSession } from "./useSession";

/**
 * The app-wide auth facade.
 *
 * It is now a thin adapter over `useSession`, which lives in a provider above
 * the router. That matters: this hook used to own a private `useState` plus its
 * own `/api/me` call, so any component that mounted a second copy (the shell,
 * a guard, a page) fetched the session again and briefly saw "no user" — the
 * classic accidental-logout path. There is now exactly one session read and one
 * place that can end it.
 */
export function useAuth() {
  const {
    user,
    status,
    isAuthenticated,
    isLoading,
    setUser,
    signOut: endSession,
    refresh: reloadSession,
  } = useSession();

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
    return await endSession();
  }, [endSession]);

  const signIn = useCallback(
    async (
      providerOrFlow?: unknown,
      params?: {
        flow?: string;
        email?: string;
        password?: string;
        name?: string;
        code?: string;
        newPassword?: string;
        [key: string]: unknown;
      },
    ) => {
      const options = (typeof providerOrFlow === "object" && providerOrFlow !== null)
        ? (providerOrFlow as Record<string, unknown>)
        : (params as Record<string, unknown> | undefined);

      const flow = (options?.flow as string | undefined) ?? "signIn";
      const email = (options?.email as string | undefined) ?? "";
      const password = (options?.password as string | undefined) ?? "";
      const name = (options?.name as string | undefined) ?? email.split("@")[0] ?? "User";

      if (flow === "signUp") return await register(name, email, password);
      if (flow === "signIn" || flow === "password") return await login(email, password);
      throw new Error("This authentication flow is not supported by the configured API.");
    },
    [login, register],
  );

  const signOut = useCallback(async () => {
    return await endSession();
  }, [endSession]);

  const refresh = useCallback(async () => {
    return await reloadSession();
  }, [reloadSession]);

  return {
    status,
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
    login,
    register,
    logout,
    refresh,
  };
}
