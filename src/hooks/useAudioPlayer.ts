import { useState, useEffect, useRef, useCallback } from 'react';
import { NFT } from '../types/user';
import { trackNFTPlay as originalTrackNFTPlay, recordRecentPlay } from '../lib/firebase';
import { v4 as uuidv4 } from 'uuid';

// Wrapper for trackNFTPlay that respects the 25% threshold requirement
// This is a global variable to track which NFTs have been played immediately
const immediatelyTrackedNFTs = new Set<string>();

// This function wraps the original trackNFTPlay to implement the 25% threshold logic
const trackNFTPlay = (nft: NFT, fid: number, options?: { forceTrack?: boolean, thresholdReached?: boolean }) => {
  // CRITICAL: Use mediaKey as the primary identifier for this NFT
  // This ensures identical content is tracked together regardless of contract/tokenId
  const mediaKey = nft.mediaKey || getMediaKey(nft);
  // For backwards compatibility, also track the legacy nftKey
  const legacyNftKey = `${nft.contract}-${nft.tokenId}`;
  
  // If this is an immediate tracking call (from handlePlayAudio) and not forced
  if (!options?.forceTrack && !options?.thresholdReached) {
    // Just mark this NFT as having been immediately tracked
    // Add both mediaKey and legacy key to support transition
    if (mediaKey) immediatelyTrackedNFTs.add(mediaKey);
    immediatelyTrackedNFTs.add(legacyNftKey);
    audioLogger.info(`Skipping immediate play tracking for NFT: ${nft.name} - will track at 25% threshold`);
    return Promise.resolve(); // Return a resolved promise to maintain the same interface
  }
  
  // If we're tracking because threshold was reached, or it's forced
  if (options?.thresholdReached || options?.forceTrack) {
    // Actually track the play
    audioLogger.info(`${options?.thresholdReached ? '25% threshold reached' : 'Forced tracking'} - Recording play count for NFT: ${nft.name}`);
    return originalTrackNFTPlay(nft, fid, options);
  }
  
  // Default case - shouldn't happen but included for completeness
  return Promise.resolve();
};
import { processMediaUrl, getMediaKey, buildArweaveAudioFallbackUrls, buildIpfsFallbackUrls, extractIPFSPath } from '../utils/media';
import { applyPlaybackPlanToNft, getNftPlaybackPlan, resolveNftPlaybackPlan } from '../utils/isMediaNFT';
import { logger } from '../utils/logger';
import { useToast } from './useToast';
import { markNftMediaDead } from '../utils/deadNftRegistry';
import { prioritizeRememberedUrl, rememberWorkingMediaUrl, forgetMediaUrl, getRememberedMediaUrl } from '../utils/gatewayMemory';

// Create a dedicated logger for this module
const audioLogger = logger.getModuleLogger('audioPlayer');

// Extend Window interface to include our custom property
declare global {
  interface Window {
    nftList: NFT[];
  }
}

export interface UseAudioPlayerProps {
  fid?: number;
  setRecentlyPlayedNFTs?: React.Dispatch<React.SetStateAction<NFT[]>>;
  recentlyAddedNFT?: React.MutableRefObject<string | null>;
}

