import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { activeUser, getRevision, onRealtimeEvent, readDatabase, subscribe } from "./store";
import { hydrate } from "./engine";
import type { Database } from "./store";
import type { User } from "./model";

type Theme = "light" | "dark";

type PlatformValue = {
  db: Database;
  user: User | null;
  theme: Theme;
  toggleTheme: () => void;
  unread: number;
  /** False until the first server snapshot has loaded. */
  ready: boolean;
  /** Re-reads the authoritative snapshot from the API. */
  refresh: () => Promise<void>;
};

const PlatformContext = createContext<PlatformValue | null>(null);

const THEME_KEY = "cloudie.theme.v1";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribe, getRevision, () => "0");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* storage blocked */
    }
    return "dark";
  });
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await hydrate();
    } catch {
      // A network failure keeps the last snapshot; the shell still renders.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked */
    }
  }, [theme]);

  useEffect(
    () =>
      onRealtimeEvent((message) => {
        toast(message.summary, { description: "Live update" });
      }),
    [],
  );

  const db = readDatabase();
  const user = activeUser();
  const unread = user ? db.notifications.filter((item) => item.userId === user.id && !item.read).length : 0;

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<PlatformValue>(
    () => ({ db, user, theme, toggleTheme, unread, ready, refresh }),
    [db, user, theme, toggleTheme, unread, ready, refresh],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformValue {
  const context = useContext(PlatformContext);
  if (!context) throw new Error("usePlatform must be used inside PlatformProvider");
  return context;
}

/** Scoped selectors keep pages readable. */
export function useCurrentUser(): User | null {
  return usePlatform().user;
}
