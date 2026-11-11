/**
 * Client-side projection of the Turso-backed platform.
 *
 * This module is a read cache, not a store of record: it holds the last snapshot
 * returned by `/api/platform/bootstrap` and notifies React when that snapshot is
 * replaced. Points balances, ledger entries and sessions live in the database —
 * nothing financial is read from or written to LocalStorage any more.
 */

import type { EventBusMessage, User } from "./model";

export type Database = {
  version: number;
  users: User[];
  sessions: import("./model").Session[];
  ledger: import("./model").LedgerEntry[];
  shipments: import("./model").Shipment[];
  documents: import("./model").TravelDocument[];
  campaigns: import("./model").Campaign[];
  sites: import("./model").TenantSite[];
  orders: import("./model").Order[];
  messages: import("./model").ChatMessage[];
  notifications: import("./model").Notification[];
  settings: import("./model").Settings;
};

export function emptyDatabase(): Database {
  return {
    version: 1,
    users: [],
    sessions: [],
    ledger: [],
    shipments: [],
    documents: [],
    campaigns: [],
    sites: [],
    orders: [],
    messages: [],
    notifications: [],
    settings: { brandName: "Cloudie", supportEmail: "desk@cloudie.africa", usdRate: 1650 },
  };
}

let snapshot: Database = emptyDatabase();
let currentUser: User | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRevision(): string {
  return String(revision);
}

export function readDatabase(): Database {
  return snapshot;
}

/** Replaces the cached projection with a fresh server snapshot. */
export function replaceDatabase(db: Database) {
  snapshot = db;
  revision += 1;
  notify();
}

export function setCurrentUser(user: User | null) {
  currentUser = user;
  revision += 1;
  notify();
}

export function activeUser(): User | null {
  return currentUser;
}

/** Clears the projection after sign-out or a 401 from the API. */
export function clearSession() {
  snapshot = emptyDatabase();
  currentUser = null;
  revision += 1;
  notify();
}

/* ── Lightweight in-app event channel (toasts for committed actions) ─────── */

const localEvents: EventBusMessage[] = [];
const eventListeners = new Set<(message: EventBusMessage) => void>();

export function emitEvent(message: EventBusMessage) {
  localEvents.push(message);
  if (localEvents.length > 40) localEvents.shift();
  eventListeners.forEach((listener) => listener(message));
}

export function onRealtimeEvent(listener: (message: EventBusMessage) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function recentEvents(limit = 6): EventBusMessage[] {
  return localEvents.slice(-limit).reverse();
}

export function uid(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export type TransactionResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };
