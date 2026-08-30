/**
 * Single shared Upstash Redis client for server-side caching (NFT covers,
 * NFT metadata responses, etc). Reads `KV_REST_API_URL`/`KV_REST_API_TOKEN`.
 * Returns null when unconfigured — every caller must treat that as a
 * memory-only fallback, never a hard dependency.
 */

import { Redis } from '@upstash/redis';

let client: Redis | null = null;
let checked = false;

export function getRedisClient(): Redis | null {
  if (!checked) {
    checked = true;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      client = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      console.log('[podplayr:redis] client initialized', { url: process.env.KV_REST_API_URL });
    } else {
      console.log('[podplayr:redis] KV_REST_API_URL/TOKEN missing — durable caches are memory-only');
    }
  }
  return client;
}
