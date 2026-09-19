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
  /** Absolute freshness deadline, shared by Redis and in-memory readers. */
  expiresAt?: number;
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
// v3: Thirdweb `data:application/json;base64` tokenURIs are parsed, so tokens
// previously cached as "not playable" (empty animation_url) must not stick.
// v4: preserve GIF/APNG artwork instead of serving a cached static thumbnail.
const CACHE_SCHEMA_VERSION = 'v4';

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
      // Reading Redis must not restart a fragile result's five-minute lifetime
      // as a fresh one-hour memory hit. Legacy entries get a conservative TTL.
      const expiresAt = fromRedis.expiresAt ?? Date.now() + MISS_MEMORY_TTL_MS;
      if (expiresAt <= Date.now()) return null;
      memoryCache.set(key, {
        nft: fromRedis.nft,
        expiresAt: Math.min(
          expiresAt,
          Date.now() + (fromRedis.nft ? HIT_MEMORY_TTL_MS : MISS_MEMORY_TTL_MS)
        ),
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
  nft: NFT | null,
  /**
   * True when `nft`'s playback still depends on a fragile field (signed Mux
   * mezzanine link, public IPFS gateway) that can start 403ing on its own —
   * see `nftNeedsChainMediaEnrich`. Cached on the miss TTL instead of the
   * hours-long hit TTL so a shared embed keeps retrying instead of locking
   * in a link that plays today and 403s tomorrow.
   */
  fragile = false
): Promise<void> {
  const key = embedCacheKey(contract, tokenId);
  const durable = !!nft && !fragile;
  const redisTtl = durable ? HIT_REDIS_TTL_SECONDS : MISS_REDIS_TTL_SECONDS;
  memoryCache.set(key, {
    nft,
    expiresAt: Date.now() + (durable ? HIT_MEMORY_TTL_MS : MISS_MEMORY_TTL_MS),
  });

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, { nft, expiresAt: Date.now() + redisTtl * 1000 }, { ex: redisTtl });
    console.log('[podplayr:redis] nft-embed SET ok', { key, playable: !!nft, durable });
  } catch (error) {
    console.warn('[podplayr:redis] nft-embed SET failed', { key, error });
  }
}
