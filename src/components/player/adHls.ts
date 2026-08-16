import type Hls from 'hls.js';

let playHls: Hls | null = null;
let preloadHls: Hls | null = null;

function isHlsUrl(url: string) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function canUseNativeHls(media: HTMLMediaElement) {
  return (
    media.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    media.canPlayType('application/x-mpegURL') !== ''
  );
}

function destroy(hls: Hls | null) {
  if (!hls) return;
  try {
    hls.stopLoad();
  } catch {
    // ignore
  }
  try {
    hls.detachMedia();
  } catch {
    // ignore
  }
  try {
    hls.destroy();
  } catch {
    // ignore
  }
}

export function destroyAdPlaybackHls() {
  destroy(playHls);
  playHls = null;
}

export function destroyAdPreloadHls() {
  destroy(preloadHls);
  preloadHls = null;
}

/** Keep the preloaded HLS buffer and use it for the visible ad. */
export function promoteAdPreloadToPlayback() {
  destroy(playHls);
  playHls = preloadHls;
  preloadHls = null;
}

async function attachHls(
  media: HTMLMediaElement,
  url: string,
  slot: 'play' | 'preload',
  onFatalError?: () => void
) {
  if (slot === 'play') destroyAdPlaybackHls();
  else destroyAdPreloadHls();

  if (!isHlsUrl(url)) {
    media.src = url;
    return;
  }

  const { default: Hls } = await import('hls.js');

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      testBandwidth: false,
      startLevel: 0,
      capLevelToPlayerSize: false,
      preferManagedMediaSource: false,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      xhrSetup: (xhr) => {
        xhr.withCredentials = false;
      },
    });
    if (slot === 'play') playHls = hls;
    else preloadHls = hls;

    return new Promise<void>((resolve, reject) => {
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
        if (data.details === 'aborted') return;
        if (!data.fatal) return;
        if (slot === 'play') destroyAdPlaybackHls();
        else destroyAdPreloadHls();
        onFatalError?.();
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

export function attachAdPlayback(
  media: HTMLMediaElement,
  url: string,
  onFatalError?: () => void
) {
  return attachHls(media, url, 'play', onFatalError);
}

export function attachAdPreload(media: HTMLMediaElement, url: string) {
  return attachHls(media, url, 'preload');
}
