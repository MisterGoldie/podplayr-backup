export const PLAY_COUNT_UPDATED = 'podplayr:play-count';
export const USER_PLAY_RECORDED = 'podplayr:user-play';

export function emitPlayCountUpdate(mediaKey: string, playCount: number) {
  if (typeof window === 'undefined' || !mediaKey) return;
  window.dispatchEvent(
    new CustomEvent(PLAY_COUNT_UPDATED, { detail: { mediaKey, playCount } })
  );
}

export function emitUserPlayRecorded(fid: string | number) {
  if (typeof window === 'undefined') return;
  const id = String(fid);
  if (!id) return;
  window.dispatchEvent(new CustomEvent(USER_PLAY_RECORDED, { detail: { fid: id } }));
}
