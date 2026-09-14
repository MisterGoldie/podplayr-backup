'use client';

import { idbGetJson, idbRemove, idbSetJson } from './idbCache';

/**
 * Shared IndexedDB-backed cache of the current user's liked mediaKeys.
 * Used by both Demo.tsx (write-through whenever likedNFTs changes) and
 * UserDataLoader.tsx (read to stamp isLikedCached on freshly fetched NFTs
 * before the real liked-NFTs list has loaded). Previously this was two
 * separate localStorage.getItem('podplayr_liked_media_keys') call sites —
 * centralizing means one cache, one key, no drift.
 */
const LIKED_MEDIA_KEYS_CACHE_KEY = 'podplayr_liked_media_keys';

export async function getLikedMediaKeysCache(): Promise<string[]> {
  try {
    const keys = await idbGetJson<string[]>(LIKED_MEDIA_KEYS_CACHE_KEY);
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}

export async function setLikedMediaKeysCache(mediaKeys: string[]): Promise<void> {
  try {
    await idbSetJson(LIKED_MEDIA_KEYS_CACHE_KEY, mediaKeys);
  } catch {
    // Ignore quota / private-mode failures
  }
}

export async function clearLikedMediaKeysCache(): Promise<void> {
  await idbRemove(LIKED_MEDIA_KEYS_CACHE_KEY);
}
