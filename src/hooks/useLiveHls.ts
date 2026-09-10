'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type Hls from 'hls.js';
import { LIVE_HLS_URL } from '../data/liveStream';
import { useLiveStatus } from './useLiveStatus';
import { useLivePoster } from './useLivePoster';
import { useLiveViewerCount } from './useLiveViewerCount';

export function useLiveHls(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean
) {
  const hlsRef = useRef<Hls | null>(null);
  const attachedRef = useRef(false);
  const sawOnlineRef = useRef(false);
  const online = useLiveStatus();
  const [needsTap, setNeedsTap] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveReady, setLiveReady] = useState(false);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    attachedRef.current = false;
    const video = videoRef.current;
    if (video) {
      video.removeAttribute('src');
      video.load();
    }
    setIsPlaying(false);
    setLiveReady(false);
  }, [videoRef]);

  const attachLive = useCallback(async () => {
    const video = videoRef.current;
    if (!video || attachedRef.current) return;

    attachedRef.current = true;

    let HlsLib: typeof import('hls.js').default;
    try {
      ({ default: HlsLib } = await import('hls.js'));
    } catch {
      attachedRef.current = false;
      return;
    }

    if (HlsLib.isSupported()) {
      const hls = new HlsLib({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDuration: 8,
        liveMaxLatencyDuration: 16,
        maxBufferLength: 18,
        maxMaxBufferLength: 36,
        backBufferLength: 30,
        testBandwidth: true,
        abrEwmaDefaultEstimate: 500_000,
        startLevel: -1,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        destroyHls();
      });
      hls.attachMedia(video);
      hls.on(HlsLib.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(LIVE_HLS_URL);
      });
      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        setLiveReady(true);
        video.loop = false;
        video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
      });
      hls.on(HlsLib.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details?.live === false) destroyHls();
      });
      video.onended = () => destroyHls();
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = LIVE_HLS_URL;
      video.loop = false;
      video.onended = () => destroyHls();
      setLiveReady(true);
      video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    }
  }, [destroyHls, videoRef]);

  useEffect(() => {
    if (!enabled || !online) {
      destroyHls();
      if (!enabled) sawOnlineRef.current = false;
      return;
    }
    sawOnlineRef.current = true;
    void attachLive();
    return () => destroyHls();
  }, [attachLive, destroyHls, enabled, online]);

  const showLive = enabled && (online || liveReady || isPlaying);
  const posterUrl = useLivePoster(online);
  const viewerCount = useLiveViewerCount(enabled && online);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !showLive) return;
    if (!attachedRef.current) {
      void attachLive();
      return;
    }
    if (video.paused) {
      void video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    } else {
      video.pause();
      setNeedsTap(true);
    }
  };

  return {
    online,
    posterUrl,
    viewerCount,
    needsTap,
    isPlaying,
    showLive,
    attachLive,
    togglePlayback,
    onPlay: () => {
      setNeedsTap(false);
      setIsPlaying(true);
    },
    onPause: () => {
      setNeedsTap(true);
      setIsPlaying(false);
    },
  };
}
