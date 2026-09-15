export const SHARE_THANKS_TITLE = 'Thank you';

export type ShareThanksKind = 'nft' | 'profile';

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1))}…`;
}

export function shareThanksProfileLabel(username?: string): string | undefined {
  if (!username) return undefined;
  const cleaned = clip(username.replace(/^@/, ''), 32);
  return cleaned ? `@${cleaned}` : undefined;
}

export function shareThanksBody(kind: ShareThanksKind, label?: string): string {
  if (kind === 'nft') {
    return 'Thanks for sharing an NFT to the Farcaster feed.';
  }
  return label
    ? `Thanks for sharing ${label} to the Farcaster feed.`
    : 'Thanks for sharing this profile to the Farcaster feed.';
}
