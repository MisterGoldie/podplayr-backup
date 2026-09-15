'use client';

import { getLiveUrl, getNftUrl, getProfileUrl } from './miniapp';

/**
 * Best-effort, never awaited. `keepalive` so the request survives the webview
 * handing focus to the native composer sheet.
 */
function warmNftEmbed(contract: string, tokenId: string): void {
  try {
    void fetch('/api/nft/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, tokenId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Pre-warming is an optimization — a failure here must never block sharing.
  }
}

function postedCastHash(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const cast = (result as { cast?: unknown }).cast;
  if (!cast || typeof cast !== 'object') return null;
  const hash = (cast as { hash?: unknown }).hash;
  return typeof hash === 'string' && /^0x[a-fA-F0-9]{8,128}$/.test(hash) ? hash : null;
}

async function composeCastWithFallback(text: string, url: string): Promise<string | null> {
  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    if (await sdk.isInMiniApp()) {
      const result = await sdk.actions.composeCast({
        text,
        embeds: [url],
      });
      return postedCastHash(result);
    }
  } catch (error) {
    console.error('composeCast failed, falling back to compose URL:', error);
  }

  const composeUrl =
    `https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}` +
    `&embeds[]=${encodeURIComponent(url)}`;
  window.open(composeUrl, '_blank', 'noopener,noreferrer');
  return null;
}

/** Fire-and-forget. Only the Quick Auth subject can be notified. */
function thankForShare(payload: {
  kind: 'nft' | 'profile';
  castHash: string;
  username?: string;
  fid?: number;
  contract?: string;
  tokenId?: string;
}): void {
  void (async () => {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    if (!(await sdk.isInMiniApp())) return;
    const token = sdk.quickAuth.token || (await sdk.quickAuth.getToken()).token;
    if (!token) return;
    await fetch('/api/notifications/share-thanks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
      keepalive: true,
    });
  })().catch(() => {});
}

export async function shareProfileToFarcaster({
  fid,
  username,
}: {
  fid: number;
  username?: string;
}): Promise<void> {
  const url = getProfileUrl(fid);
  const handle = username ? `@${username.replace(/^@/, '')}` : 'this profile';
  const text = `Check out ${handle} on @podplayr`;
  const castHash = await composeCastWithFallback(text, url);
  if (castHash) {
    thankForShare({ kind: 'profile', castHash, fid, username });
  }
}

export async function shareLiveToFarcaster(): Promise<void> {
  const url = getLiveUrl();
  await composeCastWithFallback("We're LIVE on @podplayr", url);
}

export async function shareNftToFarcaster({
  contract,
  tokenId,
  name,
}: {
  contract: string;
  tokenId: string;
  name?: string;
}): Promise<void> {
  // Normalize malformed tokenIds (e.g. "0x0xccf50ef6" → "0xccf50ef6") before
  // encoding into the URL so the deep-link resolver can always find the NFT.
  const cleanTokenId = tokenId.replace(/^(0x){2,}/i, '0x');
  const url = getNftUrl(contract, cleanTokenId);
  // Resolve the NFT server-side now, while the composer is open and the user
  // is typing, so whoever taps the cast gets a warm embed cache instead of the
  // ~12s cold Base/Ethereum race.
  warmNftEmbed(contract, cleanTokenId);
  const title = name ? `"${name}"` : 'this';
  const text = `Check out ${title} on @podplayr`;
  const castHash = await composeCastWithFallback(text, url);
  if (castHash) {
    thankForShare({
      kind: 'nft',
      castHash,
      contract,
      tokenId: cleanTokenId,
    });
  }
}
