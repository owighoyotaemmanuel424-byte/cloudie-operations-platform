import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { neonApi, getNeonToken, getCachedNeonUser, type NeonUser } from "./neonApi";
import { getFunctionName } from "convex/server";

export class ConvexReactClient {
  constructor(_url?: string) {}
  setAuth() {}
  clearAuth() {}
}

export function ConvexProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useConvexAuth() {
  const [user, setUser] = useState<NeonUser | null>(() => getCachedNeonUser());
  const token = getNeonToken();
  const [isLoading, setIsLoading] = useState(() => Boolean(token && !user));

  useEffect(() => {
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    neonApi.me()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, [token]);

  return { isAuthenticated: Boolean(user), isLoading };
}

export function useAuthActions() {
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
        [key: string]: any;
      }
    ) => {
      const options = (typeof providerOrFlow === "object" && providerOrFlow !== null)
        ? (providerOrFlow as Record<string, any>)
        : (params as Record<string, any>);
      const flow = options?.flow ?? "signIn";
      const email = options?.email ?? "";
      const password = options?.password ?? options?.newPassword ?? "";
      const name = options?.name ?? email.split("@")[0] ?? "User";

      if (flow === "signUp") {
        return await neonApi.register({ name, email, password });
      } else {
        return await neonApi.login({ email, password });
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    await neonApi.logout();
  }, []);

  return { signIn, signOut };
}

export function useAuthToken() {
  return getNeonToken();
}

export function Authenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading || !isAuthenticated) return null;
  return <>{children}</>;
}

export function Unauthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading || isAuthenticated) return null;
  return <>{children}</>;
}

export function AuthLoading({ children }: { children: React.ReactNode }) {
  const { isLoading } = useConvexAuth();
  if (!isLoading) return null;
  return <>{children}</>;
}

function resolveFunctionName(fn: unknown): string {
  if (typeof fn === "string") return fn;
  try {
    return getFunctionName(fn as any);
  } catch {
    return "";
  }
}

// Simple in-memory pub-sub bus so mutations invalidate relevant queries
type Listener = () => void;
const queryBus = new Map<string, Set<Listener>>();

