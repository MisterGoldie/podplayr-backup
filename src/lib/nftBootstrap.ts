import type { NFT } from '../types/user';

/** Inline JSON on `/nft/{contract}/{tokenId}` so the client can skip a second Alchemy round-trip. */
export const NFT_BOOTSTRAP_SCRIPT_ID = 'podplayr-nft-bootstrap';

export function serializeNftBootstrap(nft: NFT): string {
  return JSON.stringify(nft).replace(/</g, '\\u003c');
}

export function readNftBootstrap(): NFT | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(NFT_BOOTSTRAP_SCRIPT_ID);
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as NFT;
    if (!parsed?.contract || parsed.tokenId === undefined || parsed.tokenId === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** First non-null win; remaining promises are ignored. */
export function firstNonNull<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  if (promises.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;
    const onValue = (value: T | null) => {
      if (settled) return;
      if (value != null) {
        settled = true;
        resolve(value);
        return;
      }
      pending -= 1;
      if (pending === 0) resolve(null);
    };
    for (const p of promises) {
      p.then(onValue, () => onValue(null));
    }
  });
}
