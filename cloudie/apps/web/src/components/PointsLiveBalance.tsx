"use client";
import { usePointsStream } from "@/hooks/usePointsStream";
import { Wallet } from "lucide-react";
export function PointsLiveBalance({ initialBalance }: { initialBalance: number }) {
  const balance = usePointsStream(initialBalance);
  return <div aria-live="polite" aria-label={`Available points: ${balance.toLocaleString()}`} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5"><span className="grid size-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Wallet size={18}/></span><span><span className="block text-[11px] text-[var(--muted)]">Available points</span><strong className="block font-mono text-lg tabular-nums">{balance.toLocaleString()}</strong></span></div>;
}
