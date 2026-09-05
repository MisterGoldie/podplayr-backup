'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import {
  LIVE_HLS_URL,
  LIVE_OFFLINE_POLLS,
  LIVE_POLL_MS,
  LIVE_POSTER_URL,
  LIVE_TITLE,
} from '../../data/liveStream';
import { LiveChat } from './LiveChat';

async function isLiveManifestAvailable(): Promise<boolean> {
  try {
    const res = await fetch(LIVE_HLS_URL, { method: 'GET', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export function LiveStreamFrame() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const onlineRef = useRef(false);
  const [online, setOnline] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  const attachLive = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    destroyHls();

    const { default: HlsLib } = await import('hls.js');

    if (HlsLib.isSupported()) {
      const hls = new HlsLib({
        enableWorker: false,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        testBandwidth: false,
        startLevel: -1,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        onlineRef.current = false;
        setOnline(false);
        setNeedsTap(false);
        destroyHls();
      });
      hls.attachMedia(video);
      hls.on(HlsLib.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(LIVE_HLS_URL);
      });
      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
      });
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = LIVE_HLS_URL;
      video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    }
  }, [destroyHls]);

  useEffect(() => {
    let cancelled = false;
    let misses = 0;

    const poll = async () => {
      const live = await isLiveManifestAvailable();
      if (cancelled) return;
      if (live) {
        misses = 0;
        if (!onlineRef.current) {
          onlineRef.current = true;
          setOnline(true);
          void attachLive();
        }
        return;
      }
      misses += 1;
      if (misses < LIVE_OFFLINE_POLLS || !onlineRef.current) return;
      onlineRef.current = false;
      setOnline(false);
      setNeedsTap(false);
      destroyHls();
    };

    let intervalId: number | undefined;
    let idleId: number | undefined;
    let startTimer: number | undefined;
    const start = () => {
      void poll();
      intervalId = window.setInterval(poll, LIVE_POLL_MS);
    };
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(start, { timeout: 1200 });
    } else {
      startTimer = window.setTimeout(start, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) cancelIdleCallback(idleId);
      if (startTimer !== undefined) window.clearTimeout(startTimer);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      destroyHls();
    };
  }, [attachLive, destroyHls]);

  const handleTap = () => {
    const video = videoRef.current;
    if (!video || !online) return;
    if (video.paused) {
      void video.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true));
    } else {
      video.pause();
      setNeedsTap(true);
    }
  };

  return (
    <div className="w-full lg:max-w-2xl mx-auto">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/50 mb-2">{LIVE_TITLE}</p>
      <button
        type="button"
        onClick={handleTap}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black aspect-video touch-manipulation"
        aria-label={online ? (needsTap ? 'Play live stream' : 'Pause live stream') : 'Livestream offline'}
      >
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${online ? '' : 'invisible'}`}
          data-podplayr-live="1"
          playsInline
          poster={LIVE_POSTER_URL}
          controls={false}
          onPlay={() => setNeedsTap(false)}
          onPause={() => setNeedsTap(true)}
        />
        {!online && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LIVE_POSTER_URL}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/55">
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/60">
                Offline
              </span>
              <p className="absolute bottom-8 left-0 right-0 text-center text-xs text-white/40">
                Stream starts when we go live
              </p>
            </div>
          </>
        )}
        {online && (
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        )}
        {online && needsTap && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white">
              Tap to play
            </span>
          </div>
        )}
      </button>
      {online && <LiveChat online={online} />}
    </div>
  );
}
