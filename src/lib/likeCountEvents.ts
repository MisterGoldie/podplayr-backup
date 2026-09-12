export const LIKE_COUNT_BUMP = 'podplayr:like-count-bump';

/**
 * Relative nudge applied the instant a heart is tapped.
 *
 * The heart icon itself is already optimistic in Demo, but the *number* in
 * InfoPanel only moved when the `global_likes` snapshot came back after
 * `toggleLikeNFT`'s multi-read batch — so the icon and the count visibly
 * disagreed for a beat. This lets every mounted listener for the same
 * mediaKey move together, including panels that didn't originate the tap.
 *
 * Pass a negative delta to undo the guess if the write fails.
 */
export function emitLikeCountBump(mediaKey: string, delta: number) {
  if (typeof window === 'undefined' || !mediaKey || !delta) return;
  window.dispatchEvent(
    new CustomEvent(LIKE_COUNT_BUMP, { detail: { mediaKey, delta } })
  );
}
