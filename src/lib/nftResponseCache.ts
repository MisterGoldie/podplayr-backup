/**
 * Durable cache for the full resolved NFT response from `getNFTMetadata`.
 *
 * The real cost driver behind slow profile loads isn't cover derivation — it's
 * the base Alchemy `getNftMetadata` call (plus the on-chain `uri()` fallback),
 * which was running fresh on *every* enrich request (`playback=1` intentionally
 * sets `no-store`, since a handful of playback URLs — Mux mezzanine links,
 * signed IPFS gateways — do genuinely expire and must stay fresh).
 *
 * This cache stores the whole response, but callers must only read from / write
 * to it when the resolved NFT does NOT still depend on any of those fragile
 * fields (see `nftNeedsChainMediaEnrich` in `nft.ts`) — otherwise we'd durably
 * lock in stale/broken playback URLs.
 *
 * Two tiers, same pattern as `nftCoverCache.ts`:
 *  - In-memory Map: instant, resets on restart / per serverless instance.
 *  - Upstash Redis: durable + shared across instances, when configured.
 */

import type { NFT } from '../types/user';
import { getRedisClient } from './redisClient';

interface CacheEntry {
  nft: NFT;
  cachedAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const MEMORY_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const REDIS_TTL_SECONDS = 60 * 60 * 24; // 24 hours — media is durable, but re-verify daily.

// Bump this whenever the shape of the cached NFT response changes in a way
// that matters to already-cached entries (e.g. new fields like `coverIsVideo`)
// — old keys just age out on their own TTL instead of serving stale shapes.
// v3: animation extraction now also reads OpenSea-shaped `original_animation_url` /
// `display_animation_url`. Entries cached before that resolved with empty media.
const CACHE_SCHEMA_VERSION = 'v3';

function responseCacheKey(contract: string, tokenId: string, network: 'base' | 'ethereum'): string {
  return `PODPLAYR:nft-full:${CACHE_SCHEMA_VERSION}:${network}:${contract.toLowerCase()}:${tokenId.trim()}`;
}

export async function getCachedNftResponse(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum'
): Promise<NFT | null> {
  const key = responseCacheKey(contract, tokenId, network);

  const fromMemory = memoryCache.get(key);
  if (fromMemory && Date.now() - fromMemory.cachedAt < MEMORY_TTL_MS) {
    return fromMemory.nft;
  }

  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const fromRedis = await redis.get<NFT>(key);
    console.log('[podplayr:redis] full-nft GET', { key, hit: !!fromRedis });
    if (fromRedis) {
      memoryCache.set(key, { nft: fromRedis, cachedAt: Date.now() });
      return fromRedis;
    }
  } catch (error) {
    console.warn('[podplayr:redis] full-nft GET failed', { key, error });
  }
  return null;
}

export async function setCachedNftResponse(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum',
  nft: NFT
): Promise<void> {
  const key = responseCacheKey(contract, tokenId, network);
  memoryCache.set(key, { nft, cachedAt: Date.now() });

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, nft, { ex: REDIS_TTL_SECONDS });
    console.log('[podplayr:redis] full-nft SET ok', { key });
  } catch (error) {
    console.warn('[podplayr:redis] full-nft SET failed', { key, error });
  }
}
