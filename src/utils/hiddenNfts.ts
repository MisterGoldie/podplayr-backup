'use client';

import type { NFT } from '../types/user';

/**
 * Viewer-local hide list for spam / junk that still has playable media.
 * Stored per browser; does not affect likes or other users.
 */

const STORAGE_KEY = 'podplayr_hidden_nfts_v1';
const HIDDEN_EVENT = 'podplayr:nft-hidden';

type HiddenRecord = { contract: string; tokenId: string; hiddenAt: number };

const store = new Map<string, HiddenRecord>();
let hydrated = false;

const tokenKey = (contract: string, tokenId: string): string =>
  `${contract.toLowerCase()}:${String(tokenId).replace(/^0x/, '')}`;

const hydrate = (): void => {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, HiddenRecord>;
    Object.entries(parsed).forEach(([key, record]) => {
      if (record?.contract && record?.tokenId) store.set(key, record);
    });
  } catch {
    // ignore
  }
};

const persist = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, HiddenRecord> = {};
    store.forEach((record, key) => {
      obj[key] = record;
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
};

const notify = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(HIDDEN_EVENT));
  }
};

export const isNftHidden = (nft: Pick<NFT, 'contract' | 'tokenId'> | null | undefined): boolean => {
  if (!nft?.contract || nft.tokenId === undefined || nft.tokenId === null) return false;
  hydrate();
  return store.has(tokenKey(nft.contract, String(nft.tokenId)));
};

export const hideNft = (nft: Pick<NFT, 'contract' | 'tokenId'> | null | undefined): void => {
  if (!nft?.contract || nft.tokenId === undefined || nft.tokenId === null) return;
  hydrate();
  const tokenId = String(nft.tokenId).replace(/^0x/, '');
  store.set(tokenKey(nft.contract, tokenId), {
    contract: nft.contract.toLowerCase(),
    tokenId,
    hiddenAt: Date.now(),
  });
  persist();
  notify();
};

export const unhideNft = (nft: Pick<NFT, 'contract' | 'tokenId'> | null | undefined): void => {
  if (!nft?.contract || nft.tokenId === undefined || nft.tokenId === null) return;
  hydrate();
  store.delete(tokenKey(nft.contract, String(nft.tokenId)));
  persist();
  notify();
};

export const clearHiddenNfts = (): void => {
  hydrate();
  store.clear();
  persist();
  notify();
};

export const getHiddenNftCount = (): number => {
  hydrate();
  return store.size;
};

export const subscribeToHiddenNfts = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(HIDDEN_EVENT, callback);
  return () => window.removeEventListener(HIDDEN_EVENT, callback);
};
