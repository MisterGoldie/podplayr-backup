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

async function composeCastWithFallback(text: string, url: string): Promise<void> {
  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    if (await sdk.isInMiniApp()) {
      await sdk.actions.composeCast({
        text,
        embeds: [url],
      });
      return;
    }
  } catch (error) {
    console.error('composeCast failed, falling back to compose URL:', error);
  }

  const composeUrl =
    `https://farcaster.xyz/~/compose?text=${encodeURIComponent(text)}` +
    `&embeds[]=${encodeURIComponent(url)}`;
  window.open(composeUrl, '_blank', 'noopener,noreferrer');
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
  await composeCastWithFallback(text, url);
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
  await composeCastWithFallback(text, url);
}
