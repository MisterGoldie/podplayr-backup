/**
 * TEMP PLAYBACK DEBUG — remove this file and every `playbackDebug` import
 * after the unplayable-audio issue is fixed.
 *
 * Off for now. Force on: window.__PODPLAYR_PLAYBACK_DEBUG = true
 * Filter DevTools console by: PLAYBACK DEBUG
 */
export const PLAYBACK_DEBUG_ENABLED = false;

const PREFIX = '[PLAYBACK DEBUG — REMOVE]';

declare global {
  interface Window {
    __PODPLAYR_PLAYBACK_DEBUG?: boolean;
  }
}

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__PODPLAYR_PLAYBACK_DEBUG === true) return true;
  if (window.__PODPLAYR_PLAYBACK_DEBUG === false) return false;
  return PLAYBACK_DEBUG_ENABLED;
}

const MEDIA_ERR: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

const NETWORK: Record<number, string> = {
  0: 'NETWORK_EMPTY',
  1: 'NETWORK_IDLE',
  2: 'NETWORK_LOADING',
  3: 'NETWORK_NO_SOURCE',
};

const READY: Record<number, string> = {
  0: 'HAVE_NOTHING',
  1: 'HAVE_METADATA',
  2: 'HAVE_CURRENT_DATA',
  3: 'HAVE_FUTURE_DATA',
  4: 'HAVE_ENOUGH_DATA',
};

export function mediaDebugSnapshot(media?: HTMLMediaElement | null) {
  if (!media) return null;
  return {
    tag: media.tagName,
    src: (media.currentSrc || media.src || '').slice(0, 180),
    error: media.error
      ? {
          code: media.error.code,
          name: MEDIA_ERR[media.error.code] || `UNKNOWN_${media.error.code}`,
          message: media.error.message,
        }
      : null,
    networkState: NETWORK[media.networkState] || media.networkState,
    readyState: READY[media.readyState] || media.readyState,
    paused: media.paused,
    currentTime: Number(media.currentTime.toFixed?.(2) ?? media.currentTime),
    duration: media.duration,
  };
}

export function playbackDebug(event: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  console.log(PREFIX, event, data ?? '');
}
