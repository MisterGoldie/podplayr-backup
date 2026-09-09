'use client';

import React, { useRef } from 'react';
import { LIVE_TITLE } from '../../data/liveStream';
import { useLiveHls } from '../../hooks/useLiveHls';

export function LiveStreamFrame({
  onOpen,
  streamInline = true,
}: {
  onOpen: () => void;
  streamInline?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { online, showLive, viewerCount, posterUrl } = useLiveHls(videoRef, streamInline);

  return (
    <div className="w-full lg:max-w-2xl mx-auto">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/50">{LIVE_TITLE}</p>
      <button
        type="button"
        onClick={onOpen}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black aspect-video touch-manipulation"
        aria-label={online ? 'Open livestream' : 'Open livestream (offline)'}
      >
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover ${showLive ? '' : 'invisible'}`}
          data-podplayr-live="home"
          playsInline
          poster={posterUrl}
          controls={false}
        />
        {!showLive && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/30" />
          </>
        )}
        {online ? (
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
            {viewerCount > 0 ? (
              <span className="font-medium normal-case tracking-normal text-white/80">{viewerCount}</span>
            ) : null}
          </span>
        ) : (
          <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Offline
          </span>
        )}
        {!online && (
          <>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/25">
                <svg xmlns="http://www.w3.org/2000/svg" height="28" viewBox="0 -960 960 960" width="28" fill="currentColor" className="ml-0.5 text-white">
                  <path d="M320-200v-560l440 280-440 280Z" />
                </svg>
              </span>
            </span>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/50">
              Stream starts when we go live
            </p>
          </>
        )}
      </button>
    </div>
  );
}
