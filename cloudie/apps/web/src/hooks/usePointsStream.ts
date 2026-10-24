"use client";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { usePointsStore, type PointsUpdate } from "@/store/points";

export function usePointsStream(initialBalance: number): number {
  const balance = usePointsStore((state) => state.balance);
  const revision = usePointsStore((state) => state.revision);
  const setBalance = usePointsStore((state) => state.setBalance);
  const applyUpdate = usePointsStore((state) => state.applyUpdate);
  useEffect(() => {
    setBalance(initialBalance);
    let socket: Socket | undefined;
    let source: EventSource | undefined;
    let disposed = false;
    async function connect(): Promise<void> {
      try {
        const response = await fetch("/api/session-token", { cache: "no-store" });
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (typeof result !== "object" || result === null || !("data" in result) || typeof result.data !== "object" || result.data === null || !("token" in result.data) || typeof result.data.token !== "string") return;
        const token = result.data.token;
        if (disposed) return;
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
        socket = io(apiUrl, { auth: { token }, transports: ["websocket", "polling"], reconnection: true, timeout: 5000 });
        socket.on("points:update", (event: PointsUpdate) => { applyUpdate(event); toast.success(`+${event.delta > 0 ? "" : ""}${event.delta} points`, { description: event.description }); });
        socket.on("connect_error", () => {
          if (source || disposed) return;
          source = new EventSource(`${apiUrl}/api/v1/stream/points?token=${encodeURIComponent(token)}`);
          source.addEventListener("points:update", (message: MessageEvent<string>) => {
            try { const parsed: unknown = JSON.parse(message.data); if (typeof parsed === "object" && parsed !== null && "balance" in parsed && "delta" in parsed && "description" in parsed && "ledgerId" in parsed && typeof parsed.balance === "number" && typeof parsed.delta === "number" && typeof parsed.description === "string" && typeof parsed.ledgerId === "string") applyUpdate(parsed as PointsUpdate); } catch { /* Ignore malformed stream payloads. */ }
          });
        });
      } catch { /* Keep the last known balance visible while offline. */ }
    }
    void connect();
    return () => { disposed = true; socket?.disconnect(); source?.close(); };
  }, [initialBalance, setBalance, applyUpdate]);
  return revision === 0 ? initialBalance : balance;
}
