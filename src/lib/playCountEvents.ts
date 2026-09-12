export const PLAY_COUNT_UPDATED = 'podplayr:play-count';
export const PLAY_COUNT_BUMP = 'podplayr:play-count-bump';
export const USER_PLAY_RECORDED = 'podplayr:user-play';

export function emitPlayCountUpdate(mediaKey: string, playCount: number) {
  if (typeof window === 'undefined' || !mediaKey) return;
  window.dispatchEvent(
    new CustomEvent(PLAY_COUNT_UPDATED, { detail: { mediaKey, playCount } })
  );
}

/**
 * Relative nudge for listeners, used the instant the 25% threshold is crossed.
 *
 * `trackNFTPlay` can't report an absolute count until it has finished the
 * legacy fold, three `getDoc`s and the batch commit — five serial round-trips
 * the user shouldn't have to wait on to see the number move. The caller
 * doesn't know the current total, so this carries a delta and lets whoever is
 * displaying the count apply it. Pass a negative delta to undo the guess when
 * the write turns out to have failed.
 */
export function emitPlayCountBump(mediaKey: string, delta: number) {
  if (typeof window === 'undefined' || !mediaKey || !delta) return;
  window.dispatchEvent(
    new CustomEvent(PLAY_COUNT_BUMP, { detail: { mediaKey, delta } })
  );
}

export function emitUserPlayRecorded(fid: string | number) {
  if (typeof window === 'undefined') return;
  const id = String(fid);
  if (!id) return;
  window.dispatchEvent(new CustomEvent(USER_PLAY_RECORDED, { detail: { fid: id } }));
}
