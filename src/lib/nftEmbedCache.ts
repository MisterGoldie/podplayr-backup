/**
 * Durable cache for the *resolved* embed/deep-link NFT.
 *
 * `resolvePlayableNftForEmbed` blocks the HTML of `/nft/{contract}/{tokenId}`,
 * and it races Base and Ethereum because the URL doesn't carry a network. Even
 * when `nftResponseCache` has the winning chain warm, the losing chain still
 * pays a full Alchemy round-trip every single time, and `getNFTMetadata` fires
 * its `_animation` HEAD probes before it will hand back even a cached response.
 * A shared cast therefore paid that cost on every open.
 *
 * Caching the final verdict (which NFT, or "nothing playable here") skips both
 * chains entirely on a warm hit. Misses are cached too, on a much shorter TTL,
 * so a bogus or non-media URL can't hammer Alchemy twice per request.
 *
 * TTLs are deliberately shorter than `nftResponseCache`'s 24h: some playback
 * URLs genuinely expire (Mux mezzanine links, signed IPFS gateways), and this
 * value is what the client bootstraps playback from.
 *
 * Two tiers, same pattern as `nftResponseCache.ts` / `nftCoverCache.ts`:
 *  - In-memory Map: instant, resets on restart / per serverless instance.
 *  - Upstash Redis: durable + shared across instances, when configured.
 */

import type { NFT } from '../types/user';
import { getRedisClient } from './redisClient';

/** `nft: null` is a real, cacheable answer: "this token has no playable media". */
interface EmbedEntry {
  nft: NFT | null;
}

interface MemoryEntry extends EmbedEntry {
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryEntry>();

const HIT_MEMORY_TTL_MS = 1000 * 60 * 60; // 1 hour
const MISS_MEMORY_TTL_MS = 1000 * 60 * 5; // 5 minutes
const HIT_REDIS_TTL_SECONDS = 60 * 60 * 6; // 6 hours
const MISS_REDIS_TTL_SECONDS = 60 * 5; // 5 minutes

/** Bump when the resolved shape changes so old entries age out instead of serving stale. */
const CACHE_SCHEMA_VERSION = 'v1';

function embedCacheKey(contract: string, tokenId: string): string {
  return `PODPLAYR:nft-embed:${CACHE_SCHEMA_VERSION}:${contract.toLowerCase()}:${tokenId.trim()}`;
}

/** `null` = nothing cached. `{ nft: null }` = cached "not playable". */
export async function getCachedEmbedNft(
  contract: string,
  tokenId: string
): Promise<EmbedEntry | null> {
  const key = embedCacheKey(contract, tokenId);

  const fromMemory = memoryCache.get(key);
  if (fromMemory) {
    if (Date.now() < fromMemory.expiresAt) return { nft: fromMemory.nft };
    memoryCache.delete(key);
  }

  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const fromRedis = await redis.get<EmbedEntry>(key);
    console.log('[podplayr:redis] nft-embed GET', {
      key,
      hit: !!fromRedis,
      playable: !!fromRedis?.nft,
    });
    if (fromRedis) {
      memoryCache.set(key, {
        nft: fromRedis.nft,
        expiresAt: Date.now() + (fromRedis.nft ? HIT_MEMORY_TTL_MS : MISS_MEMORY_TTL_MS),
      });
      return fromRedis;
    }
  } catch (error) {
    console.warn('[podplayr:redis] nft-embed GET failed', { key, error });
  }
  return null;
}

export async function setCachedEmbedNft(
  contract: string,
  tokenId: string,
  nft: NFT | null
): Promise<void> {
  const key = embedCacheKey(contract, tokenId);
  memoryCache.set(key, {
    nft,
    expiresAt: Date.now() + (nft ? HIT_MEMORY_TTL_MS : MISS_MEMORY_TTL_MS),
  });

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, { nft }, { ex: nft ? HIT_REDIS_TTL_SECONDS : MISS_REDIS_TTL_SECONDS });
    console.log('[podplayr:redis] nft-embed SET ok', { key, playable: !!nft });
  } catch (error) {
    console.warn('[podplayr:redis] nft-embed SET failed', { key, error });
  }
}
