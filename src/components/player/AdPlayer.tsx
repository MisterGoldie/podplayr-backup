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

    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

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
      video.play().catch(console.error);
      preloadUpcomingAd();
    };

    void start();

    return () => {
      cancelled = true;
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
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
