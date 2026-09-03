'use client';

import { getNftUrl, getProfileUrl } from './miniapp';

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
  const title = name ? `"${name}"` : 'this';
  const text = `Check out ${title} on @podplayr`;
  await composeCastWithFallback(text, url);
}
