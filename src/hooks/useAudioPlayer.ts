import { useState, useEffect, useRef, useCallback } from 'react';
import { NFT } from '../types/user';
import { trackNFTPlay as originalTrackNFTPlay } from '../lib/firebase';
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
    return originalTrackNFTPlay(nft, fid);
  }
  
  // Default case - shouldn't happen but included for completeness
  return Promise.resolve();
};
import { processMediaUrl, getMediaKey } from '../utils/media';
import { logger } from '../utils/logger';

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
      if (!audio.duration) return;
      setAudioProgress(audio.currentTime);
      setAudioDuration(audio.duration);
    };

    const handleLoadedMetadata = () => {
      audioLogger.info('Audio metadata loaded:', {
        duration: audio.duration,
        currentTime: audio.currentTime
      });
      setAudioDuration(audio.duration);
      setAudioProgress(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setAudioProgress(0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    // Add error handler to log audio errors
    const handleError = (e: Event) => {
      audioLogger.error('Audio element error:', {
        code: audio.error?.code,
        message: audio.error?.message,
        src: audio.src
      });
    };

    // Add timeupdate event to track progress
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      // Clean up event listeners when component unmounts
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      
      // Pause audio and reset when unmounting
      audio.pause();
      audio.src = '';
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      // Pause video if it exists
      if (currentPlayingNFT) {
        const video = document.querySelector(`#video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`);
        if (video instanceof HTMLVideoElement) {
          video.pause();
        }
      }
    } else {
      audioRef.current.play().catch(error => {
        audioLogger.error("Error in handlePlayPause:", error);
        setIsPlaying(false);
      }).then(() => {
        // Play video if it exists
        const video = document.querySelector('video');
        if (video) {
          video.play().catch(error => {
            audioLogger.error("Error playing video:", error);
          });
        }
      });
    }
  }, [isPlaying]);

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
        audioRef.current.src = '';
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

    // Get the raw audio URL from NFT
    const rawAudioUrl = nft.metadata?.animation_url || nft.audio;
    if (!rawAudioUrl) {
      audioLogger.error('No audio URL found for NFT');
      return;
    }
    
    // Generate multiple potential URLs for fallback
    const audioUrls: string[] = [];
    
    // Special handling for PODs audio URLs (ar:// protocol with path)
    if (rawAudioUrl.startsWith('ar://') && rawAudioUrl.includes('/')) {
      const segments = rawAudioUrl.replace('ar://', '').split('/');
      const txId = segments[0];
      const filePath = segments.slice(1).join('/');
      
      // 1. Full path URL - this is the most reliable for PODs audio
      const fullPathUrl = `https://arweave.net/${txId}/${filePath}`;
      audioUrls.push(fullPathUrl);
      
      // 2. Alternative gateway URL as fallback
      const altGatewayUrl = `https://arweave.dev/${txId}/${filePath}`;
      audioUrls.push(altGatewayUrl);
      
      // 3. Direct transaction URL as last resort
      const directTxUrl = `https://arweave.net/${txId}`;
      audioUrls.push(directTxUrl);
      
      audioLogger.info('Generated PODs audio URLs:', {
        fullPath: fullPathUrl,
        altGateway: altGatewayUrl,
        directTx: directTxUrl
      });
    } 
    // Standard URL processing for non-PODs URLs
    else {
      // 1. Process using our standard processMediaUrl function
      const processedUrl = processMediaUrl(rawAudioUrl, undefined, 'audio');
      if (processedUrl && processedUrl !== 'undefined' && processedUrl !== 'null') {
        audioUrls.push(processedUrl);
      }
      
      // 2. For Arweave URLs, add direct https://arweave.net/ URL as fallback
      if (rawAudioUrl.startsWith('ar://')) {
        const txId = rawAudioUrl.replace('ar://', '');
        const directArweaveUrl = `https://arweave.net/${txId}`;
        if (!audioUrls.includes(directArweaveUrl)) {
          audioUrls.push(directArweaveUrl);
        }
      }
      
      // 3. If it's already an HTTPS URL, add it directly
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
    
    // Use the first URL as our primary
    const audioUrl = audioUrls[0];
    
    // Store all URLs for fallback
    const fallbackUrls = audioUrls.slice(1);
    
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
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    
    // CRITICAL: Update the recentlyAddedNFT ref immediately to trigger the RecentlyPlayed component
    if (recentlyAddedNFT && mediaKey) {
      audioLogger.info(`📢 CRITICAL: Setting recentlyAddedNFT ref to: ${mediaKey}`);
      // Force a new value to trigger the useEffect in RecentlyPlayed
      recentlyAddedNFT.current = null;
      
      // Small delay to ensure the null value is registered
      setTimeout(() => {
        if (recentlyAddedNFT) {
          recentlyAddedNFT.current = mediaKey;
          audioLogger.info(`📢 CONFIRMED: recentlyAddedNFT ref set to: ${recentlyAddedNFT.current}`);
        }
      }, 50);
      
      // Clear the ref after a longer delay
      setTimeout(() => {
        if (recentlyAddedNFT && recentlyAddedNFT.current === mediaKey) {
          audioLogger.info(`📢 CLEARING: recentlyAddedNFT ref after delay`);
          recentlyAddedNFT.current = null;
        }
      }, 5000);
    } else {
      audioLogger.error(`❌ Cannot update recentlyAddedNFT ref: ${recentlyAddedNFT ? 'ref exists' : 'ref is null'}, ${mediaKey ? 'mediaKey exists' : 'mediaKey is null'}`);
    }

    // IMPORTANT: Immediately update the Recently Played list regardless of the 25% threshold
    // This ensures users can find NFTs they started playing even if they don't reach 25%
    if (setRecentlyPlayedNFTs) {
      // Update the local recently played state directly
      setRecentlyPlayedNFTs((prevNFTs: NFT[]) => {
        const newNFT: NFT = { ...nft };
        // Make sure the NFT has mediaKey for proper deduplication
        if (!newNFT.mediaKey) {
          newNFT.mediaKey = mediaKey; // Use the mediaKey we already generated
        }
        
        if (!mediaKey) {
          audioLogger.error('Could not generate mediaKey for NFT:', nft);
          return prevNFTs;
        }
        
        // Mark as immediately added to Recently Played (before 25% threshold)
        newNFT.addedToRecentlyPlayed = true;
        newNFT.addedToRecentlyPlayedAt = new Date().getTime();
        
        // Check if this NFT is already in the list
        const isDuplicate = prevNFTs.some(item => {
          const itemMediaKey = item.mediaKey || getMediaKey(item);
          const contract_tokenId = `${item.contract}-${item.tokenId}`;
          const new_contract_tokenId = `${nft.contract}-${nft.tokenId}`;
          
          return contract_tokenId === new_contract_tokenId || 
                 (itemMediaKey && mediaKey && itemMediaKey === mediaKey);
        });
        
        // Filter out NFTs with the same mediaKey to avoid duplicates
        const filteredNFTs = prevNFTs.filter(item => {
          const itemMediaKey = item.mediaKey || getMediaKey(item);
          const contract_tokenId = `${item.contract}-${item.tokenId}`;
          const new_contract_tokenId = `${nft.contract}-${nft.tokenId}`;
          
          // Check if this is actually the same NFT by contract-tokenId (as a fallback)
          if (contract_tokenId === new_contract_tokenId) {
            return false;
          }
          
          // Main mediaKey comparison (CRITICAL: primary mechanism for content-based tracking)
          if (itemMediaKey && mediaKey && itemMediaKey === mediaKey) {
            return false;
          }
          
          return true; // Keep this NFT in the filtered list
        });
        
        // Only log if we're actually adding a new NFT (not a duplicate)
        if (!isDuplicate) {
          audioLogger.info('Adding NFT to Recently Played (local state):', nft.name);
          audioLogger.info('Using mediaKey for deduplication:', mediaKey?.substring(0, 12) + '...');
          audioLogger.info('Local recently played update - previous count:', prevNFTs.length, 'new count:', filteredNFTs.length + 1);
        }
        
        // We already set the recentlyAddedNFT ref above, no need to do it again here
        
        // Add the new NFT to the beginning and limit to 8 items
        return [newNFT, ...filteredNFTs].slice(0, 8);
      });
    }
    
    // Track play in Firebase (but don't wait for the 25% threshold to update UI)
    try {
      // Track the play - our Firebase function will handle deduplication and the 25% threshold
      await trackNFTPlay(nft, fid);
    } catch (error) {
      audioLogger.error('Error tracking NFT play:', error);
    }

    // NEW CODE: Check if this is a video with embedded audio
    const isVideoWithEmbeddedAudio = nft.isVideo && 
      (nft.metadata?.animation_url?.match(/\.(mp4|webm|mov)$/i));

    if (isVideoWithEmbeddedAudio) {
      audioLogger.info('Playing video with embedded audio');
      
      // Find the video element
      const videoElement = document.querySelector(`#video-${nft.contract}-${nft.tokenId}`) as HTMLVideoElement;
      
      if (videoElement) {
        // Store references to all event listeners so we can remove them later
        const videoEventHandlers: Record<string, EventListener> = {};
        
        // Clean up any existing video event listeners to prevent memory leaks
        const cleanupVideoListeners = () => {
          Object.entries(videoEventHandlers).forEach(([event, handler]) => {
            try {
              videoElement.removeEventListener(event, handler);
              audioLogger.info(`Removed ${event} listener from video element`);
            } catch (error) {
              audioLogger.error(`Error removing ${event} listener:`, error);
            }
          });
        };
        
        // Clean up existing listeners first
        cleanupVideoListeners();
        
        // Unmute the video to hear its audio
        videoElement.muted = false;
        
        // Create a closure variable to track if this particular NFT play has been counted
        let playTracked = false;
        const mediaKey = getMediaKey(nft);
        const nftKey = `${nft.contract}-${nft.tokenId}`;
        
        // Define and store event handlers
        const timeUpdateHandler: EventListener = () => {
          setAudioProgress(videoElement.currentTime);
          
          // Check for 25% threshold without using component state
          if (!playTracked && videoElement.duration > 0 && videoElement.currentTime >= (videoElement.duration * 0.25)) {
            playTracked = true; // Mark as tracked to prevent duplicate counting
            
            // Only log mediaKey if available
            if (mediaKey) {
              audioLogger.info(`🎵 25% threshold reached for Video NFT: ${nft.name} (${Math.round(videoElement.currentTime)}s of ${Math.round(videoElement.duration)}s) [mediaKey: ${mediaKey.substring(0, 20)}...]`);
            } else {
              audioLogger.info(`🎵 25% threshold reached for Video NFT: ${nft.name} (${Math.round(videoElement.currentTime)}s of ${Math.round(videoElement.duration)}s)`);
            }
            
            // Track the play in Firebase with threshold flag
            trackNFTPlay(nft, fid, { thresholdReached: true }).catch(error => {
              audioLogger.error('Error tracking Video NFT play after 25% threshold:', error);
            });
          }
        };
        videoEventHandlers['timeupdate'] = timeUpdateHandler;
        
        const loadedMetadataHandler: EventListener = () => {
          setAudioDuration(videoElement.duration);
        };
        videoEventHandlers['loadedmetadata'] = loadedMetadataHandler;
        
        const playHandler: EventListener = () => setIsPlaying(true);
        videoEventHandlers['play'] = playHandler;
        
        const pauseHandler: EventListener = () => setIsPlaying(false);
        videoEventHandlers['pause'] = pauseHandler;
        
        const endedHandler: EventListener = () => {
          setIsPlaying(false);
          setAudioProgress(0);
          
          // Clean up listeners when video ends
          cleanupVideoListeners();
        };
        videoEventHandlers['ended'] = endedHandler;
        
        const errorHandler: EventListener = (e) => {
          audioLogger.error('Video playback error:', {
            error: e,
            videoSrc: videoElement.src,
            nft: nft.name
          });
          setIsPlaying(false);
          
          // Clean up listeners on error
          cleanupVideoListeners();
        };
        videoEventHandlers['error'] = errorHandler;
        
        // Add all event listeners
        Object.entries(videoEventHandlers).forEach(([event, handler]) => {
          videoElement.addEventListener(event, handler);
        });
        
        // Set up automatic cleanup after 30 minutes to prevent memory leaks
        // This is a safety measure in case the ended or error events don't fire
        const cleanupTimeout = setTimeout(() => {
          audioLogger.info('Automatic cleanup of video listeners after timeout');
          cleanupVideoListeners();
        }, 30 * 60 * 1000); // 30 minutes
        
        // Try to play the video with better error handling
        try {
          // Set playsInline for better mobile playback
          if ('playsInline' in videoElement) {
            videoElement.playsInline = true;
          }
          
          // Limit video buffer size for better memory usage
          if ('mozAutoplayEnabled' in videoElement || 'webkitPreservesPitch' in videoElement) {
            // These properties indicate we're on a mobile browser
            // Reduce buffer size to prevent memory issues
            videoElement.preload = 'metadata';
          }
          
          // Play the video with proper error handling
          const playPromise = videoElement.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                setIsPlaying(true);
                audioLogger.info('Video playback started successfully');
              })
              .catch(error => {
                audioLogger.error('Error playing video:', error);
                setIsPlaying(false);
                cleanupVideoListeners();
                clearTimeout(cleanupTimeout);
              });
          }
        } catch (error) {
          audioLogger.error('Exception during video playback setup:', error);
          setIsPlaying(false);
          cleanupVideoListeners();
        }
        
        // We're using the video element directly, so don't need the audio element
        return;
      }
    }
    
    // EXISTING CODE for audio-only or separate audio+image NFTs
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
        if (audioUrl.includes('arweave.net') && audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          audioLogger.error('All fallbacks failed. Attempting direct transaction access...', errorInfo);
          
          // Extract just the transaction ID and try direct access
          const urlParts = audioUrl.split('/');
          let txId = '';
          
          // Find the part that looks like a transaction ID (43-character alphanumeric string)
          for (const part of urlParts) {
            if (/^[a-zA-Z0-9_-]{43}$/.test(part)) {
              txId = part;
              break;
            }
          }
          
          if (txId) {
            const lastResortUrl = `https://arweave.net/${txId}`;
            audioLogger.info('Last resort: trying direct transaction URL:', lastResortUrl);
            
            // Reset the audio element
            audio.pause();
            audio.src = lastResortUrl;
            
            // Attempt to load and play
            const playPromise = audio.play();
            if (playPromise) {
              playPromise.catch(playError => {
                audioLogger.error('Error playing last resort URL:', { url: lastResortUrl, error: playError });
              });
            }
          }
        }
      };
      
      // For PODs audio files, we need to handle them specially
      if (rawAudioUrl.startsWith('ar://') && rawAudioUrl.includes('/')) {
        // Extract the transaction ID and file path
        const segments = rawAudioUrl.replace('ar://', '').split('/');
        const txId = segments[0];
        const filePath = segments.slice(1).join('/');
        
        // Track created blob URLs so we can revoke them later
        const blobUrlsRef = useRef<string[]>([]);
        
        // Clean up any existing blob URLs to prevent memory leaks
        const cleanupBlobUrls = () => {
          blobUrlsRef.current.forEach(url => {
            try {
              URL.revokeObjectURL(url);
              audioLogger.info('Revoked blob URL:', url);
            } catch (error) {
              audioLogger.error('Error revoking blob URL:', error);
            }
          });
          blobUrlsRef.current = [];
        };
        
        // Clean up existing blob URLs before creating new ones
        cleanupBlobUrls();
        
        // Create a blob URL from the audio data to ensure proper playback
        const fetchAndCreateBlobUrl = async (url: string) => {
          try {
            audioLogger.info('Fetching audio file directly:', url);
            const response = await fetch(url, { 
              method: 'GET',
              headers: {
                'Accept': 'audio/*'
              }
            });
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            // Track this blob URL for later cleanup
            blobUrlsRef.current.push(blobUrl);
            
            audioLogger.info('Created blob URL for audio:', blobUrl);
            return blobUrl;
          } catch (error) {
            audioLogger.error('Error fetching audio file:', { url, error });
            return null;
          }
        };
        
        // Try to fetch the audio file directly
        const arweaveUrl = `https://arweave.net/${txId}/${filePath}`;
        fetchAndCreateBlobUrl(arweaveUrl)
          .then(blobUrl => {
            if (blobUrl) {
              audio.src = blobUrl;
              audioLogger.info('Using blob URL for audio playback:', blobUrl);
            } else {
              // Try alternative gateway
              const altUrl = `https://arweave.dev/${txId}/${filePath}`;
              return fetchAndCreateBlobUrl(altUrl);
            }
          })
          .then(altBlobUrl => {
            if (altBlobUrl) {
              audio.src = altBlobUrl;
              audioLogger.info('Using alternative gateway blob URL:', altBlobUrl);
            }
          })
          .catch(error => {
            audioLogger.error('All audio fetch attempts failed:', error);
          });
      } else {
        // For non-PODs audio files, use the sequential fallback system
        let currentUrlIndex = 0;
        const tryNextUrl = () => {
          if (currentUrlIndex < audioUrls.length) {
            const urlToTry = audioUrls[currentUrlIndex];
            audioLogger.info(`Trying audio URL ${currentUrlIndex + 1}/${audioUrls.length}:`, urlToTry);
            
            // Check if URL ends with a known audio extension
            const hasAudioExtension = /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(urlToTry);
            let finalUrl = urlToTry;
            
            // If it's an Arweave URL without extension, try adding .mp3
            if (!hasAudioExtension && urlToTry.includes('arweave.net') && !urlToTry.includes('/')) {
              finalUrl = `${urlToTry}.mp3`;
              audioLogger.info('Adding .mp3 extension to URL:', finalUrl);
            }
            
            // Set the source and try to play
            audio.src = finalUrl;
            
            // Increment the index for the next attempt
            currentUrlIndex++;
          } else {
            audioLogger.error('All audio URLs failed, no more fallbacks available', {
              nft: nft.name,
              mediaKey: getMediaKey(nft),
              triedUrls: audioUrls
            });
          }
        };
        
        // Start with the first URL
        tryNextUrl();
        
        // Set up error handler to try the next URL
        audio.onerror = (e) => {
          audioLogger.error('Audio playback error, trying next URL', {
            error: e,
            currentUrl: audio.src,
            urlIndex: currentUrlIndex - 1
          });
          tryNextUrl();
        };
      }
      

      
      // Set up event listeners before loading
      audio.addEventListener('loadedmetadata', () => {
        audioLogger.info('Audio metadata loaded:', {
          duration: audio.duration,
          currentTime: audio.currentTime
        });
        setAudioDuration(audio.duration);
      });

      // Create a closure variable to track if this particular NFT play has been counted
      let playTracked = false;
      const mediaKey = getMediaKey(nft);
      const nftKey = `${nft.contract}-${nft.tokenId}`;
      
      audio.addEventListener('timeupdate', () => {
        setAudioProgress(audio.currentTime);
        
        // Check for 25% threshold without using component state
        // This uses a closure variable that's specific to this audio instance
        if (!playTracked && audio.duration > 0 && audio.currentTime >= (audio.duration * 0.25)) {
          playTracked = true; // Mark as tracked to prevent duplicate counting
          
          // Only log mediaKey if available
          if (mediaKey) {
            audioLogger.info(`🎵 25% threshold reached for NFT: ${nft.name} (${Math.round(audio.currentTime)}s of ${Math.round(audio.duration)}s) [mediaKey: ${mediaKey.substring(0, 20)}...]`);
          } else {
            audioLogger.info(`🎵 25% threshold reached for NFT: ${nft.name} (${Math.round(audio.currentTime)}s of ${Math.round(audio.duration)}s)`);
          }
          
          // Track the play in Firebase with threshold flag
          trackNFTPlay(nft, fid, { thresholdReached: true }).catch(error => {
            audioLogger.error('Error tracking NFT play after 25% threshold:', error);
          });
        }
      });

      audio.addEventListener('play', () => setIsPlaying(true));
      audio.addEventListener('pause', () => setIsPlaying(false));
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setAudioProgress(0);
      });

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
        
        // Start the new video
        const newVideo = document.querySelector(`#video-${nft.contract}-${nft.tokenId}`);
        if (newVideo instanceof HTMLVideoElement) {
          newVideo.play().catch(error => {
            // Only log video errors if they're not abort errors
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
              audioLogger.error("Error playing video:", error);
            }
          });
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

    // iOS-specific audio-video sync fix
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS && nft.isVideo) {
      // iOS often needs a user interaction to properly sync audio and video
      // Create a silent audio context to unlock audio
      const unlockAudio = () => {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const audioCtx = new AudioContext();
          // Create buffer for short sound
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start(0);
          
          // Resume audio context
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        }
      };
      
      unlockAudio();
      
      // For iOS, we need to ensure the video element is properly reset
      const videoElement = document.querySelector(`#video-${nft.contract}-${nft.tokenId}`);
      if (videoElement instanceof HTMLVideoElement) {
        // Reset video element for iOS
        videoElement.currentTime = 0;
        videoElement.load();
      }
    }
  }, [currentlyPlaying, handlePlayPause, fid, setRecentlyPlayedNFTs]);
  
  // Now define handlePlayNext and handlePlayPrevious which use handlePlayAudio
  const handlePlayNext = useCallback(async () => {
    if (!currentPlayingNFT) return;
    
    // Use the current queue that was set when the NFT was played
    // instead of relying on window.nftList
    if (currentQueue.length === 0) {
      audioLogger.debug('No queue available for next track');
      return;
    }

    audioLogger.info('Next button pressed. Current queue length:', currentQueue.length);
    audioLogger.info('Current queue type:', queueType);
    
    // Find current index in the queue
    const currentIndex = currentQueue.findIndex(
      (nft: NFT) => nft.contract === currentPlayingNFT.contract && nft.tokenId === currentPlayingNFT.tokenId
    );

    audioLogger.info('Current index in queue:', currentIndex);

    if (currentIndex === -1) {
      audioLogger.debug('Current NFT not found in queue');
      return;
    }

    // Get next NFT in queue with wraparound
    const nextIndex = (currentIndex + 1) % currentQueue.length;
    const nextNFT = currentQueue[nextIndex];

    audioLogger.info('Playing next NFT:', nextNFT.name, 'at index:', nextIndex);
    
    if (nextNFT) {
      // Pass the same queue context to maintain consistency
      await handlePlayAudio(nextNFT, { queue: currentQueue, queueType });
    }
  }, [currentPlayingNFT, handlePlayAudio, currentQueue, queueType]);

  const handlePlayPrevious = useCallback(async () => {
    if (!currentPlayingNFT) return;
    
    // Get the current queue from window.nftList which is set by the Demo component
    // based on the current page/category
    const currentPageQueue = window.nftList || [];
    
    if (!currentPageQueue.length) {
      audioLogger.debug('No queue available for previous track');
      return;
    }

    audioLogger.info('Previous button pressed. Current queue length:', currentPageQueue.length);
    
    // Find current index in the current page queue
    const currentIndex = currentPageQueue.findIndex(
      (nft: NFT) => nft.contract === currentPlayingNFT.contract && nft.tokenId === currentPlayingNFT.tokenId
    );

    audioLogger.info('Current index in queue:', currentIndex);

    if (currentIndex === -1) {
      audioLogger.debug('Current NFT not found in queue');
      return;
    }

    // Get previous NFT in queue with wraparound
    const prevIndex = (currentIndex - 1 + currentPageQueue.length) % currentPageQueue.length;
    const prevNFT = currentPageQueue[prevIndex];

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