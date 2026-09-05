import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useContext } from 'react';
import { NFTImage } from '../media/NFTImage';
import { processMediaUrl, getMediaKey, formatTime, safeProgressPercent, getDisplayTimes, rewriteLegacyOpenSeaMediaUrl, adoptPlaybackVideoElement, parkPlaybackVideo, applyPlaybackVideoPresentation } from '../../utils/media';
import { applyPlaybackPlanToNft, getNftPlaybackPlan } from '../../utils/isMediaNFT';
import type { NFT } from '../../types/user';
import { logger } from '../../utils/logger';
import { triggerHaptic } from '../../utils/haptics';
import { PlaybackButton } from '../buttons/PlaybackButton';
import InfoPanel from './InfoPanel';
import { PlayerArrowHint, usePlayerArrowHint } from './PlayerArrowHint';
import { UserFidContext } from '../../app/providers';
import { isRealFid } from '../../utils/platform';
import { shareNftToFarcaster } from '../../lib/shareToFarcaster';

// Fix the MaximizedPlayerProps interface to include isAnimating
// export interface MaximizedPlayerProps {
//   nft: NFT;
//   isPlaying: boolean;
//   onPlayPause: () => void;
//   onNext?: () => void;
//   onPrevious?: () => void;
//   isMinimized: boolean;
//   onMinimizeToggle: () => void;
//   progress: number;
//   duration: number;
//   onSeek: (time: number) => void;
//   onLikeToggle?: (nft: NFT) => void;
//   isLiked?: boolean;
//   onPictureInPicture?: () => void;
//   lastPosition?: number;
// }

// Adding isAnimating to the interface:
export interface MaximizedPlayerProps {
  nft: NFT;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  isMinimized: boolean;
  onMinimizeToggle: () => void;
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
  onLikeToggle?: (nft: NFT) => void;
  isLiked?: boolean;
  onPictureInPicture?: () => void;
  lastPosition?: number;
  isAnimating: boolean; // Add this property
  onOpenArtistProfile?: (fid: number) => void;
}

