export const LIVE_NOTIFY_TITLE = 'PODPLAYR is live';
export const LIVE_NOTIFY_BODY = 'Tap to watch the livestream now.';

export function fidsToNotify(storedFids: number[]): number[] {
  return storedFids.filter((fid) => Number.isInteger(fid) && fid > 0);
}
