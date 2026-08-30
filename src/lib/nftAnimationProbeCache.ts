/**
 * Durable cache for the live-probed verdict on an Alchemy animation cache
 * (see `probeAlchemyCachedAnimationSize`/`probeOriginAnimationContentType`
 * in `nft.ts`).
 *
 * That probe only runs for the rare case where Alchemy's own metadata
 * reports `animation.size`/`contentType` as null (its mirror-upload for a
 * huge file is still in flight) — but tokens stuck in that state also have
 * IPFS/Pinata playback, which makes `getNFTMetadata`'s *overall* response
 * too fragile to durably cache (see `nftNeedsChainMediaEnrich`). Without
 * this, every single play/enrich request would re-run the same two HEAD
 * probes from scratch. Keyed by the stable Alchemy `cachedUrl` (same asset
 * hash every time), independent of the rest of the response's freshness.
 *
 * Same two-tier pattern as `nftCoverCache.ts` / `nftResponseCache.ts`.
 */

import { getRedisClient } from './redisClient';

export interface AnimationProbeVerdict {
  size: number;
  contentType: string | null;
}

const memoryCache = new Map<string, AnimationProbeVerdict>();
const REDIS_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — re-verify occasionally in case the upload finishes.

function probeCacheKey(cachedUrl: string): string {
  return `PODPLAYR:nft-anim-probe:${cachedUrl}`;
}

export async function getCachedAnimationProbe(
  cachedUrl: string
): Promise<AnimationProbeVerdict | null> {
  const key = probeCacheKey(cachedUrl);
  const fromMemory = memoryCache.get(key);
  if (fromMemory) return fromMemory;

  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const fromRedis = await redis.get<AnimationProbeVerdict>(key);
    if (fromRedis) {
      memoryCache.set(key, fromRedis);
      return fromRedis;
    }
  } catch (error) {
    console.warn('[podplayr:redis] anim-probe GET failed', { key, error });
  }
  return null;
}

export async function setCachedAnimationProbe(
  cachedUrl: string,
  verdict: AnimationProbeVerdict
): Promise<void> {
  const key = probeCacheKey(cachedUrl);
  memoryCache.set(key, verdict);

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, verdict, { ex: REDIS_TTL_SECONDS });
  } catch (error) {
    console.warn('[podplayr:redis] anim-probe SET failed', { key, error });
  }
}
