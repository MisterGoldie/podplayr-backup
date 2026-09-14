/**
 * Tiny key-value cache backed by IndexedDB.
 *
 * Deliberately not marked 'use client'. isMediaNFT.ts imports this lazily and
 * is itself reachable from server API routes via lib/nft.ts, so a client
 * boundary here would make those server bundles reference a client module for
 * no reason. Every function already no-ops without `window`, which makes the
 * module safe to evaluate anywhere.
 *
 * Farcaster's WKWebView blocks localStorage/sessionStorage for embedded
 * mini-apps under Intelligent Tracking Prevention — every read silently
 * returns null and every write silently no-ops. IndexedDB is NOT subject
 * to that restriction, so it's the only persistent client cache that
 * actually survives across sessions on mobile. This is a thin wrapper:
 * one database, one object store, get/set/remove by string key. Values
 * are stored as-is (structured clone) — no JSON.stringify needed.
 *
 * Every method resolves to a safe fallback (null / void) instead of
 * throwing — private browsing, disabled storage, or a browser without
 * IndexedDB support degrades to "no cache", never breaks the caller.
 */

const DB_NAME = 'podplayr-cache';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbRemove(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * JSON-serializing variants — use these for anything holding NFT objects.
 *
 * IndexedDB stores values via structured clone, which throws DataCloneError
 * on non-cloneable values. NFT carries `lastPlayed?: any` and `timestamp?: any`
 * (Firestore Timestamp instances), so a raw put() is not provably safe. Since
 * every cache write here is best-effort and swallows errors, such a throw would
 * silently mean the cache never populates at all — the exact silent-failure mode
 * localStorage already had on mobile. These caches all previously round-tripped
 * through JSON.stringify/JSON.parse in localStorage, so doing the same here
 * keeps their serialization semantics byte-for-byte identical and makes the
 * write unconditionally safe.
 */
export async function idbGetJson<T>(key: string): Promise<T | null> {
  const raw = await idbGet<string>(key);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function idbSetJson<T>(key: string, value: T): Promise<void> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return; // Circular / unserializable — skip the write rather than throw.
  }
  await idbSet(key, serialized);
}
