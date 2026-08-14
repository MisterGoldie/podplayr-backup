'use client';

import { getProfileUrl } from './miniapp';

export async function shareProfileToFarcaster({
  fid,
  username,
}: {
  fid: number;
  username?: string;
}): Promise<void> {
  const url = getProfileUrl(fid);
  const handle = username ? `@${username.replace(/^@/, '')}` : 'this profile';
  const text = `Check out ${handle} on PODPLAYR`;

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
