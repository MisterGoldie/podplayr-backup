import type Hls from 'hls.js';
import { playDebug, playbackSpeedLog, shortUrl } from '../utils/playDebug';

let currentHls: Hls | null = null;

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

export function isHlsAttached(): boolean {
  return currentHls !== null;
}

/** Stop fetching new Mux/HLS segments. Keeps the current buffer so resume is instant. */
export function pauseHlsBuffering() {
  if (!currentHls) return;
  try {
    currentHls.pauseBuffering();
    playDebug('hls pause buffering');
  } catch {
    try {
      currentHls.stopLoad();
    } catch {
      // ignore
    }
  }
}

/** Resume fragment loading after pauseHlsBuffering / a seek while paused. */
export function resumeHlsBuffering() {
  if (!currentHls) return;
  try {
    currentHls.resumeBuffering();
    playDebug('hls resume buffering');
  } catch {
    try {
      currentHls.startLoad();
    } catch {
      // ignore
    }
  }
}

export function detachHlsPlayback(media?: HTMLMediaElement | null) {
  if (currentHls) {
    try {
      currentHls.stopLoad();
    } catch {
      // ignore
    }
    try {
      currentHls.detachMedia();
    } catch {
      // ignore
    }
    try {
      currentHls.destroy();
    } catch {
      // ignore
    }
    currentHls = null;
  }

  if (!media) return;
  const src = media.getAttribute('src') || media.src || '';
  if (src.startsWith('blob:') || src === window.location.href) {
    media.removeAttribute('src');
    try {
      media.load();
    } catch {
      // ignore
    }
  }
}

function canUseNativeHls(media: HTMLMediaElement): boolean {
  return media.canPlayType('application/vnd.apple.mpegurl') !== ''
    || media.canPlayType('application/x-mpegURL') !== '';
}

/**
 * Attach a source to `media`. Progressive URLs set `src` immediately.
 * HLS prefers hls.js (MSE) on Chrome/Edge; native only on Safari/iOS.
 */
export async function attachPlaybackSource(
  media: HTMLMediaElement,
  url: string,
  onFatalError: () => void
): Promise<void> {
  detachHlsPlayback(media);

  if (!isHlsUrl(url)) {
    media.src = url;
    return;
  }

  const { default: Hls } = await import('hls.js');

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      // Do not download-then-abort a probe fragment; that is what logged as
      // `networkError / aborted` and left readyState at 0 for 16s.
      testBandwidth: false,
      startLevel: 0,
      capLevelToPlayerSize: false,
      preferManagedMediaSource: false,
      // Default maxMaxBufferLength is 600s — that is the bufferFullError after pause.
      maxBufferLength: 20,
      maxMaxBufferLength: 45,
      xhrSetup: (xhr) => {
        xhr.withCredentials = false;
      },
    });
    currentHls = hls;

    playbackSpeedLog('hls.js attaching', { url: shortUrl(url) });
    playDebug('hls.js attaching', { url });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        hls.off(Hls.Events.MEDIA_ATTACHED, onAttached);
        hls.off(Hls.Events.MANIFEST_PARSED, onParsed);
        if (error) reject(error);
        else resolve();
      };

      const onAttached = () => {
        playDebug('hls media attached');
        hls.loadSource(url);
      };

      const onParsed = () => {
        playDebug('hls manifest parsed');
        finish();
      };

      hls.on(Hls.Events.MEDIA_ATTACHED, onAttached);
      hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.details === 'aborted') return;
        playDebug('hls.js error', {
          fatal: data.fatal,
          type: data.type,
          details: data.details,
        });
        if (!data.fatal) return;
        detachHlsPlayback(media);
        onFatalError();
        finish(new Error(data.details || 'hls fatal error'));
      });

      hls.attachMedia(media);
    });
  }

  if (canUseNativeHls(media)) {
    playbackSpeedLog('hls native', { url: shortUrl(url) });
    playDebug('hls native (Safari)');
    media.src = url;
    return;
  }

  playDebug('hls unsupported — setting src anyway');
  media.src = url;
}
