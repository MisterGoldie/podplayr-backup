'use client';

/**
 * Tiny in-memory, on-screen debug log. Mobile Farcaster/Base webviews give us
 * no console access, so when something only breaks there we need a visual
 * way to see what happened — this lets any code path push a line and any
 * component render the trail with <DebugLogPanel scope="..." />.
 */

export interface DebugEntry {
  id: number;
  time: string;
  scope: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 300;
const store = new Map<string, DebugEntry[]>();
const listeners = new Map<string, Set<() => void>>();
let nextId = 1;

function notify(scope: string) {
  listeners.get(scope)?.forEach((fn) => fn());
}

export function pushDebugLog(scope: string, message: string, data?: unknown): void {
  const entry: DebugEntry = {
    id: nextId++,
    time: new Date().toLocaleTimeString(undefined, { hour12: false }),
    scope,
    message,
    data,
  };
  const list = store.get(scope) ?? [];
  list.push(entry);
  if (list.length > MAX_ENTRIES) list.shift();
  store.set(scope, list);
  notify(scope);
}

export function getDebugLog(scope: string): DebugEntry[] {
  return store.get(scope) ?? [];
}

export function subscribeDebugLog(scope: string, cb: () => void): () => void {
  const set = listeners.get(scope) ?? new Set<() => void>();
  set.add(cb);
  listeners.set(scope, set);
  return () => set.delete(cb);
}

export function clearDebugLog(scope: string): void {
  store.set(scope, []);
  notify(scope);
}
