import type Hls from 'hls.js';
import { playbackDebug } from '../utils/playbackDebug'; // TEMP — remove with playbackDebug.ts
import {
  isBareIpfsRawFileCid,
  isExtensionlessArweaveTx,
  urlLooksLikeExtensionlessVideo,
  withBrowserVideoHint,
} from '../utils/ipfsExtensionlessMedia';

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
  } catch {
    try {
      currentHls.startLoad();
    } catch {
      // ignore
    }
  }
}

/** Seek the live clock and make sure HLS actually loads that position. */
export function seekAttachedMedia(media: HTMLMediaElement, time: number): number | null {
  if (!Number.isFinite(time)) return null;
  const duration = media.duration;
  const clamped =
    Number.isFinite(duration) && duration > 0
      ? Math.min(Math.max(0, time), Math.max(0, duration - 0.05))
      : Math.max(0, time);

  resumeHlsBuffering();
  try {
    media.currentTime = clamped;
  } catch {
    return null;
  }
  return Number.isFinite(media.currentTime) ? media.currentTime : clamped;
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
 * Set a progressive (non-HLS) src on the same tick as the tap.
 * `async attachPlaybackSource` always yields a microtask; iOS WKWebView
 * then treats play() as not user-initiated (desktop Chrome still allows it).
 */
export function attachProgressivePlaybackSource(
  media: HTMLMediaElement,
  url: string,
  mime?: string
): string {
  detachHlsPlayback(media);
  const assumeVideo =
    typeof HTMLVideoElement !== 'undefined' && media instanceof HTMLVideoElement;
  const assumeAudio =
    typeof HTMLAudioElement !== 'undefined' && media instanceof HTMLAudioElement;
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  const src = withBrowserVideoHint(url, { assumeVideo, assumeAudio, mime: type });
  const needsTypedSource =
    assumeVideo &&
    (type.startsWith('video/') ||
      urlLooksLikeExtensionlessVideo(url) ||
      isBareIpfsRawFileCid(url) ||
      isExtensionlessArweaveTx(url));
  const needsTypedAudioSource =
    assumeAudio &&
    (type.startsWith('audio/') || isBareIpfsRawFileCid(url));

  while (media.firstChild) media.removeChild(media.firstChild);
  media.removeAttribute('src');

  if (needsTypedSource) {
    const source = document.createElement('source');
    source.src = src;
    source.type = type.startsWith('video/') ? type : 'video/mp4';
    media.appendChild(source);
    try {
      media.load();
    } catch {
      // ignore
    }
  } else if (needsTypedAudioSource) {
    const source = document.createElement('source');
    source.src = src;
    source.type = type.startsWith('audio/') ? type : 'audio/mpeg';
    media.appendChild(source);
    try {
      media.load();
    } catch {
      // ignore
    }
  } else {
    media.src = src;
  }
  return src;
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
  if (!isHlsUrl(url)) {
    attachProgressivePlaybackSource(media, url);
    return;
  }

  detachHlsPlayback(media);

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
        hls.loadSource(url);
      };

      const onParsed = () => {
        finish();
      };

      hls.on(Hls.Events.MEDIA_ATTACHED, onAttached);
      hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        playbackDebug('hls:error', {
          url,
          fatal: data.fatal,
          type: data.type,
          details: data.details,
          error: data.error?.message,
        });
        if (data.details === 'aborted') return;
        if (!data.fatal) return;
        detachHlsPlayback(media);
        onFatalError();
        finish(new Error(data.details || 'hls fatal error'));
      });

      hls.attachMedia(media);
    });
  }

  if (canUseNativeHls(media)) {
    media.src = url;
    return;
  }

  media.src = url;
}