type UseAudioPlayerReturn = {
  isPlaying: boolean;
  currentPlayingNFT: NFT | null;
  currentlyPlaying: string | null;
  audioProgress: number;
  audioDuration: number;
  handlePlayAudio: (nft: NFT) => Promise<void>;
  handlePlayPause: () => void;
  handlePlayNext: () => void;
  handlePlayPrevious: () => void;
  handleSeek: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

type AudioPlayerHandles = {
  play: () => void;
  pause: () => void;
  ended: () => void;
  loadedmetadata: () => void;
  timeupdate: () => void;
}

export const useAudioPlayer = ({ fid = 1, setRecentlyPlayedNFTs, recentlyAddedNFT }: UseAudioPlayerProps = {}): UseAudioPlayerReturn => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayingNFT, setCurrentPlayingNFT] = useState<NFT | null>(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [currentQueue, setCurrentQueue] = useState<NFT[]>([]);
  const [queueType, setQueueType] = useState<string>('default');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentFallbackIndex, setCurrentFallbackIndex] = useState<number>(0);
  const [error, setError] = useState<Error | null>(null);
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([]);
  const fallbackStateRef = useRef({
    currentIndex: 0,
    urls: [] as string[]
  });
  const { error: showErrorToast } = useToast();

  const handleError = useCallback((e: Event) => {
    const target = e.target as HTMLAudioElement;
    const error = target.error;
    const errorMessage = error ? `Error ${error.code}: ${error.message}` : 'Unknown error';
    logger.error('Audio error:', errorMessage, {
      currentSrc: target.currentSrc,
      networkState: target.networkState,
      readyState: target.readyState
    });

    // Only attempt fallback if we haven't tried all fallbacks yet
    if (fallbackStateRef.current.currentIndex < fallbackStateRef.current.urls.length - 1) {
      const nextIndex = fallbackStateRef.current.currentIndex + 1;
      fallbackStateRef.current.currentIndex = nextIndex;
      const nextUrl = fallbackStateRef.current.urls[nextIndex];
      
      // Reset error state before trying next URL
      setError(null);
      
      // Small delay to ensure clean state
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = nextUrl;
          audioRef.current.load();
          audioRef.current.play().catch(err => {
            logger.error('Failed to play fallback URL:', err);
            setError(err);
          });
        }
      }, 100);
    } else {
      // If we've tried all fallbacks, set the error state
      setError(new Error(errorMessage));
    }
  }, [logger]);

  // Update fallback URLs when they change
  useEffect(() => {
    fallbackStateRef.current.urls = fallbackUrls;
    fallbackStateRef.current.currentIndex = 0;
  }, [fallbackUrls]);

  useEffect(() => {
    if (!audioRef.current) return;

    // Add error handler to log audio errors
    audioRef.current.addEventListener('error', handleError);
    
    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener('error', handleError);
      }
    };
  }, [handleError]);

  useEffect(() => {
    // Initialize the audio element if it doesn't exist
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.crossOrigin = 'anonymous';
      audioLogger.info('Created new audio element');
    }
    
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (!Number.isFinite(audio.duration)) return;
      
      // Round to prevent micro-updates that cause UI jitter
      const currentTime = Math.floor(audio.currentTime * 10) / 10; // Round to 0.1s precision
      const duration = Math.floor(audio.duration * 10) / 10;
      
      setAudioProgress(currentTime);
      setAudioDuration(duration);
    };

    const handleLoadedMetadata = () => {
      audioLogger.info('Audio metadata loaded:', {
        duration: audio.duration,
        currentTime: audio.currentTime
      });
      // Some gateways stream audio without a proper Content-Length, so duration
      // can be NaN/Infinity here — don't display "NaN:NaN" for that, wait for
      // durationchange (below) to report the real value once it's known.
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
      setAudioProgress(audio.currentTime);
    };

    // Some gateways only reveal the true duration after the browser has
    // buffered enough of the stream — this fires when that correction happens.
    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setAudioProgress(0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    // Add timeupdate event to track progress
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      // Clean up event listeners when component unmounts
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      
      // Pause audio and reset when unmounting
      audio.pause();
      audio.src = '';
      audio.load(); // Reset the audio element
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;

    const video =
      currentPlayingNFT
        ? (document.getElementById(
            `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
          ) as HTMLVideoElement | null)
        : null;

    if (isPlaying) {
      audioRef.current.pause();
      video?.pause();
    } else {
      audioRef.current.play().catch((error) => {
        audioLogger.error('Error in handlePlayPause:', error);
        setIsPlaying(false);
      });
      if (video) {
        video.muted = true;
        // No seeking on resume — many Arweave gateways don't support Range requests,
        // so forcing currentTime forces a full re-fetch that stalls/"skips" playback.
        video.play().catch(() => {});
      }
    }
  }, [isPlaying, currentPlayingNFT]);

  // Track blob URLs to clean up
  const blobUrlsRef = useRef<string[]>([]);
  
  // Function to clean up blob URLs
  const cleanupBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => {
      try {
        URL.revokeObjectURL(url);
        audioLogger.info('Revoked blob URL:', url);
      } catch (error) {
        audioLogger.error('Error revoking blob URL:', error);
      }
    });
    blobUrlsRef.current = [];
  }, []);
  
  // Clean up resources when component unmounts
  useEffect(() => {
    return () => {
      cleanupBlobUrls();
      
      // Clean up audio element
      if (audioRef.current) {
        audioRef.current.pause();
        // Instead of setting empty src, remove the source element
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, [cleanupBlobUrls]);
  
  // Define handlePlayAudio first, before it's used in other functions
  const handlePlayAudio = useCallback(async (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => {
    // Add mobile optimization
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Always update queue context
    if (context?.queue) {
      setCurrentQueue(context.queue);
      setQueueType(context.queueType || 'default');
    } else if (!currentQueue.length) {
      // If no queue exists, create a single-item queue
      setCurrentQueue([nft]);
      setQueueType('single');
    }
    audioLogger.info('handlePlayAudio called with NFT:', nft);

    // Use sync plan so audio starts immediately — never block on network probes here.
    // resolveNftPlaybackPlan (which probes Content-Type) runs in background and updates
    // nft fields so MaximizedPlayer picks up the video layer after open.
    const plan = getNftPlaybackPlan(nft);
    applyPlaybackPlanToNft(nft, plan);
    if (!plan.videoUrl && !nft.metadata?.mimeType) {
      void resolveNftPlaybackPlan(nft).then((resolved) => applyPlaybackPlanToNft(nft, resolved));
    }
    audioLogger.info('NFT playback plan:', {
      mode: plan.mode,
      audioUrl: plan.audioUrl?.slice(0, 80),
      videoUrl: plan.videoUrl?.slice(0, 80),
      name: nft.name,
    });

    // Sound source: dedicated audio, or the video file's audio track
    const rawAudioUrl =
      plan.audioUrl ||
      nft.audio ||
      plan.videoUrl ||
      nft.metadata?.animation_url;

    if (!rawAudioUrl) {
      audioLogger.error('No audio URL found for NFT');
      return;
    }
    
    // Generate multiple potential URLs for fallback
    const audioUrls: string[] = [];
    
    // Special handling for Arweave / PODs URLs — try multiple gateways + direct file tx
    if (rawAudioUrl.startsWith('ar://') || /arweave\.(net|dev)|permagate\.io|turbo-gateway\.com|irys\.xyz|ar-io\.dev|g8way\.io/i.test(rawAudioUrl)) {
      // Plain https://arweave.net/{tx} URLs work via arweave.net's CDN — keep them first.
      // Only ar:// and non-arweave.net gateway URLs need to be rebuilt through turbo/permagate.
      if (rawAudioUrl.startsWith('https://arweave.net/') || rawAudioUrl.startsWith('http://arweave.net/')) {
        audioUrls.push(rawAudioUrl);
        // Turbo/permagate as fallbacks in case arweave.net CDN misses
        const fallbacks = buildArweaveAudioFallbackUrls(rawAudioUrl).filter(u => u !== rawAudioUrl);
        audioUrls.push(...fallbacks);
      } else {
        const arweaveFallbacks = buildArweaveAudioFallbackUrls(rawAudioUrl);
        audioUrls.push(...arweaveFallbacks);
      }
      audioLogger.info('Generated Arweave audio URLs across gateways:', {
        count: audioUrls.length,
        primary: audioUrls[0],
      });
    }
    // IPFS — try multiple gateways (cloudflare-ipfs.com DNS is dead)
    else if (rawAudioUrl.startsWith('ipfs://') || extractIPFSPath(rawAudioUrl)) {
      const ipfsFallbacks = buildIpfsFallbackUrls(rawAudioUrl);
      audioUrls.push(...ipfsFallbacks);
      audioLogger.info('Generated IPFS audio URLs across gateways:', {
        count: ipfsFallbacks.length,
        urls: ipfsFallbacks.slice(0, 4),
      });
    }
    // Standard URL processing for other URLs
    else {
      // 1. Process using our standard processMediaUrl function
      const processedUrl = processMediaUrl(rawAudioUrl, undefined, 'audio');
      if (processedUrl && processedUrl !== 'undefined' && processedUrl !== 'null') {
        audioUrls.push(processedUrl);
      }
      
      // 2. If it's already an HTTPS URL, add it directly
      if (rawAudioUrl.startsWith('https://')) {
        if (!audioUrls.includes(rawAudioUrl)) {
          audioUrls.push(rawAudioUrl);
        }
      }
    }
    
    // If we couldn't generate any valid URLs, log error and return
    if (audioUrls.length === 0) {
      audioLogger.error('Failed to generate any valid audio URLs', { raw: rawAudioUrl });
      return;
    }

    // If a gateway has already proven itself for this exact media, try it first —
    // skips redoing the same trial-and-error cascade on every repeat play.
    const mediaKeyForMemory = nft.mediaKey || getMediaKey(nft);
    const prioritizedAudioUrls = prioritizeRememberedUrl(mediaKeyForMemory, 'audio', audioUrls);

    // Use the first URL as our primary
    const audioUrl = prioritizedAudioUrls[0];
    
    // Store all URLs for fallback
    const fallbackUrls = prioritizedAudioUrls.slice(1);
    
    // Log detailed information about the URL processing
    audioLogger.info('Processed audio URLs:', { 
      raw: rawAudioUrl,
      primary: audioUrl,
      fallbacks: fallbackUrls,
      nftName: nft.name,
      mediaKey: getMediaKey(nft)
    });

    // If same NFT is clicked, toggle play/pause
    if (currentlyPlaying === `${nft.contract}-${nft.tokenId}`) {
      audioLogger.info('Same NFT clicked, toggling play/pause');
      handlePlayPause();
      return;
    }

    // Stop current audio and video if playing
    if (audioRef.current) {
      audioLogger.info('Stopping current audio');
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setAudioProgress(0);
      setAudioDuration(0);
    }

    // Stop any currently playing videos
    const currentVideo = currentPlayingNFT ? 
      document.querySelector(`#video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`) : null;
    if (currentVideo instanceof HTMLVideoElement) {
      currentVideo.pause();
      currentVideo.currentTime = 0;
    }

    setCurrentPlayingNFT(nft);
    setCurrentlyPlaying(`${nft.contract}-${nft.tokenId}`);
    
    // Make sure the NFT has mediaKey for proper deduplication
    const mediaKey = mediaKeyForMemory;
    if (recentlyAddedNFT) {
      recentlyAddedNFT.current = mediaKey;
    }
    recordRecentPlay(nft, fid).catch((error) => {
      audioLogger.error('Error recording recent play:', error);
    });

    // IMPORTANT: Do NOT use unmuted <video> as the sound source.
    // Audio element always owns sound. If there's a video layer, it stays muted
    // and is synced as a visual companion (avoids double-audio + minimize/maximize desync).
    // Fall through to Audio element setup below.
    
    // EXISTING CODE for audio playback (all modes)
    if (audioRef.current) {
      // Create a new audio element for this NFT using the already processed URL
      audioLogger.info('Creating Audio element with URL:', audioUrl);
      
      // Use the existing audio element instead of creating a new one each time
      // This prevents memory leaks from accumulating audio elements
      const audio = audioRef.current;
      if (!audio) {
        audioLogger.error('Audio element reference is null');
        return;
      }
      
      // Reset the audio element
      audio.pause();
      audio.currentTime = 0;
      audio.crossOrigin = 'anonymous';
      
      // Add comprehensive error handling with multiple fallbacks
      let fallbackIndex = 0;
      let unplayableToastShown = false;
      const showUnplayableToast = () => {
        if (unplayableToastShown) return;
        unplayableToastShown = true;
        showErrorToast(`Couldn't play "${nft.name || 'this track'}" — its media file is currently unavailable.`);
        // Every fallback/gateway/last-resort URL is exhausted at this point — safe to
        // remember this NFT as dead so it stops showing up as "playable" elsewhere.
        markNftMediaDead(nft, 'audio');
      };
      
      audio.onerror = (e) => {
        const errorInfo = {
          error: e,
          code: audio.error?.code,
          message: audio.error?.message,
          url: audio.src,
          nftName: nft.name,
          mediaKey: getMediaKey(nft)
        };
        
        audioLogger.error('Audio element error:', errorInfo);

        // The gateway we remembered as "working" just failed — stop recommending it.
        if (audio.src === getRememberedMediaUrl(mediaKey, 'audio')) {
          forgetMediaUrl(mediaKey, 'audio');
        }
        
        // Try fallback URLs if available
        if (fallbackUrls.length > fallbackIndex) {
          const nextUrl = fallbackUrls[fallbackIndex];
          fallbackIndex++;
          
          audioLogger.info(`Trying fallback URL ${fallbackIndex} of ${fallbackUrls.length}:`, nextUrl);
          
          // Reset the audio element
          audio.pause();
          
          // Try the next URL
          audio.src = nextUrl;
          
          // Attempt to load and play
          const playPromise = audio.play();
          if (playPromise) {
            playPromise.catch(playError => {
              audioLogger.error('Error playing fallback URL:', { url: nextUrl, error: playError });
            });
          }
          
          return;
        }
        
        // If we've exhausted all fallbacks, try one last approach for Arweave URLs
        if (/arweave\.|permagate\.io|turbo-gateway|irys\.xyz|ar-io\.dev|g8way\.io/i.test(audioUrl) &&
            audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          audioLogger.error('All fallbacks failed. Attempting direct transaction access...', errorInfo);
          
          // Extract just the transaction ID and try direct access across gateways
          const urlParts = audio.src.split('/');
          let txId = '';
          
          // Find the part that looks like a transaction ID (43-character alphanumeric string)
          for (const part of urlParts) {
            const cleaned = part.replace(/\.(mp3|wav|ogg|m4a|flac|aac)$/i, '');
            if (/^[a-zA-Z0-9_-]{43}$/.test(cleaned)) {
              txId = cleaned;
              break;
            }
          }
          
          if (txId) {
            const lastResortUrls = buildArweaveAudioFallbackUrls(`ar://${txId}`);
            const lastResortUrl = lastResortUrls[0] || `https://arweave.net/${txId}`;
            audioLogger.info('Last resort: trying direct transaction URL:', lastResortUrl);
            
            // Reset the audio element
            audio.pause();
            audio.src = lastResortUrl;
            
            // Attempt to load and play
            const playPromise = audio.play();
            if (playPromise) {
              playPromise.catch(playError => {
                audioLogger.error('Error playing last resort URL:', { url: lastResortUrl, error: playError });
                showUnplayableToast();
              });
            }
            return;
          }
        }
        
        // Nothing left to try — let the user know instead of failing silently
        showUnplayableToast();
      };
      
      // Create a closure variable to track if this particular NFT play has been counted
      let playTracked = false;
      const nftKey = `${nft.contract}-${nft.tokenId}`;

      // IMPORTANT: assign via on___ properties (not addEventListener) so each new
      // handlePlayAudio call fully REPLACES the previous NFT's handlers instead of
      // stacking alongside them. With addEventListener, a quick click from NFT A to
      // NFT B left A's stale closure attached too — when B's metadata loaded, A's
      // leftover listener fired as well and (among other things) mis-attributed
      // gateway-memory / play-tracking to the wrong NFT, making rapid clicks appear
      // to "play the previous NFT".
      audio.onloadedmetadata = () => {
        audioLogger.info('Audio metadata loaded:', {
          duration: audio.duration,
          currentTime: audio.currentTime
        });
        // Some gateways stream audio without a proper Content-Length, so duration
        // can be NaN/Infinity here — never store that; ondurationchange below will
        // report the real value once the browser figures it out.
        if (Number.isFinite(audio.duration)) {
          setAudioDuration(audio.duration);
        }
        // Metadata loading means whatever URL is currently on the element actually
        // worked (whether it was the primary or one reached via the onerror fallback
        // cascade) — remember it so next time we skip straight past dead gateways.
        rememberWorkingMediaUrl(mediaKey, 'audio', audio.currentSrc || audio.src);
      };

      audio.ondurationchange = () => {
        if (Number.isFinite(audio.duration)) {
          setAudioDuration(audio.duration);
        }
      };

      audio.ontimeupdate = () => {
        setAudioProgress(audio.currentTime);
        
        // Count a play at 25% when duration is known. Streams that never report
        // a finite duration (common on Arweave) would otherwise never track.
        const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0;
        const reachedPercent = knownDuration && audio.currentTime >= audio.duration * 0.25;
        const reachedFallback = !knownDuration && audio.currentTime >= 15;
        if (!playTracked && (reachedPercent || reachedFallback)) {
          playTracked = true;
          
          if (mediaKey) {
            audioLogger.info(`🎵 Play count threshold reached for NFT: ${nft.name} (${Math.round(audio.currentTime)}s of ${knownDuration ? Math.round(audio.duration) : '?'}s) [mediaKey: ${mediaKey.substring(0, 20)}...]`);
          } else {
            audioLogger.info(`🎵 Play count threshold reached for NFT: ${nft.name}`);
          }
          
          trackNFTPlay(nft, fid, { thresholdReached: true }).catch(error => {
            audioLogger.error('Error tracking NFT play after threshold:', error);
          });
        }
      };

      audio.onplay = () => setIsPlaying(true);
      audio.onpause = () => setIsPlaying(false);
      audio.onended = () => {
        setIsPlaying(false);
        setAudioProgress(0);
      };

      // Stream Arweave / PODs audio directly (avoid blobbing large files like ~100MB episodes)
      // audio.onerror above walks fallbackUrls across turbo/permagate/raw gateways
      audio.src = audioUrl;
      audioLogger.info('Using Arweave gateway URL for audio playback:', audioUrl);

      // Replace the current audio reference
      audioRef.current = audio;

      // When setting up the audio element
      if (isMobile) {
        // Optimize for mobile
        audio.preload = "metadata"; // Only preload metadata first
        
        // Set a lower volume initially to avoid popping on mobile
        audio.volume = 0.7;
        
        // Use a smaller buffer size on mobile to reduce memory usage
        if ('mozFragmentSize' in audio) {
          (audio as any).mozFragmentSize = 1024; // Firefox-specific
        }
        
        // Use low latency mode on Android Chrome if available
        if ('webkitAudioContext' in window) {
          audio.dataset.lowLatency = 'true';
        }
      }

      try {
        if (isMobile) {
          // Improved mobile audio handling
          // First try to play normally without muting
          try {
            await audio.play();
            setIsPlaying(true);
          } catch (mobileError) {
            // If normal play fails, try the muted approach as fallback
            audioLogger.debug('First play attempt failed on mobile, trying muted approach');
            audio.muted = true; // Start muted to bypass autoplay restrictions
            
            try {
              await audio.play();
              // Autoplay started successfully with muting, now unmute
              setTimeout(() => {
                audio.muted = false;
              }, 300); // Small delay to ensure browser accepts the unmute
              setIsPlaying(true);
            } catch (mutedError) {
              // Both approaches failed
              audioLogger.warn("Mobile audio playback failed even with muting:", mutedError);
              setIsPlaying(false);
              throw mutedError; // Re-throw to be caught by the outer catch
            }
          }
        } else {
          // Normal desktop play behavior
          await audio.play();
          setIsPlaying(true);
        }
        
        // Muted visual companion only — never unmute (Audio owns sound)
        if (plan.videoUrl || plan.mode !== 'audio-only') {
          const newVideo = document.getElementById(
            `video-${nft.contract}-${nft.tokenId}`
          ) as HTMLVideoElement | null;
          if (newVideo) {
            newVideo.muted = true;
            // No seeking — many Arweave gateways don't support Range requests, so
            // forcing currentTime forces a full re-fetch that stalls/"skips" playback.
            newVideo.play().catch((error) => {
              if (!(error instanceof DOMException && error.name === 'AbortError')) {
                audioLogger.error('Error playing muted companion video:', error);
              }
            });
          }
        }
      } catch (error) {
        // Don't treat AbortError as an error - it's normal when ads trigger
        if (error instanceof DOMException && error.name === 'AbortError') {
          audioLogger.debug('Audio playback interrupted by ad system', {
            nftId: `${nft.contract}-${nft.tokenId}`,
            audioUrl: audioUrl,
            timestamp: new Date().toISOString()
          });
          // Don't set isPlaying to false for AbortError as the ad system will handle playback state
        } else {
          audioLogger.error("Error playing audio:", {
            error,
            nftId: `${nft.contract}-${nft.tokenId}`,
            audioUrl: audioUrl
          });
          setIsPlaying(false);
        }
      }
    }

    // iOS audio unlock only — do not reset video to 0 (desyncs from Audio)
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS && (plan.videoUrl || nft.isVideo)) {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const audioCtx = new AudioContext();
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start(0);
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        }
      } catch {
        // ignore
      }
    }
  }, [currentlyPlaying, handlePlayPause, fid, setRecentlyPlayedNFTs, recentlyAddedNFT]);
  
  // Now define handlePlayNext and handlePlayPrevious which use handlePlayAudio
  const handlePlayNext = useCallback(async () => {
    console.log('🔥 NEXT BUTTON PRESSED!');
    console.log('Current playing NFT:', currentPlayingNFT?.name);
    console.log('Current queue length:', currentQueue.length);
    console.log('Window.nftList length:', window.nftList?.length || 0);
    
    if (!currentPlayingNFT) {
      console.log('❌ No current playing NFT');
      return;
    }
    
    // Use the current queue that was set when the NFT was played
    // instead of relying on window.nftList
    if (currentQueue.length === 0) {
      console.log('❌ No queue available for next track');
      audioLogger.debug('No queue available for next track');
      return;
    }

    audioLogger.info('Next button pressed. Current queue length:', currentQueue.length);
    audioLogger.info('Current queue type:', queueType);
    
    // Find current index in the queue
    const currentIndex = currentQueue.findIndex(
      (nft: NFT) => nft.contract === currentPlayingNFT.contract && nft.tokenId === currentPlayingNFT.tokenId
    );

    console.log('Current index in queue:', currentIndex);
    audioLogger.info('Current index in queue:', currentIndex);

    if (currentIndex === -1) {
      console.log('❌ Current NFT not found in queue');
      audioLogger.debug('Current NFT not found in queue');
      return;
    }

    // Get next NFT in queue with wraparound
    const nextIndex = (currentIndex + 1) % currentQueue.length;
    const nextNFT = currentQueue[nextIndex];

    console.log('✅ Playing next NFT:', nextNFT?.name, 'at index:', nextIndex);
    audioLogger.info('Playing next NFT:', nextNFT.name, 'at index:', nextIndex);
    
    if (nextNFT) {
      // Pass the same queue context to maintain consistency
      await handlePlayAudio(nextNFT, { queue: currentQueue, queueType });
    }
  }, [currentPlayingNFT, handlePlayAudio, currentQueue, queueType]);

  const handlePlayPrevious = useCallback(async () => {
    console.log('🔥 PREVIOUS BUTTON PRESSED!');
    console.log('Current playing NFT:', currentPlayingNFT?.name);
    
    if (!currentPlayingNFT) {
      console.log('❌ No current playing NFT');
      return;
    }
    
    // Get the current queue from window.nftList which is set by the Demo component
    // based on the current page/category
    const currentPageQueue = window.nftList || [];
    console.log('Window.nftList length:', currentPageQueue.length);
    
    if (!currentPageQueue.length) {
      console.log('❌ No queue available for previous track');
      audioLogger.debug('No queue available for previous track');
      return;
    }

    audioLogger.info('Previous button pressed. Current queue length:', currentPageQueue.length);
    
    // Find current index in the current page queue
    const currentIndex = currentPageQueue.findIndex(
      (nft: NFT) => nft.contract === currentPlayingNFT.contract && nft.tokenId === currentPlayingNFT.tokenId
    );

    console.log('Current index in queue:', currentIndex);
    audioLogger.info('Current index in queue:', currentIndex);

    if (currentIndex === -1) {
      console.log('❌ Current NFT not found in queue');
      audioLogger.debug('Current NFT not found in queue');
      return;
    }

    // Get previous NFT in queue with wraparound
    const prevIndex = (currentIndex - 1 + currentPageQueue.length) % currentPageQueue.length;
    const prevNFT = currentPageQueue[prevIndex];

    console.log('✅ Playing previous NFT:', prevNFT?.name, 'at index:', prevIndex);
    audioLogger.info('Playing previous NFT:', prevNFT.name, 'at index:', prevIndex);
    
    if (prevNFT) {
      // Update our internal queue to match the page queue
      setCurrentQueue(currentPageQueue);
      await handlePlayAudio(prevNFT);
    }
  }, [currentPlayingNFT, handlePlayAudio]);

  const handleSeek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setAudioProgress(time);
    // Deliberately not seeking the companion video — many Arweave gateways don't
    // support Range requests, so forcing currentTime stalls playback (looks like
    // skipping). It's a muted cosmetic loop; audio position is what matters.
  }, [currentPlayingNFT]);

  // Add a function to set fallback URLs
  const setFallbackSources = useCallback((urls: string[]) => {
    setFallbackUrls(urls);
    setCurrentFallbackIndex(0);
  }, []);

  return {
    isPlaying,
    currentPlayingNFT,
    currentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause,
    handlePlayNext,
    handlePlayPrevious,
    handleSeek,
    audioRef
  };
}