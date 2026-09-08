'use client';

import React, { useRef, useState } from 'react';
import { LIVE_POSTER_URL, LIVE_TITLE } from '../../data/liveStream';
import { shareLiveToFarcaster } from '../../lib/shareToFarcaster';
import { useLiveHls } from '../../hooks/useLiveHls';
import { PlaybackButton } from '../buttons/PlaybackButton';
import { PlayerArrowHint, usePlayerArrowHint } from '../player/PlayerArrowHint';
import { LiveChat } from './LiveChat';

const iconButtonClass =
  'p-2 rounded-full bg-black/45 backdrop-blur-md text-white/90 active:scale-95 transition-transform touch-manipulation outline-none focus:outline-none focus-visible:outline-none';

export function LivePlayer({
  isMinimized,
  onMinimizeToggle,
}: {
  isMinimized: boolean;
  onMinimizeToggle: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { online, needsTap, isPlaying, showLive, togglePlayback, onPlay, onPause } = useLiveHls(
    videoRef,
    true
  );
  const [sharing, setSharing] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);
  const { visible: showMinimizeHint, dismiss: dismissMinimizeHint } = usePlayerArrowHint(
    'minimize',
    !isMinimized
  );
  const { visible: showExpandHint, dismiss: dismissExpandHint } = usePlayerArrowHint(
    'expand',
    isMinimized
  );

  return (
    <>
      <div
        className={
          isMinimized
            ? 'fixed bottom-20 left-0 z-0 w-px h-px overflow-hidden opacity-0 pointer-events-none'
            : 'fixed inset-0 z-[100] bg-black will-change-transform flex flex-col overflow-hidden'
        }
        style={isMinimized ? undefined : { backfaceVisibility: 'hidden' }}
        aria-hidden={isMinimized}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LIVE_POSTER_URL}
            alt=""
            className="w-full h-full object-cover scale-125 blur-3xl opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/70 to-black" />
        </div>

        <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
          <div
            className="flex-none"
            style={{ height: 'max(3.25rem, calc(env(safe-area-inset-top) + 2.75rem))' }}
            aria-hidden
          />

          <div className="relative z-[1] flex-1 min-h-0 flex flex-col px-3">
            <button
              type="button"
              onClick={togglePlayback}
              className={`relative w-full aspect-video overflow-hidden rounded-2xl bg-black touch-manipulation ${
                chatHidden ? 'flex-1 min-h-0 max-h-full' : 'max-h-[46vh] shrink-0'
              }`}
              aria-label={showLive ? (needsTap ? 'Play livestream' : 'Pause livestream') : 'Livestream offline'}
            >
              <video
                ref={videoRef}
                className={`absolute inset-0 h-full w-full object-cover ${showLive ? '' : 'invisible'}`}
                data-podplayr-live="1"
                playsInline
                poster={LIVE_POSTER_URL}
                controls={false}
                onPlay={onPlay}
                onPause={onPause}
              />
              {!showLive && (
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
                  </div>
                </>
              )}
              {showLive && (
                <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  Live
                </span>
              )}
              {showLive && needsTap && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <span className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white">
                    Tap to play
                  </span>
                </div>
              )}
            </button>

            <LiveChat
              online={online}
              variant="player"
              collapsed={chatHidden}
              onCollapsedChange={setChatHidden}
            />
          </div>

          <div
            className="absolute top-0 left-0 right-0 z-10 px-3 pb-10 flex justify-between items-start pointer-events-none bg-gradient-to-b from-black/75 via-black/30 to-transparent"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            <div className="pointer-events-none" />
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                type="button"
                disabled={sharing}
                onClick={async () => {
                  setSharing(true);
                  try {
                    await shareLiveToFarcaster();
                  } finally {
                    setSharing(false);
                  }
                }}
                className={iconButtonClass}
                aria-label="Share livestream"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                  <path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"/>
                </svg>
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    dismissMinimizeHint();
                    onMinimizeToggle();
                  }}
                  className={iconButtonClass}
                  aria-label="Back to mini player"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                    <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z"/>
                  </svg>
                </button>
                <PlayerArrowHint
                  visible={showMinimizeHint}
                  text="Back to mini player"
                  placement="below"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMinimized && (
        <div className="fixed bottom-20 left-0 right-0 bg-black/90 backdrop-blur-lg border-t border-purple-400/20 h-20 z-[100] will-change-transform">
          <div className="h-full px-4 mx-auto max-w-screen-xl">
            <div className="flex items-center justify-between h-full gap-3">
              <button
                type="button"
                onClick={() => {
                  dismissExpandHint();
                  onMinimizeToggle();
                }}
                className="flex items-center gap-3 flex-1 min-w-0 text-left touch-manipulation"
              >
                <div className="relative w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden bg-purple-900/20 ring-1 ring-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={LIVE_POSTER_URL} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white text-sm font-medium truncate">{LIVE_TITLE}</h3>
                  <p className="text-xs text-white/50 truncate">
                    {showLive ? (isPlaying ? 'Live now' : 'Live — paused') : 'Offline'}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2">
                <PlaybackButton
                  isPlaying={isPlaying}
                  onClick={togglePlayback}
                  size="small"
                  className={`bg-purple-500 shadow-md shadow-purple-500/30 ${showLive ? '' : 'opacity-40'}`}
                  hapticLabel="LiveMiniPlayer"
                />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      dismissExpandHint();
                      onMinimizeToggle();
                    }}
                    className="p-1.5 rounded-full text-white/80 active:scale-95 touch-manipulation"
                    aria-label="Expand livestream"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                      <path d="M480-600 240-360l56 56 184-184 184 184 56-56-240-240Z"/>
                    </svg>
                  </button>
                  <PlayerArrowHint
                    visible={showExpandHint}
                    text="Expand for video mode"
                    placement="above"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
