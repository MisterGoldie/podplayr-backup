export const SHARE_THANKS_TITLE = 'Thank you';

export type ShareThanksKind = 'nft' | 'profile';

/** Farcaster Mini App notification body max. */
const NOTIFY_BODY_MAX = 128;
const PROFILE_PREFIX = 'Thanks for sharing ';
const PROFILE_SUFFIX = ' to the Farcaster feed.';

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (max <= 0 || !trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  if (max === 1) return '…';
  return `${trimmed.slice(0, max - 1)}…`;
}

export function shareThanksProfileLabel(username?: string): string | undefined {
  if (!username) return undefined;
  const handle = username.replace(/^@/, '').replace(/\s+/g, ' ').trim();
  return handle ? `@${handle}` : undefined;
}

export function shareThanksBody(kind: ShareThanksKind, label?: string): string {
  if (kind === 'nft') {
    return 'Thanks for sharing an NFT to the Farcaster feed.';
  }
  if (!label) {
    return 'Thanks for sharing this profile to the Farcaster feed.';
  }
  // Keep the sentence intact: shorten @username with an ellipsis if needed,
  // never slice the body mid-word at the 128-char cap.
  const budget = NOTIFY_BODY_MAX - PROFILE_PREFIX.length - PROFILE_SUFFIX.length;
  return `${PROFILE_PREFIX}${clip(label, budget)}${PROFILE_SUFFIX}`;
}
