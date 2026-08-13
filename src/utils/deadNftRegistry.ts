import type { NFT } from '../types/user';
import { getMediaKey } from './media';

/**
 * Tracks NFTs whose media has been confirmed unreachable after every fallback
 * (gateways, retries, last-resort URLs) has already been exhausted elsewhere
 * in the app (see NFTImage.tsx and useAudioPlayer.ts). This is a passive
 * registry — nothing here makes network requests itself, it only remembers
 * failures other code already proved are real, so we never mark something
 * dead from a single transient blip.
 */

const STORAGE_KEY = 'podplayr_dead_nft_media_v1';
const DEAD_EVENT = 'podplayr:nft-media-dead';

type DeadReason = 'image' | 'audio';
type DeadRecord = { image?: boolean; audio?: boolean; markedAt: number };

const store = new Map<string, DeadRecord>();
let hydrated = false;

const hydrate = (): void => {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, DeadRecord>;
    Object.entries(parsed).forEach(([key, record]) => store.set(key, record));
  } catch {
    // Corrupt or unavailable storage — just start fresh for this session
  }
};

const persist = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, DeadRecord> = {};
    store.forEach((record, key) => {
      obj[key] = record;
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Storage full/unavailable — in-memory tracking still works for this session
  }
};

type MediaKeyable = Pick<NFT, 'contract' | 'tokenId'>;

/** Record that this NFT's image (or audio/video) is confirmed unreachable. */
export const markNftMediaDead = (nft: MediaKeyable | null | undefined, reason: DeadReason): void => {
  if (!nft?.contract || !nft?.tokenId) return;
  hydrate();

  const key = getMediaKey(nft as NFT);
  const existing = store.get(key) || { markedAt: Date.now() };
  existing[reason] = true;
  existing.markedAt = Date.now();
  store.set(key, existing);
  persist();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DEAD_EVENT, { detail: { mediaKey: key } }));
  }
};

/**
 * True once this NFT's playable media (audio/video) is confirmed dead.
 * Audio/video is the app's core function — a broken thumbnail alone already
 * falls back to a placeholder image and isn't reason enough to hide the card.
 */
export const isNftMediaDead = (nft: MediaKeyable | null | undefined): boolean => {
  if (!nft?.contract || !nft?.tokenId) return false;
  hydrate();
  const record = store.get(getMediaKey(nft as NFT));
  return !!record?.audio;
};

/** Subscribe to live dead-media marks so already-rendered lists can prune immediately. */
export const subscribeToDeadNftUpdates = (callback: (mediaKey: string) => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ mediaKey: string }>).detail;
    if (detail?.mediaKey) callback(detail.mediaKey);
  };
  window.addEventListener(DEAD_EVENT, handler);
  return () => window.removeEventListener(DEAD_EVENT, handler);
};