export const MaximizedPlayer: React.FC<MaximizedPlayerProps> = ({
  nft,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isMinimized,
  onMinimizeToggle,
  progress,
  duration,
  onSeek,
  onLikeToggle,
  isLiked,
  onPictureInPicture,
  lastPosition,
  isAnimating,
  onOpenArtistProfile,
}) => {
  const { fid } = useContext(UserFidContext);
  const canLike = Boolean(onLikeToggle) && isRealFid(fid);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [videoLoading, setVideoLoading] = useState(false);
  const hideControlsTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [isForcePressed, setIsForcePressed] = useState(false);
  const [isActivelyScrubbingBar, setIsActivelyScrubbingBar] = useState(false);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubPositionRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const seekedFromTouchRef = useRef(false);
  const [pipActive, setPipActive] = useState(false);
  const [resolvedImageUrl, setResolvedImageUrl] = useState(() =>
    nft.image
      ? processMediaUrl(rewriteLegacyOpenSeaMediaUrl(nft.image, nft.contract, nft.network), '', 'image')
      : ''
  );
  const [videoLayerFailed, setVideoLayerFailed] = useState(false);
  const [mediaAspect, setMediaAspect] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mediaBox, setMediaBox] = useState({ width: 0, height: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const [sharing, setSharing] = useState(false);
  const { visible: showMinimizeHint, dismiss: dismissMinimizeHint } = usePlayerArrowHint(
    'minimize',
    Boolean(!isMinimized && !isAnimating && !showInfo)
  );

  // Keep elapsed/remaining derived from the same floored values so they never drift
  // while scrubbing or during normal playback.
  const displayProgress = isActivelyScrubbingBar && scrubPosition !== null ? scrubPosition : progress;
  const { elapsed: displayElapsed, remaining: displayRemaining } = getDisplayTimes(displayProgress, duration);
  const syncPlan = getNftPlaybackPlan(nft);
  const [playbackPlan, setPlaybackPlan] = useState(syncPlan);
  const planNftKey = `${nft.contract}-${nft.tokenId}`;
  const [planForNft, setPlanForNft] = useState(planNftKey);
  if (planForNft !== planNftKey) {
    setPlanForNft(planNftKey);
    setPlaybackPlan(syncPlan);
  }
  // The shared <video> is also the playback clock for video-with-audio. If we
  // drop it from the DOM just because the visual track is missing (audio-only
  // Mux, Alchemy WAV mislabeled as mp4), the browser pauses that element and
  // the card click looks like a no-op. Keep the clock mounted and only hide
  // the visual layer.
  const videoIsClock = playbackPlan.mode === 'video-with-audio' && !playbackPlan.muteVideo;
  const rawVideoSrc =
    playbackPlan.videoUrl && (!videoLayerFailed || videoIsClock)
      ? playbackPlan.videoUrl
      : null;
  const hasVideoLayer = Boolean(rawVideoSrc);
  const showVideoVisually = Boolean(playbackPlan.videoUrl) && !videoLayerFailed;

  useEffect(() => {
    setVideoLayerFailed(false);
    setMediaAspect(null);
  }, [nft.contract, nft.tokenId]);

  useEffect(() => {
    const sync = getNftPlaybackPlan(nft);
    // Avoid a redundant re-render (and possible reload) when the plan hasn't actually changed
    setPlaybackPlan((prev) =>
      prev.mode === sync.mode &&
      prev.videoUrl === sync.videoUrl &&
      prev.audioUrl === sync.audioUrl
        ? prev
        : sync
    );
    if (sync.videoUrl) {
      applyPlaybackPlanToNft(nft, sync);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nft.contract, nft.tokenId, nft.audio, nft.videoUrl, nft.isVideo, nft.playbackMode, nft.metadata?.animation_url]);

  useEffect(() => {
    setResolvedImageUrl(
      nft.image
        ? processMediaUrl(rewriteLegacyOpenSeaMediaUrl(nft.image, nft.contract, nft.network), '', 'image')
        : ''
    );
  }, [nft.contract, nft.tokenId, nft.image, nft.network]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || isMinimized) return;
    const aspect = mediaAspect && mediaAspect > 0
      ? mediaAspect
      : showVideoVisually ? 16 / 9 : 1;
    const TITLE_SLOT = 44;
    const layout = () => {
      const availW = stage.clientWidth;
      const availH = Math.max(0, stage.clientHeight - TITLE_SLOT);
      if (availW <= 0 || availH <= 0) return;
      let width = availW;
      let height = width / aspect;
      if (height > availH) {
        height = availH;
        width = height * aspect;
      }
      setMediaBox((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      );
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [mediaAspect, showVideoVisually, isMinimized]);
  
  // Auto-hide controls after inactivity — skip while minimized so leftover
  // document listeners never capture navigation on the page underneath.
  useEffect(() => {
    if (isMinimized) return;
    const handleUserActivity = () => {
      setShowControls(true);
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
      }
      hideControlsTimer.current = setTimeout(() => {
        if (showMinimizeHint) return;
        setShowControls(false);
      }, 3000);
    };

    handleUserActivity(); // Initial setup

    document.addEventListener('mousemove', handleUserActivity);
    document.addEventListener('touchstart', handleUserActivity);

    return () => {
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
      }
      document.removeEventListener('mousemove', handleUserActivity);
      document.removeEventListener('touchstart', handleUserActivity);
    };
  }, [isMinimized, showMinimizeHint]);
  
  // PiP event handlers that need access to the latest state
  // Define these using useCallback to maintain reference stability
  const handlePipPlay = useCallback(() => {
    if (!isPlaying) {
      onPlayPause();
    }
  }, [isPlaying, onPlayPause]);
  
  const handlePipPause = useCallback(() => {
    if (isPlaying) {
      onPlayPause();
    }
  }, [isPlaying, onPlayPause]);

  // Set up and clean up PiP event listeners
  useEffect(() => {
    // Find the current video element (both via ref and as fallback via DOM)
    const videoElement = videoRef.current || 
      (nft?.isVideo || nft?.metadata?.animation_url ? 
        document.getElementById(`video-${nft.contract}-${nft.tokenId}`) as HTMLVideoElement : null);
    
    if (!videoElement) return;
    
    // Function to set up event listeners when PiP starts
    const handleEnterPiP = (event: any) => {
      setPipActive(true);
      
      // Add direct event listeners to sync state when PiP controls are used
      videoElement.addEventListener('play', handlePipPlay);
      videoElement.addEventListener('pause', handlePipPause);
    };
    
    // Function to clean up when PiP ends
    const handleLeavePiP = () => {
      setPipActive(false);
      
      // Remove the PiP-specific event listeners
      videoElement.removeEventListener('play', handlePipPlay);
      videoElement.removeEventListener('pause', handlePipPause);
    };
    
    // Set up the PiP lifecycle event listeners
    videoElement.addEventListener('enterpictureinpicture', handleEnterPiP);
    videoElement.addEventListener('leavepictureinpicture', handleLeavePiP);
    
    // If PiP is already active when component renders/updates, ensure listeners are attached
    if (document.pictureInPictureElement === videoElement) {
      setPipActive(true);
      videoElement.addEventListener('play', handlePipPlay);
      videoElement.addEventListener('pause', handlePipPause);
    }
    
    // Clean up all event listeners when component unmounts or deps change
    return () => {
      videoElement.removeEventListener('enterpictureinpicture', handleEnterPiP);
      videoElement.removeEventListener('leavepictureinpicture', handleLeavePiP);
      videoElement.removeEventListener('play', handlePipPlay);
      videoElement.removeEventListener('pause', handlePipPause);
    };
  }, [nft, handlePipPlay, handlePipPause]); // Include the callbacks in deps

  // Update the PiP toggle function to include debug logging and readiness checks
  const handlePictureInPicture = async () => {
    try {
      // If already in PiP, exit
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      
      if (!nft?.isVideo && !hasVideoLayer) {
        return;
      }
      
      // Function to check if video is ready for PiP
      const isVideoReadyForPiP = (video: HTMLVideoElement): boolean => {
        // Check multiple readiness conditions
        const isLoaded = video.readyState >= 2; // HAVE_CURRENT_DATA or higher
        const hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
        const canUsePiP = document.pictureInPictureEnabled && video.disablePictureInPicture !== true;
        
        
        return isLoaded && hasVideo && canUsePiP;
      };
      
      // Function to wait for video to be ready
      const waitForVideoReadiness = (video: HTMLVideoElement): Promise<void> => {
        return new Promise((resolve, reject) => {
          // If already ready, resolve immediately
          if (isVideoReadyForPiP(video)) {
            resolve();
            return;
          }
          
          
          // Add event listeners for video readiness
          const readyHandler = () => {
            if (isVideoReadyForPiP(video)) {
              video.removeEventListener('loadeddata', readyHandler);
              video.removeEventListener('canplay', readyHandler);
              resolve();
            }
          };
          
          // Set a timeout to avoid waiting forever
          const timeoutId = setTimeout(() => {
            video.removeEventListener('loadeddata', readyHandler);
            video.removeEventListener('canplay', readyHandler);
            reject(new Error('Timed out waiting for video to be ready for PiP'));
          }, 5000); // 5 second timeout
          
          video.addEventListener('loadeddata', readyHandler);
          video.addEventListener('canplay', readyHandler);
        });
      };
      
      // Try with ref first
      if (videoRef.current) {
        try {
          
          // Wait for video to be ready before requesting PiP
          await waitForVideoReadiness(videoRef.current);
          
          await videoRef.current.requestPictureInPicture();
          return;
        } catch (e) {
          console.error("Error requesting PiP with ref:", e);
        }
      }
      
      // Then try with direct DOM access
      const videoId = `video-${nft.contract}-${nft.tokenId}`;
      const videoElement = document.getElementById(videoId) as HTMLVideoElement;
      
      if (videoElement) {
        try {
          
          // Wait for video to be ready before requesting PiP
          await waitForVideoReadiness(videoElement);
          
          await videoElement.requestPictureInPicture();
          return;
        } catch (e) {
          console.error("Error requesting PiP with DOM:", e);
        }
      }
    } catch (error) {
      console.error('Error toggling Picture-in-Picture mode:', error);
    }
  };

  // Create a dedicated logger for player
  const playerLogger = logger.getModuleLogger('player');
  
  // Track the last logged mediaKey to prevent duplicate logs
  const lastLoggedMediaKeyRef = useRef<string>('');
  
  // Render video with proper fallbacks — only when plan has a real video URL
  const renderVideo = () => {
    const rawVideo = rawVideoSrc || '';
    if (!rawVideo) return null;

    const currentMediaKey = getMediaKey(nft);

    if (lastLoggedMediaKeyRef.current !== currentMediaKey) {
      playerLogger.info('Video playback source:', {
        nft: nft.name || 'Unknown NFT',
        mediaKey: currentMediaKey,
        mode: playbackPlan.mode,
        videoIsClock,
        url: rawVideo,
      });
      lastLoggedMediaKeyRef.current = currentMediaKey;
    }

    return (
      <div
        ref={videoHostRef}
        className="relative w-full h-full flex items-center justify-center"
      />
    );
  };

  // Adopt the shared <video> once per token. Re-running this on every nft/cover
  // update used to re-parent the clock and abort play() (Thought Loop, etc.).
  useLayoutEffect(() => {
    if (!rawVideoSrc) return;
    const host = videoHostRef.current;
    if (!host) return;

    const video = adoptPlaybackVideoElement(host, nft.contract, nft.tokenId);
    videoRef.current = video;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.playsInline = true;

    return () => {
      if (video.parentElement === host) {
        document.body.appendChild(video);
        parkPlaybackVideo(video);
      }
    };
  }, [rawVideoSrc ? `${nft.contract}-${nft.tokenId}` : '', nft.contract, nft.tokenId]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !rawVideoSrc) return;
    if (isMinimized || videoLayerFailed) {
      parkPlaybackVideo(video);
    } else {
      applyPlaybackVideoPresentation(video);
    }
  }, [rawVideoSrc, isMinimized, videoLayerFailed, nft.contract, nft.tokenId]);

  useLayoutEffect(() => {
    if (!rawVideoSrc) return;
    const video = videoRef.current;
    if (!video) return;

    const clock = playbackPlan.mode === 'video-with-audio' && !playbackPlan.muteVideo;
    // HLS/Mux almost always reports 0×0 on loadedmetadata — the video track
    // only gets real dimensions after the first fragment decodes (resize /
    // loadeddata / playing). BLUE! #2 is the other case: an audio-only Mux
    // override that stays 0×0 forever. Only hide the visual layer after
    // playback has actually started and dimensions still never arrive.
    // Failing at metadata time was hiding every featured Mux music video.
    let visualFailTimer: ReturnType<typeof setTimeout> | null = null;
    const hasVisualTrack = () => video.videoWidth > 0 && video.videoHeight > 0;
    const confirmVisualTrack = () => {
      if (!hasVisualTrack()) return false;
      if (visualFailTimer) {
        clearTimeout(visualFailTimer);
        visualFailTimer = null;
      }
      setVideoLayerFailed(false);
      setMediaAspect(video.videoWidth / video.videoHeight);
      applyPlaybackPlanToNft(nft, playbackPlan);
      return true;
    };
    const scheduleVisualFail = () => {
      if (visualFailTimer || hasVisualTrack()) return;
      visualFailTimer = setTimeout(() => {
        visualFailTimer = null;
        if (!hasVisualTrack()) setVideoLayerFailed(true);
      }, 1500);
    };
    const onLoadedMetadata = () => {
      if (confirmVisualTrack()) return;
      if (!video.paused || video.currentTime > 0) scheduleVisualFail();
    };
    const onPlayingOrData = () => {
      if (!confirmVisualTrack()) scheduleVisualFail();
    };
    if (video.readyState >= 1) onLoadedMetadata();
    if (!video.paused || video.currentTime > 0) onPlayingOrData();
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onPlayingOrData);
    video.addEventListener('resize', onPlayingOrData);
    video.addEventListener('playing', onPlayingOrData);

    if (clock) {
      video.preload = 'auto';
      video.loop = false;
      return () => {
        if (visualFailTimer) clearTimeout(visualFailTimer);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('loadeddata', onPlayingOrData);
        video.removeEventListener('resize', onPlayingOrData);
        video.removeEventListener('playing', onPlayingOrData);
      };
    }

    const videoUrl = processMediaUrl(
      rewriteLegacyOpenSeaMediaUrl(rawVideoSrc, nft.contract, nft.network),
      '',
      'audio'
    );
    video.muted = true;
    video.loop = true;
    video.preload = 'none';
    if ((video.currentSrc || video.src) !== videoUrl) {
      video.src = videoUrl;
    }

    const onError = () => {
      playerLogger.warn('Error loading video:', {
        nft: nft.name || 'Unknown NFT',
        mediaKey: getMediaKey(nft),
        error: video.error?.message || 'Unknown error',
      });
      setVideoLayerFailed(true);
    };
    video.addEventListener('error', onError);

    return () => {
      if (visualFailTimer) clearTimeout(visualFailTimer);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onPlayingOrData);
      video.removeEventListener('resize', onPlayingOrData);
      video.removeEventListener('playing', onPlayingOrData);
      video.removeEventListener('error', onError);
    };
  }, [rawVideoSrc, nft.contract, nft.tokenId, nft.network, playbackPlan.mode, playbackPlan.muteVideo, playbackPlan.videoUrl]);

  const handleMinimizeToggle = () => {
    dismissMinimizeHint();
    onMinimizeToggle();
  };

  // Minimizing sets aria-hidden on this whole container — but the button the
  // user just tapped (minimize, like, etc.) still has DOM focus at that exact
  // moment. Blur it first so focus isn't trapped inside a hidden subtree
  // ("Blocked aria-hidden on an element because its descendant retained focus").
  useEffect(() => {
    if (isMinimized && rootRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [isMinimized]);

  const iconButtonClass =
    'p-2 rounded-full bg-black/45 backdrop-blur-md border border-white/10 text-white/90 active:scale-95 transition-transform touch-manipulation';
  const progressPercent = safeProgressPercent(
    scrubPosition !== null ? scrubPosition : progress,
    duration
  );

  // Companion video only — when the <video> is the playback clock, useAudioPlayer owns play/mute.
  useEffect(() => {
    if (!hasVideoLayer || !isPlaying || !playbackPlan.muteVideo) return;

    let cancelled = false;
    let attempts = 0;

    const kickVideo = () => {
      if (cancelled) return;
      const video =
        videoRef.current ||
        (document.getElementById(
          `video-${nft.contract}-${nft.tokenId}`
        ) as HTMLVideoElement | null);

      if (!video) {
        if (attempts++ < 20) {
          window.setTimeout(kickVideo, 50);
        }
        return;
      }

      video.muted = true;
      // No seeking — see note in onLoadedData. Range requests aren't supported by
      // many Arweave gateways, so forcing currentTime causes a full re-fetch stall.
      if (video.paused) {
        video.play().catch(() => {
          if (attempts++ < 10) {
            window.setTimeout(kickVideo, 100);
          }
        });
      }
    };

    kickVideo();
    return () => {
      cancelled = true;
    };
  }, [hasVideoLayer, isPlaying, nft.contract, nft.tokenId, playbackPlan.muteVideo]);

  // Mirror play/pause for muted companion video only.
  useEffect(() => {
    if (!playbackPlan.muteVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, playbackPlan.muteVideo]);

  // No drift-correction seeking here — many Arweave gateways don't support Range
  // requests, so any forced currentTime assignment stalls playback (looks like
  // skipping). Since this video is a muted cosmetic loop, we accept drift from
  // the audio's position rather than repeatedly re-triggering that stall.

  // Add these helper functions below your existing functions
  const timeFromClientX = (clientX: number) => {
    if (!progressBarRef.current || !Number.isFinite(duration) || duration <= 0) return null;
    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return duration * percent;
  };

  const updateScrubPosition = (clientX: number) => {
    const time = timeFromClientX(clientX);
    if (time === null) return;
    scrubPositionRef.current = time;
    setScrubPosition(time);
  };

  const commitSeekFromClientX = (clientX: number) => {
    const time = timeFromClientX(clientX) ?? scrubPositionRef.current;
    if (time === null) return;
    onSeek(time);
  };

  const handleProgressBarMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    updateScrubPosition(e.clientX);
    
    // Add event listeners for mouse movement and release
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDraggingRef.current) {
      updateScrubPosition(e.clientX);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (isDraggingRef.current) {
      commitSeekFromClientX(e.clientX);
      
      // Reset state
      isDraggingRef.current = false;
      setIsDragging(false);
      scrubPositionRef.current = null;
      setScrubPosition(null);
      
      // Remove event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };

  // Add this to your useEffect cleanup
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // No force touch - use simple touch and hold instead
  const handleTouchStart = (e: React.TouchEvent) => {
    // Prevent default behavior to avoid iOS force touch menu
    e.preventDefault();
    
    // Immediately start scrubbing - no need to wait for force press
    setIsActivelyScrubbingBar(true);
    updateScrubPosition(e.touches[0].clientX);
    
    // Cancel any existing timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isActivelyScrubbingBar) {
      e.preventDefault(); // Prevent scrolling
      updateScrubPosition(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (isActivelyScrubbingBar) {
      seekedFromTouchRef.current = true;
      if (touch) {
        commitSeekFromClientX(touch.clientX);
      } else if (scrubPositionRef.current !== null) {
        onSeek(scrubPositionRef.current);
      }
    }
    
    // Reset states
    setIsActivelyScrubbingBar(false);
    scrubPositionRef.current = null;
    setScrubPosition(null);
    
    // Clear any existing timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  // Add this to clean up any timers when component unmounts
  useEffect(() => {
    return () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }
    };
  }, [longPressTimer]);

  // Keep the exact same JSX as the original Player component for the maximized state
  return (
    <>
      <div
        ref={rootRef}
        className={
          isMinimized
            ? 'fixed bottom-20 left-0 z-0 w-px h-px overflow-hidden opacity-0 pointer-events-none'
            : 'fixed inset-0 z-[100] bg-black will-change-transform flex flex-col overflow-hidden'
        }
        style={isMinimized ? undefined : { backfaceVisibility: 'hidden' }}
        aria-hidden={isMinimized}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {resolvedImageUrl && (
            <img
              src={resolvedImageUrl}
              alt=""
              className="w-full h-full object-cover scale-125 blur-3xl opacity-35"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/70 to-black" />
        </div>

        <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
          <div
            className="flex-none"
            style={{ height: 'max(3.25rem, calc(env(safe-area-inset-top) + 2.75rem))' }}
            aria-hidden
          />
          <div ref={stageRef} className="relative z-[1] flex-1 min-h-0 flex flex-col items-center px-3">
            <div className="flex-1 min-h-0 w-full" aria-hidden />
            <div
              className="relative shrink-0"
              style={
                mediaBox.width > 0
                  ? { width: mediaBox.width, height: mediaBox.height }
                  : { width: '100%', flex: '1 1 auto', minHeight: 0 }
              }
            >
              {hasVideoLayer && (
                <div
                  className={
                    showVideoVisually
                      ? 'w-full h-full'
                      : 'fixed left-0 bottom-20 w-px h-px opacity-0 pointer-events-none overflow-hidden'
                  }
                  aria-hidden={!showVideoVisually}
                >
                  {renderVideo()}
                </div>
              )}
              {!showVideoVisually && (
                <div className="relative w-full h-full flex items-center justify-center">
                  {(nft.name === 'ACYL RADIO - Hidden Tales' || nft.name === 'ACYL RADIO - WILL01' || nft.name === 'ACYL RADIO - Chili Sounds 🌶️') ? (
                    <img
                      src={resolvedImageUrl}
                      alt={nft.name}
                      className="max-w-full max-h-full w-auto h-auto object-contain"
                      width={720}
                      height={720}
                      style={{
                        willChange: 'transform',
                        transform: 'translateZ(0)',
                      }}
                    />
                  ) : (
                    <NFTImage
                      src={resolvedImageUrl}
                      alt={nft.name}
                      className="max-w-full max-h-full w-auto h-auto object-contain"
                      width={720}
                      height={720}
                      priority={true}
                      nft={nft}
                      key={`thumb-${nft.contract}-${nft.tokenId}`}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center min-h-[2.75rem] w-full px-1">
              <h2 className="text-white text-base font-semibold truncate text-center w-full">
                {nft.name}
              </h2>
            </div>
          </div>

          <div
            className={`absolute top-0 left-0 right-0 z-10 px-3 pb-10 flex justify-between items-start pointer-events-none bg-gradient-to-b from-black/75 via-black/30 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            <div className={`flex items-center gap-2 pointer-events-auto ${showControls ? '' : 'pointer-events-none'}`}>
              {canLike && (
                <button
                  type="button"
                  onClick={() => onLikeToggle?.(nft)}
                  className={`${iconButtonClass} ${isLiked ? 'text-red-500' : ''}`}
                  aria-label={isLiked ? 'Unlike' : 'Like'}
                >
                  {isLiked ? (
                    <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                      <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                      <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                    </svg>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowInfo(true)}
                className={iconButtonClass}
                aria-label="Show NFT information"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                  <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
                </svg>
              </button>
            </div>
            <div className={`flex items-center gap-2 pointer-events-auto ${showControls ? '' : 'pointer-events-none'}`}>
              {Boolean(nft.contract && nft.tokenId) && (
                <button
                  type="button"
                  disabled={sharing}
                  onClick={async () => {
                    setSharing(true);
                    try {
                      await shareNftToFarcaster({
                        contract: nft.contract,
                        tokenId: String(nft.tokenId),
                        name: nft.name,
                      });
                    } finally {
                      setSharing(false);
                    }
                  }}
                  className={iconButtonClass}
                  aria-label="Share to Farcaster"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                    <path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"/>
                  </svg>
                </button>
              )}
              {showVideoVisually && (
                <button
                  type="button"
                  onClick={handlePictureInPicture}
                  className={iconButtonClass}
                  aria-label="Picture in picture"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                    <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Zm280-200h320v-240H440v240Zm80-80v-80h160l-80-80-80 80Z"/>
                  </svg>
                </button>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleMinimizeToggle}
                  className={iconButtonClass}
                  aria-label="Back to mini player"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor">
                    <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z"/>
                  </svg>
                </button>
                <PlayerArrowHint
                  visible={showMinimizeHint && showControls}
                  text="Back to mini player"
                  placement="below"
                />
              </div>
            </div>
          </div>

          <div
            className={`relative z-10 flex-none px-4 pt-3 bg-gradient-to-t from-black via-black/80 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              ref={progressBarRef}
              className={`relative ${isActivelyScrubbingBar ? 'h-3' : 'h-1.5'} bg-white/10 rounded-full mb-1.5 transition-all duration-150 touch-none cursor-pointer`}
              onMouseDown={handleProgressBarMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onClick={async (e) => {
                e.stopPropagation();
                if (seekedFromTouchRef.current) {
                  seekedFromTouchRef.current = false;
                  return;
                }
                await triggerHaptic('light', 'MaximizedPlayer-Seek');
                commitSeekFromClientX(e.clientX);
              }}
            >
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-fuchsia-400 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
              <div
                className={`absolute top-1/2 rounded-full bg-white shadow-md shadow-black/40 transform -translate-y-1/2 ${
                  isActivelyScrubbingBar ? 'h-5 w-5' : 'h-3.5 w-3.5'
                }`}
                style={{ left: `calc(${progressPercent}% - ${isActivelyScrubbingBar ? 10 : 7}px)` }}
              />
              {isActivelyScrubbingBar && scrubPosition !== null && (
                <div
                  className="absolute -top-10 py-1 px-3 bg-black/90 text-white text-sm font-medium rounded-full transform -translate-x-1/2 shadow-lg border border-white/10"
                  style={{ left: `${safeProgressPercent(scrubPosition, duration)}%` }}
                >
                  {formatTime(getDisplayTimes(scrubPosition, duration).elapsed)}
                </div>
              )}
            </div>

            <div className="flex justify-between text-white/50 text-xs tabular-nums mb-3">
              <span>{formatTime(displayElapsed)}</span>
              <span>-{formatTime(displayRemaining)}</span>
            </div>

            <div className="flex justify-center items-center gap-8 pb-1">
              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic('light', 'MaximizedPlayer-Previous');
                  onPrevious?.();
                }}
                className="text-white active:scale-95 transition-transform disabled:opacity-30 touch-manipulation"
                disabled={!onPrevious}
                aria-label="Previous"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="28" viewBox="0 -960 960 960" width="28" fill="currentColor">
                  <path d="M220-240v-480h80v480h-80Zm440 0v-480l-360 240 360 240Z"/>
                </svg>
              </button>

              <PlaybackButton
                isPlaying={isPlaying}
                onClick={onPlayPause}
                size="large"
                className="bg-purple-500 shadow-lg shadow-purple-500/40 ring-4 ring-purple-400/25"
                hapticLabel="MaximizedPlayer"
              />

              <button
                type="button"
                onClick={async () => {
                  await triggerHaptic('light', 'MaximizedPlayer-Next');
                  onNext?.();
                }}
                className="text-white active:scale-95 transition-transform disabled:opacity-30 touch-manipulation"
                disabled={!onNext}
                aria-label="Next"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="28" viewBox="0 -960 960 960" width="28" fill="currentColor">
                  <path d="M660-240v-480h80v480h-80ZM220-240v-480l360 240-360 240Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      {showInfo && !isMinimized && (
        <InfoPanel
          nft={nft}
          onClose={() => setShowInfo(false)}
          isLiked={Boolean(isLiked)}
          onOpenArtistProfile={onOpenArtistProfile}
        />
      )}
    </>
  );
};