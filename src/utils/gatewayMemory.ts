/**
 * Remembers which gateway URL actually worked for a given piece of NFT media,
 * so repeat plays/views skip straight past dead/slow gateways instead of
 * re-doing the same trial-and-error fallback cascade every time.
 *
 * Keyed by mediaKey (content identity) rather than contract/tokenId, so it
 * naturally applies across duplicate mints and reconstructed NFT objects.
 */

const STORAGE_KEY = 'podplayr:gatewayMemory:v1';
const MAX_ENTRIES = 500;

type MediaType = 'image' | 'audio' | 'video';

interface MemoryEntry {
  url: string;
  ts: number;
}

type MemoryStore = Record<string, MemoryEntry>;

const buildKey = (mediaKey: string, mediaType: MediaType): string => `${mediaType}:${mediaKey}`;

const readStore = (): MemoryStore => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: MemoryStore) => {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(store);
    // Evict oldest entries once we exceed the cap so this can't grow unbounded.
    const trimmed = entries.length > MAX_ENTRIES
      ? entries.sort((a, b) => b[1].ts - a[1].ts).slice(0, MAX_ENTRIES)
      : entries;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Ignore quota/serialization errors — this is a best-effort optimization.
  }
};

/** Record that `url` successfully loaded for this piece of media. */
export const rememberWorkingMediaUrl = (mediaKey: string, mediaType: MediaType, url: string): void => {
  if (!mediaKey || !url) return;
  const store = readStore();
  store[buildKey(mediaKey, mediaType)] = { url, ts: Date.now() };
  writeStore(store);
};

/** Get the last known-good URL for this piece of media, if any. */
export const getRememberedMediaUrl = (mediaKey: string, mediaType: MediaType): string | null => {
  if (!mediaKey) return null;
  const store = readStore();
  return store[buildKey(mediaKey, mediaType)]?.url ?? null;
};

/** Forget a remembered URL — call this once a previously-working gateway starts failing. */
export const forgetMediaUrl = (mediaKey: string, mediaType: MediaType): void => {
  if (!mediaKey) return;
  const store = readStore();
  const key = buildKey(mediaKey, mediaType);
  if (key in store) {
    delete store[key];
    writeStore(store);
  }
};

/**
 * Move a remembered URL to the front of a candidate list (if present, or by
 * prepending it), de-duplicating. Use this when building fallback URL lists
 * so previously-successful gateways are always tried first.
 */
export const prioritizeRememberedUrl = (
  mediaKey: string,
  mediaType: MediaType,
  candidates: string[]
): string[] => {
  const remembered = getRememberedMediaUrl(mediaKey, mediaType);
  if (!remembered) return candidates;
  const rest = candidates.filter((url) => url !== remembered);
  return [remembered, ...rest];
};
