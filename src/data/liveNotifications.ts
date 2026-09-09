/**
 * Go-live Farcaster notifications.
 * Keep this list populated while testing so we never blast everyone.
 * Empty it to notify every FID that has a stored notification token.
 */
export const LIVE_NOTIFY_TEST_FIDS: number[] = [7472];

export const LIVE_NOTIFY_TITLE = 'PODPLAYR is live';
export const LIVE_NOTIFY_BODY = 'Tap to watch the livestream now.';

export const LIVE_TEST_NOTIFY_TITLE = 'PODPLAYR test ping';
export const LIVE_TEST_NOTIFY_BODY = 'Notifications work. Tap to open.';

export function fidsToNotify(storedFids: number[]): number[] {
  if (LIVE_NOTIFY_TEST_FIDS.length > 0) return [...LIVE_NOTIFY_TEST_FIDS];
  return storedFids.filter((fid) => Number.isInteger(fid) && fid > 0);
}
