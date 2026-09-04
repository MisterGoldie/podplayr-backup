import type { DocumentData } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import type { NFT } from '../../types/nft';
import { getMediaKey } from '../../utils/media';
import {
  getNftPlaybackPlan,
  hydrateNftPlayback,
  restoreStoredAnimationUrl,
  getCachedMediaMime,
} from '../../utils/isMediaNFT';
import { firebaseLogger } from './config';

/** Playback fields persisted on play/like docs (legacy docs may omit these). */
export const playbackFieldsForStore = (nft: NFT) => {
  const plan = getNftPlaybackPlan(nft);
  const animationUrl = nft.metadata?.animation_url || plan.videoUrl || '';
  return {
    videoUrl: plan.videoUrl || nft.videoUrl || '',
    animationUrl,
    isVideo: plan.mode !== 'audio-only',
    playbackMode: plan.mode,
    mediaMime: (nft.metadata as { mimeType?: string; mime_type?: string } | undefined)?.mimeType
      || (nft.metadata as { mimeType?: string; mime_type?: string } | undefined)?.mime_type
      || getCachedMediaMime(nft.audio || nft.videoUrl || nft.metadata?.animation_url)
      || '',
  };
};

/** Reconstruct NFT playback fields from a Firebase play/like document. */
export const nftFromPlayRecord = (data: DocumentData): NFT => {
  const nested = data.nft && typeof data.nft === 'object' ? data.nft : {};
  const audioUrl = data.audioUrl || nested.audio || data.audio || '';
  const animationUrl = restoreStoredAnimationUrl({
    ...data,
    animationUrl: data.animationUrl || nested.metadata?.animation_url || nested.animationUrl,
    metadata: {
      ...(nested.metadata || {}),
      ...(data.metadata || {}),
    },
    isVideo: data.isVideo ?? nested.isVideo,
    playbackMode: data.playbackMode || nested.playbackMode,
    videoUrl: data.videoUrl || nested.videoUrl,
    audioUrl,
  });
  const collectionName =
    typeof data.collection === 'string'
      ? data.collection
      : data.collection?.name || nested.collection?.name || 'Unknown Collection';

  const nft: NFT = {
    contract: data.nftContract || data.contract || nested.contract,
    tokenId: data.tokenId || nested.tokenId,
    name: data.name || nested.name || 'Untitled NFT',
    description: data.description || nested.description || '',
    image: data.image || data.imageUrl || nested.image || '',
    audio: audioUrl,
    videoUrl: data.videoUrl || nested.videoUrl || undefined,
    isVideo: Boolean(data.isVideo ?? nested.isVideo),
    playbackMode: data.playbackMode || nested.playbackMode,
    hasValidAudio: Boolean(audioUrl || animationUrl),
    metadata: {
      name: data.name || nested.name || 'Untitled NFT',
      description: data.description || nested.description || '',
      image: data.image || data.imageUrl || nested.image || '',
      ...(nested.metadata || {}),
      ...(data.metadata || {}),
      animation_url: animationUrl || data.metadata?.animation_url || nested.metadata?.animation_url || undefined,
      ...(data.mediaMime ? { mimeType: data.mediaMime } : {}),
    } as NFT['metadata'],
    collection: {
      name: collectionName,
    },
    network: data.network || nested.network,
    mediaKey: undefined,
  };
  const hydrated = hydrateNftPlayback(nft);
  hydrated.mediaKey = getMediaKey(hydrated) || data.mediaKey;
  return hydrated;
};

const callCache = new Map<string, Promise<unknown>>();
const CACHE_DURATION = 1000;

export function deduplicateCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (callCache.has(key)) {
    return callCache.get(key) as Promise<T>;
  }

  const promise = fn();
  callCache.set(key, promise);
  setTimeout(() => callCache.delete(key), CACHE_DURATION);
  return promise;
}

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Monolith fetch retry: 10s abort, 429/5xx backoff. Used by follows and NFT fetch. */
export const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3): Promise<Response> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const enhancedOptions = {
        ...options,
        signal: controller.signal
      };

      const response = await fetch(url, enhancedOptions);
      clearTimeout(timeoutId);

      if (response.status === 429) {
        const waitTime = Math.pow(2, i) * 1000;
        firebaseLogger.info(`Rate limited, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }

      if (response.status >= 500) {
        firebaseLogger.warn(`Server error ${response.status} from ${url}, retry ${i + 1}/${maxRetries}`);
        await delay(Math.pow(2, i) * 1000);
        continue;
      }

      return response;
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (error instanceof TypeError && err.message?.includes('fetch')) {
        firebaseLogger.warn(`Network error on attempt ${i + 1}/${maxRetries}: ${err.message}`);
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          firebaseLogger.error('Device appears to be offline');
        }
      } else if (err.name === 'AbortError') {
        firebaseLogger.warn(`Request timeout on attempt ${i + 1}/${maxRetries}`);
      } else {
        firebaseLogger.error(`Fetch attempt ${i + 1} failed:`, error);
      }

      if (i === maxRetries - 1) throw error;
      await delay(Math.pow(2, i) * 1000);
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
};

export function buildPlayRecord(nft: NFT, fid: number, mediaKey: string, audioUrl: string) {
  const playbackStore = playbackFieldsForStore(nft);
  return {
    fid,
    mediaKey,
    nftContract: nft.contract,
    tokenId: nft.tokenId,
    name: nft.name || 'Untitled',
    description: nft.description || nft.metadata?.description || '',
    image: nft.image || nft.metadata?.image || '',
    audioUrl,
    videoUrl: playbackStore.videoUrl || '',
    animationUrl: playbackStore.animationUrl || '',
    isVideo: playbackStore.isVideo,
    playbackMode: playbackStore.playbackMode,
    mediaMime: playbackStore.mediaMime || '',
    collection: nft.collection?.name || 'Unknown Collection',
    network: nft.network || 'base',
    timestamp: Timestamp.now(),
    timestampMs: Date.now(),
  };
}

export function playTimestampMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