function subscribe(fnPrefix: string, listener: Listener) {
  let set = queryBus.get(fnPrefix);
  if (!set) {
    set = new Set();
    queryBus.set(fnPrefix, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

function triggerQueryUpdate(fnPrefix: string) {
  const set = queryBus.get(fnPrefix);
  if (set) {
    set.forEach((l) => l());
  }
}

export function useQuery(queryFn: unknown, args?: unknown): any {
  const fnName = resolveFunctionName(queryFn);
  const isSkipped = args === "skip";
  const [data, setData] = useState<any>(undefined);
  const argsKey = useMemo(() => JSON.stringify(args ?? {}), [args]);
  const mountedRef = useRef(true);

  const execute = useCallback(async () => {
    if (isSkipped || !fnName) return;

    try {
      if (fnName.includes("platform:getPublicConfig") || fnName.includes("getPublicConfig")) {
        const res = await neonApi.publicConfig();
        if (mountedRef.current) setData(res);
      } else if (fnName.includes("currentUser") || fnName.includes("me")) {
        const res = await neonApi.me();
        if (mountedRef.current) setData(res);
      } else if (fnName.includes("getBalance") || fnName.includes("wallet:summary") || fnName.includes("getWallet")) {
        const res = await neonApi.walletSummary();
        if (mountedRef.current) {
          setData({
            balance: res.points_balance,
            ngnEquivalent: res.wallet_balance_ngn,
            currency: res.currency,
          });
        }
      } else if (fnName.includes("getLedger") || fnName.includes("wallet:ledger")) {
        const res = await neonApi.walletLedger();
        if (mountedRef.current) setData(res.entries);
      } else if (fnName.includes("myShipments") || fnName.includes("shipments:list")) {
        const res = await neonApi.shipments();
        if (mountedRef.current) setData(res.shipments);
      } else if (fnName.includes("publicTracking")) {
        const tn = (args as any)?.trackingNumber;
        if (tn) {
          const res = await neonApi.track(tn);
          if (mountedRef.current) {
            const s = res.shipment as any;
            setData({
              trackingNumber: s.tracking_number,
              status: (s.status ?? "PENDING").toUpperCase(),
              serviceType: s.service_type,
              origin: { city: s.sender_city, country: s.sender_country },
              destination: { city: s.recipient_city, country: s.recipient_country },
              currentLocation: res.events?.[0] ? { city: (res.events[0] as any).location } : { city: s.sender_city },
              route: [],
              events: (res.events ?? []).map((e: any) => ({
                status: (e.status ?? "PENDING").toUpperCase(),
                description: e.description,
                location: e.location,
                eventTimestamp: new Date(e.occurred_at).getTime(),
              })),
            });
          }
        }
      } else if (fnName.includes("catalog") || fnName.includes("listCategories")) {
        const res = await neonApi.catalog();
        if (mountedRef.current) setData(res.products);
      } else if (fnName.includes("orders") || fnName.includes("getMyOrders")) {
        const res = await neonApi.orders();
        if (mountedRef.current) setData(res.orders);
      } else if (fnName.includes("notifications")) {
        const res = await neonApi.notifications();
        if (mountedRef.current) {
          if (fnName.includes("unreadCount")) {
            setData((res.notifications ?? []).filter((n: any) => !n.read_at).length);
          } else {
            setData(res.notifications);
          }
        }
      } else if (fnName.includes("adminExists")) {
        // No verified Neon endpoint exists for this check yet; never claim an admin exists without proof.
        if (mountedRef.current) setData(null);
      } else if (fnName.includes("admin:users") || fnName.includes("adminUsers")) {
        const res = await neonApi.adminUsers();
        if (mountedRef.current) setData(res.users);
      } else if (fnName.includes("admin:shipments")) {
        const res = await neonApi.adminShipments();
        if (mountedRef.current) setData(res.shipments);
      } else if (fnName.includes("admin:reports") || fnName.includes("adminAnalytics")) {
        const res = await neonApi.adminReports();
        if (mountedRef.current) setData(res);
      } else if (fnName.includes("admin:settings")) {
        const res = await neonApi.adminSettings();
        if (mountedRef.current) setData(res.settings);
      } else if (fnName.includes("tenants")) {
        const res = await neonApi.tenants();
        if (mountedRef.current) setData(res.tenants);
      } else if (fnName.includes("resolveByHost")) {
        if (mountedRef.current) setData({ subdomain: null, tenant: null });
      } else {
        // Do not fabricate empty data for a Convex function without a Neon mapping.
        // Undefined keeps the screen from presenting an unsupported query as a
        // verified empty result while its endpoint is still being migrated.
        console.error(`[NeonClient] unsupported Neon query mapping: ${fnName || "(unknown function)"}`);
        if (mountedRef.current) setData(undefined);
      }
    } catch (e) {
      // API failures are not equivalent to an empty list or a missing record.
      // Preserve an unresolved state and log the failure until the screen has a
      // typed error-state contract.
      console.error(`[NeonClient] query failed for ${fnName}:`, e);
      if (mountedRef.current) setData(undefined);
    }
  }, [fnName, isSkipped, argsKey]);

  useEffect(() => {
    mountedRef.current = true;
    void execute();
    const domain = fnName.split(":")[0] || fnName;
    const unsubscribe = subscribe(domain, () => {
      void execute();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [execute, fnName]);

  return data;
}

export function useMutation(mutationFn: unknown): (...args: any[]) => Promise<any> {
  const fnName = resolveFunctionName(mutationFn);

  return useCallback(
    async (...args: any[]) => {
      const payload = args[0] ?? {};
      try {
        if (fnName.includes("shipments:create") || fnName.includes("createShipment")) {
          const res = await neonApi.createShipment(payload);
          triggerQueryUpdate("shipments");
          triggerQueryUpdate("trackingUser");
          return res.shipment;
        } else if (fnName.includes("shipments:update") || fnName.includes("updateShipment")) {
          const res = await neonApi.updateShipment(payload.id, payload);
          triggerQueryUpdate("shipments");
          triggerQueryUpdate("trackingUser");
          return res.shipment;
        } else if (fnName.includes("orders:create") || fnName.includes("createOrder")) {
          const res = await neonApi.createOrder(payload);
          triggerQueryUpdate("orders");
          triggerQueryUpdate("marketplace");
          return res.order;
        } else if (fnName.includes("notifications:markRead")) {
          const res = await neonApi.markNotificationRead(payload.id);
          triggerQueryUpdate("notifications");
          return res;
        } else if (fnName.includes("admin:updateUser")) {
          const res = await neonApi.updateUser(payload.id, payload);
          triggerQueryUpdate("admin");
          return res.user;
        } else if (fnName.includes("admin:createProduct")) {
          const res = await neonApi.createCatalogProduct(payload);
          triggerQueryUpdate("catalog");
          return res.product;
        } else if (fnName.includes("admin:updateSetting") || fnName.includes("saveBrand") || fnName.includes("saveSupport")) {
          const res = await neonApi.updateAdminSetting(payload.key ?? "brand_config", payload.value ?? payload);
          triggerQueryUpdate("platform");
          triggerQueryUpdate("admin");
          return res;
        } else {
          throw new Error("Unsupported Neon migration mutation: " + (fnName || "(unknown function)") + ". No write was performed.");
        }
      } catch (err) {
        console.error(`[NeonClient] mutation error for ${fnName}:`, err);
        throw err;
      }
    },
    [fnName]
  );
}

export function useAction(actionFn: unknown): (...args: any[]) => Promise<any> {
  return useMutation(actionFn);
}

export function usePaginatedQuery(queryFn: unknown, args: unknown, _options: unknown) {
  const data = useQuery(queryFn, args);
  return {
    results: Array.isArray(data) ? data : [],
    status: "CanLoadMore" as const,
    loadMore: () => {},
    isLoading: data === undefined,
  };
}

export function useConvex() {
  return {
    query: async (fn: unknown, args?: unknown) => {
      const fnName = resolveFunctionName(fn);
      if (fnName.includes("currentUser") || fnName.includes("me")) return neonApi.me();
      if (fnName.includes("publicConfig")) return neonApi.publicConfig();
      return null;
    },
    mutation: async (fn: unknown) => {
      const fnName = resolveFunctionName(fn);
      throw new Error("Unsupported Neon migration mutation: " + (fnName || "(unknown function)") + ". No write was performed.");
    },
    action: async (fn: unknown) => {
      const fnName = resolveFunctionName(fn);
      throw new Error("Unsupported Neon migration action: " + (fnName || "(unknown function)") + ". No action was performed.");
    },
  };
}
