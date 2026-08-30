'use client';

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import {
  adPlaybackUrl,
  claimPreloadedAdVideo,
  preloadUpcomingAd,
  takeNextAd,
} from './adQueue';
import {
  attachAdPlayback,
  destroyAdPlaybackHls,
  promoteAdPreloadToPlayback,
} from './adHls';
import { playbackDebug, mediaDebugSnapshot } from '../../utils/playbackDebug';
import { pauseActiveMainMedia } from '../../lib/activeMainMedia';

interface AdPlayerProps {
  onAdComplete?: () => void;
  key?: string;
}

function applyAdVideoPresentation(video: HTMLVideoElement) {
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.preload = 'auto';
  video.className = 'w-full h-full object-contain';
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;opacity:1;';
}

export const AdPlayer: React.FC<AdPlayerProps> = ({ onAdComplete }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [canSkip, setCanSkip] = useState<boolean>(false);
  const [videoOrientation, setVideoOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [needsSoundTap, setNeedsSoundTap] = useState<boolean>(false);
  const [selectedAd] = useState(() => takeNextAd());
  const onAdCompleteRef = useRef(onAdComplete);
  onAdCompleteRef.current = onAdComplete;

  useEffect(() => {
    setVideoOrientation(selectedAd.isVertical ? 'portrait' : 'landscape');
  }, [selectedAd]);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= 5 && !canSkip) {
        setCanSkip(true);
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [canSkip]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    let video = videoRef.current && host.contains(videoRef.current)
      ? videoRef.current
      : claimPreloadedAdVideo();
    const claimedPreload = Boolean(video);

    if (!video) {
      video = document.createElement('video');
    }

    applyAdVideoPresentation(video);
    video.muted = false;
    if (video.parentElement !== host) {
      host.replaceChildren(video);
    }
    videoRef.current = video;

    // The main track's <video>/<audio> are persistent singletons that live
    // outside Player's React tree (new Audio() is never DOM-attached; the
    // video is appended straight to document.body — see
    // ensurePlaybackVideoElement in utils/media.ts). Neither auto-stops just
    // because Player unmounted to show this ad. The play/skip gating already
    // pauses whichever is active before showing an ad, but if that ever runs
    // with a stale isPlaying, a leftover track silently competing with the ad
    // for CPU/network is exactly what looks like "freezing" — so hard-stop it
    // here too, as a guarantee rather than relying solely on the caller.
    pauseActiveMainMedia();
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
      if (el === video || el.id === 'podplayr-ad-preload') return;
      if (!el.paused) {
        playbackDebug('ad mount: force-pausing lingering media', {
          id: el.id,
          snapshot: mediaDebugSnapshot(el),
        });
        el.pause();
      }
    });

    // Never leave the user stuck on a black/frozen screen — if playback hits
    // a real error (or never gets anywhere at all), surface Skip immediately
    // instead of making them wait out the normal 5s grace period.
    const failPlayback = (reason: string) => {
      playbackDebug('ad playback failed', {
        reason,
        ad: selectedAd.video,
        snapshot: mediaDebugSnapshot(video),
      });
      setCanSkip(true);
    };

    const handleEnded = () => {
      onAdCompleteRef.current?.();
    };
    const handleTimeUpdate = () => {
      if (!Number.isFinite(video.duration)) return;
      setTimeRemaining(Math.max(0, Math.round(video.duration - video.currentTime)));
    };
    const handleLoadedMetadata = () => {
      setTimeRemaining(Math.round(video.duration));
      setAudioDuration(video.duration);
      if (video.videoWidth < video.videoHeight) {
        setVideoOrientation('portrait');
      } else {
        setVideoOrientation('landscape');
      }
    };
    const handleError = () => failPlayback('error-event');
    const handleStalled = () => {
      playbackDebug('ad video stalled', { ad: selectedAd.video, snapshot: mediaDebugSnapshot(video) });
    };

    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    video.addEventListener('stalled', handleStalled);

    // Mobile browsers reject unmuted autoplay once it's no longer tied to a
    // direct user gesture — and the `await attachAdPlayback` above always
    // breaks that association. Muted autoplay is essentially always
    // allowed, so fall back to it rather than leaving the ad frozen and
    // silently rejected with no recovery (the previous `.catch(console.error)`
    // behavior).
    const attemptPlay = async () => {
      try {
        await video.play();
        setNeedsSoundTap(false);
      } catch (err) {
        playbackDebug('ad unmuted play() rejected, retrying muted', { error: String(err) });
        try {
          video.muted = true;
          await video.play();
          setNeedsSoundTap(true);
        } catch (err2) {
          failPlayback(`play-rejected-even-muted: ${String(err2)}`);
        }
      }
    };

    const start = async () => {
      if (claimedPreload) {
        promoteAdPreloadToPlayback();
      } else {
        try {
          await attachAdPlayback(video, adPlaybackUrl(selectedAd), () => {
            video.src = selectedAd.video;
          });
        } catch {
          if (!video.src || video.src.includes('.m3u8')) {
            video.src = selectedAd.video;
          }
        }
      }
      if (cancelled) return;
      if (video.readyState >= 1) handleLoadedMetadata();
      void attemptPlay();
      preloadUpcomingAd();
    };

    void start();

    // Hard safety net: the 5s Skip timer already covers normal cases, but if
    // playback never even reaches metadata (silent stall with no error event
    // at all), force Skip eligible and log it rather than trusting the timer
    // alone.
    const watchdog = setTimeout(() => {
      if (cancelled) return;
      if (video.readyState < 1) {
        failPlayback('watchdog-no-metadata-after-8s');
      }
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.removeEventListener('stalled', handleStalled);
      try {
        video.pause();
      } catch {
        // ignore
      }
      destroyAdPlaybackHls();
    };
  }, [selectedAd]);

  useEffect(() => {
    const headers = document.querySelectorAll('header');
    headers.forEach((header) => {
      (header as HTMLElement).style.display = 'none';
    });

    return () => {
      headers.forEach((header) => {
        (header as HTMLElement).style.display = 'flex';
      });
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[100] flex items-center justify-center overflow-hidden">
      <div
        ref={hostRef}
        className={videoOrientation === 'portrait'
          ? 'w-full h-full flex items-center justify-center'
          : 'w-full h-full'}
      />
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        {canSkip && (
          <button
            type="button"
            onClick={() => onAdCompleteRef.current?.()}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-1 rounded-full font-medium text-sm transition-colors"
          >
            Skip Ad
          </button>
        )}
        {needsSoundTap && (
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = false;
              video.play().catch(() => {
                // Some browsers reject unmuting mid-playback without a fresh
                // gesture too — leave it muted rather than stalling again.
                video.muted = true;
              });
              setNeedsSoundTap(false);
            }}
            className="bg-black/80 hover:bg-black text-white px-3 py-1 rounded-full text-sm transition-colors"
          >
            🔇 Tap for sound
          </button>
        )}
        <div className="bg-black/80 text-white px-3 py-1 rounded-full font-mono text-sm">
          Ad: {timeRemaining}s / {Math.round(audioDuration)}s
        </div>
      </div>
      {selectedAd.url && (
        <div className="absolute left-1/2 -translate-x-1/2 bg-purple-900/90 rounded-lg overflow-hidden border border-purple-500/30 bottom-8">
          <div className="flex items-center space-x-3 p-3">
            <div className="flex-1">
              <p className="text-white text-sm font-medium">{selectedAd.title}</p>
              {selectedAd.domain && (
                <p className="text-gray-400 text-xs">{selectedAd.domain}</p>
              )}
            </div>
            <a
              href={selectedAd.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
            >
              Learn more
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
