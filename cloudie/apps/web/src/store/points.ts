"use client";
import { create } from "zustand";
export type PointsUpdate = { balance: number; delta: number; description: string; ledgerId: string };
type PointsState = { balance: number; revision: number; setBalance: (balance: number) => void; applyUpdate: (event: PointsUpdate) => void };
export const usePointsStore = create<PointsState>((set) => ({ balance: 0, revision: 0, setBalance: (balance) => set({ balance }), applyUpdate: (event) => set((state) => ({ balance: event.balance, revision: state.revision + 1 })) }));
