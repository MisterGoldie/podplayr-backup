/**
 * TEMP PLAYBACK DEBUG — off.
 *
 * `playbackDebug()` returns before it touches the console or builds a string,
 * so the call sites throughout the player cost nothing while this is false.
 * They are left in place deliberately: they are how the mobile retrieval work
 * was diagnosed, and flipping this back on is the fastest way to see a
 * playback regression on a device with no console.
 *
 * Re-enable for a build: set this to true.
 * Re-enable at runtime: window.__PODPLAYR_PLAYBACK_DEBUG = true
 * Filter DevTools console by: PLAYBACK DEBUG
 *
 * The on-screen overlay that read this buffer has been removed; restoring it
 * means a component that subscribes via subscribePlaybackDebug.
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
    videoWidth: media instanceof HTMLVideoElement ? media.videoWidth : undefined,
    videoHeight: media instanceof HTMLVideoElement ? media.videoHeight : undefined,
    paused: media.paused,
    muted: media.muted,
    volume: media.volume,
    currentTime: Number(media.currentTime.toFixed?.(2) ?? media.currentTime),
    duration: media.duration,
  };
}

export type PlaybackDebugEntry = {
  /** ms since the buffer started, so the gaps are readable at a glance. */
  t: number;
  event: string;
  detail: string;
};

const MAX_ENTRIES = 250;
/** Tail kept small — it is re-serialized on a throttle and must stay cheap. */
const CRASH_TAIL = 80;
const CRASH_KEY = 'podplayr_playback_debug_tail';

const entries: PlaybackDebugEntry[] = [];
const listeners = new Set<(all: PlaybackDebugEntry[]) => void>();
const startedAt = Date.now();
let lastPersistAt = 0;

/** Compact one-line rendering — the overlay is a phone screen, not a console. */
function summarize(data?: Record<string, unknown>): string {
  if (!data) return '';
  try {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      let text: string;
      if (typeof value === 'object') {
        text = JSON.stringify(value);
      } else {
        text = String(value);
      }
      if (text.length > 160) text = `${text.slice(0, 157)}…`;
      parts.push(`${key}=${text}`);
    }
    return parts.join(' ');
  } catch {
    return '(unserializable)';
  }
}

/**
 * Keep the last stretch of events where a reload can still find them.
 *
 * When the WebView is killed for memory the page dies with its console, so the
 * most interesting events are exactly the ones that vanish. Writing a tail out
 * means the next load can show what happened right before. Best effort only:
 * inside the Farcaster webview storage is frequently blocked outright.
 */
function persistTail(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastPersistAt < 750) return;
  lastPersistAt = now;
  try {
    window.sessionStorage.setItem(
      CRASH_KEY,
      JSON.stringify(entries.slice(-CRASH_TAIL))
    );
  } catch {
    // Storage blocked — the live overlay still works.
  }
}

export function getPlaybackDebugEntries(): PlaybackDebugEntry[] {
  return entries;
}

/** Events from the run that came before this page load, if any survived. */
export function getPreviousSessionTail(): PlaybackDebugEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(CRASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlaybackDebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearPlaybackDebug(): void {
  entries.length = 0;
  try {
    window.sessionStorage.removeItem(CRASH_KEY);
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn(entries));
}

export function subscribePlaybackDebug(
  fn: (all: PlaybackDebugEntry[]) => void
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function playbackDebug(event: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  console.log(PREFIX, event, data ?? '');
  entries.push({ t: Date.now() - startedAt, event, detail: summarize(data) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persistTail();
  listeners.forEach((fn) => {
    try {
      fn(entries);
    } catch {
      // A broken subscriber must never take playback down with it.
    }
  });
}
