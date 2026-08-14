/** TEMP play diagnostics. Filter DevTools by `[PLAYBACK-SPEED]` or `[PLAY-DEBUG]`. */

const PREFIX = '[PLAY-DEBUG]';
const SPEED = '[PLAYBACK-SPEED]';

let attempt = 0;
let seq = 0;
let t0 = 0;

export function playDebugStart(step: string, data?: Record<string, unknown>) {
  t0 = performance.now();
  attempt += 1;
  seq = 0;
  playDebug(step, data);
}

export function playDebug(step: string, data?: Record<string, unknown>) {
  seq += 1;
  const ms = t0 ? Math.round(performance.now() - t0) : 0;
  if (data !== undefined) {
    console.log(`${PREFIX} #${attempt}.${seq} +${ms}ms ${step}`, data);
  } else {
    console.log(`${PREFIX} #${attempt}.${seq} +${ms}ms ${step}`);
  }
}

/** Filter the console by PLAYBACK-SPEED to see CDN / race / failover only. */
export function playbackSpeedLog(step: string, data?: Record<string, unknown>) {
  const ms = t0 ? Math.round(performance.now() - t0) : 0;
  if (data !== undefined) {
    console.log(`${SPEED} +${ms}ms ${step}`, data);
  } else {
    console.log(`${SPEED} +${ms}ms ${step}`);
  }
}

export function shortUrl(url?: string | null): string {
  if (!url) return '';
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

export function audioDebugSnapshot(audio: HTMLMediaElement) {
  return {
    src: (audio.src || '').slice(0, 180),
    currentSrc: (audio.currentSrc || '').slice(0, 180),
    readyState: audio.readyState,
    networkState: audio.networkState,
    paused: audio.paused,
    muted: audio.muted,
    currentTime: Number.isFinite(audio.currentTime) ? Number(audio.currentTime.toFixed(2)) : audio.currentTime,
    duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : String(audio.duration),
    error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
  };
}
