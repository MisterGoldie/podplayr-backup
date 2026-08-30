/**
 * Durable cache for resolved NFT cover images.
 *
 * `getNFTMetadata` is called with `no-store` on every enrich request (by
 * design — some playback fields like Mux mezzanine URLs expire and must stay
 * fresh). That means the expensive parts of cover resolution — the on-chain
 * `uri()` read, the OpenSea lookup — were getting redone from scratch on
 * every single card mount, for every user, forever. Once we've resolved a
 * *good* still for a token, that almost never changes, so we remember it here
 * and skip straight to it next time.
 *
 * Two tiers:
 *  - In-memory Map: always active, instant, but resets on server restart /
 *    per serverless instance.
 *  - Upstash Redis (via `KV_REST_API_URL`/`KV_REST_API_TOKEN`): durable across
 *    restarts and shared across instances, when configured. No-ops otherwise.
 */

import { getRedisClient } from './redisClient';

const memoryCache = new Map<string, string>();

const REDIS_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — token media is effectively immutable.

function coverCacheKey(contract: string, tokenId: string, network: 'base' | 'ethereum'): string {
  return `PODPLAYR:nft-cover:${network}:${contract.toLowerCase()}:${tokenId}`;
}

export async function getCachedNftCover(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum'
): Promise<string | null> {
  const key = coverCacheKey(contract, tokenId, network);
  const fromMemory = memoryCache.get(key);
  if (fromMemory) return fromMemory;

  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const fromRedis = await redis.get<string>(key);
    console.log('[podplayr:redis] GET', { key, hit: !!fromRedis });
    if (fromRedis) {
      memoryCache.set(key, fromRedis);
      return fromRedis;
    }
  } catch (error) {
    console.warn('[podplayr:redis] GET failed', { key, error });
  }
  return null;
}

export async function setCachedNftCover(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum',
  imageUrl: string
): Promise<void> {
  if (!imageUrl) return;
  const key = coverCacheKey(contract, tokenId, network);
  memoryCache.set(key, imageUrl);

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, imageUrl, { ex: REDIS_TTL_SECONDS });
    console.log('[podplayr:redis] SET ok', { key });
  } catch (error) {
    console.warn('[podplayr:redis] SET failed', { key, error });
  }
}
