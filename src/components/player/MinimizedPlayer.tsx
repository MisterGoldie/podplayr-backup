import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NFTImage } from '../media/NFTImage';
import type { NFT } from '../../types/user';
import InfoPanel from './InfoPanel';
import { logger } from '../../utils/logger';
import { FEATURED_NFTS } from '../sections/FeaturedSection';

// Create a dedicated logger for the MinimizedPlayer
const playerLogger = logger.getModuleLogger('minimizedPlayer');

// Props interface
interface MinimizedPlayerProps {
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
  isAnimating?: boolean;
  userFid?: number;
}

export const MinimizedPlayer: React.FC<MinimizedPlayerProps> = ({
  nft,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  onMinimizeToggle,
  progress,
  duration,
  onSeek,
  isMinimized,
  isAnimating,
  lastPosition,
  userFid = 0,
}) => {
  // State for swipe and info panel
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeDistance, setSwipeDistance] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [infoButtonClicked, setInfoButtonClicked] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  // Add this at the top with other state
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Add a ref to track the PiP video element
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  // Add state for tracking thumbnail loading status
  const [thumbLoaded, setThumbLoaded] = useState(false);
  
  // Use a ref to track the image container
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Add effects to find, control, and sync the video element
  useEffect(() => {
    if (!nft?.isVideo && !nft?.metadata?.animation_url) return;
    
    // Find the video element in the document
    const videoId = `video-${nft.contract}-${nft.tokenId}`;
    const videoElement = document.getElementById(videoId) as HTMLVideoElement;
    
    if (videoElement) {
      // Store reference
      videoRef.current = videoElement;
      
      // Don't control playback here - let the main effect below handle it
      // This prevents race conditions with multiple play/pause calls
      playerLogger.debug("Found video element in minimized player, storing reference");
    }
  }, [nft]);
  
  // Reference to track active play promises and prevent race conditions
  const activePlayPromiseRef = useRef<Promise<void> | null>(null);

  // Add effects to find, control, and sync the video element
  useEffect(() => {
    if (!nft?.isVideo && !nft?.metadata?.animation_url) return;
    
    // Find the video element in the document
    const videoId = `video-${nft.contract}-${nft.tokenId}`;
    const videoElement = document.getElementById(videoId) as HTMLVideoElement;
    
    if (videoElement) {
      // Store reference
      videoRef.current = videoElement;
      
      // Enhanced play/pause control with promise tracking
      if (isPlaying) {
        // Only attempt to play if actually paused to avoid duplicate play requests
        if (videoElement.paused) {
          playerLogger.debug("Starting playback in minimized player");
          
          // Store the play promise
          activePlayPromiseRef.current = videoElement.play();
          activePlayPromiseRef.current
            .then(() => {
              activePlayPromiseRef.current = null;
              playerLogger.debug("Playback started successfully in minimized player");
            })
            .catch(e => {
              activePlayPromiseRef.current = null;
              // Only log if it's not an AbortError (which is expected during transitions)
              if (e.name !== 'AbortError') {
                playerLogger.error("Minimized player video error:", e);
              }
            });
        }
      } else {
        // Handle pause with care around active play promises
        if (activePlayPromiseRef.current) {
          // Wait for the play promise to complete before pausing
          activePlayPromiseRef.current
            .then(() => {
              videoElement?.pause();
            })
            .catch(() => {
              // Play was already aborted, safe to pause
              videoElement?.pause();
            });
        } else {
          videoElement.pause();
        }
      }
    }
  }, [isPlaying, nft]);
  
  // Effect to handle video position sync during animations
  useEffect(() => {
    if (!nft?.isVideo && !nft?.metadata?.animation_url) return;
    
    if (isAnimating && lastPosition) {
      const videoId = `video-${nft.contract}-${nft.tokenId}`;
      const videoElement = document.getElementById(videoId) as HTMLVideoElement;
      
      if (videoElement) {
        playerLogger.debug("Animation detected, syncing video position to:", lastPosition);
        videoElement.currentTime = lastPosition;
        
        if (isPlaying) {
          // Add a small delay to prevent overlapping with other play/pause operations
          setTimeout(() => {
            // Only play if still paused and supposed to be playing
            if (videoElement && videoElement.paused && isPlaying) {
              videoElement.play().catch(e => {
                // Only log if it's not an AbortError (which is expected during transitions)
                if (e.name !== 'AbortError') {
                  playerLogger.error("Failed to play video during animation:", e);
                }
              });
            }
          }, 100); // Delay to prevent race conditions
        }
      }
    }
  }, [isAnimating, isMinimized, lastPosition, nft, isPlaying]);

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientY);
    setTouchEnd(e.targetTouches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    setTouchEnd(e.targetTouches[0].clientY);
    
    // Calculate the distance from start to current touch position
    const distance = touchStart - e.targetTouches[0].clientY;
    
    // Limit the distance to maxSwipeDistance
    const maxSwipeDistance = 100; // Max distance to swipe up
    const limitedDistance = Math.min(Math.max(distance, 0), maxSwipeDistance);
    
    setSwipeDistance(limitedDistance);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const maxSwipeDistance = 100;
    
    // If we've swiped more than 50% of the max distance, consider it a full swipe
    if (swipeDistance > maxSwipeDistance * 0.5) {
      // Handle swipe action
    }
    
    // Reset touch points
    setTouchStart(null);
    setTouchEnd(null);
    
    // Reset swipe distance over time (spring animation in CSS)
    setTimeout(() => {
      setSwipeDistance(0);
    }, 300);
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  // Handle info button click with animation
  const handleInfoButtonClick = () => {
    // Set the button as clicked to trigger animation
    setInfoButtonClicked(true);
    
    // Show the info panel
    setShowInfo(true);
    
    // Reset the button animation after it completes
    setTimeout(() => {
      setInfoButtonClicked(false);
    }, 400); // Match this to the animation duration
  };

  const springTransition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const maxSwipeDistance = 100;

  // Enhanced play/pause handler that directly controls PiP video
  const handlePlayPauseWithPipSync = () => {
    // First call the original handler to update app state
    onPlayPause();
    
    // Then directly control the PiP video if active
    const pipElement = document.pictureInPictureElement as HTMLVideoElement;
    if (pipElement) {
      playerLogger.debug('PiP element found, directly controlling it from minimized player');
      
      // Add a small delay to avoid race conditions with state updates
      setTimeout(() => {
        // Re-check if PiP is still active after the timeout
        if (document.pictureInPictureElement) {
          // Get fresh value of isPlaying (note: it will be the opposite of what it was
          // because onPlayPause already toggled it)
          if (!isPlaying) { // NOW it's paused after the toggle
            // We're going to pause
            pipElement.pause();
          } else { // NOW it's playing after the toggle
            // We're going to play, but only if actually paused
            if (pipElement.paused) {
              pipElement.play().catch(e => {
                // Only log if it's not an AbortError
                if (e.name !== 'AbortError') {
                  playerLogger.error('Error playing PiP video from minimized player:', e);
                }
              });
            }
          }
        }
      }, 50);
    }
  };
  
  // Setup effect to track the PiP video element
  useEffect(() => {
    // Check if there's a PiP element at component mount
    const pipElement = document.pictureInPictureElement as HTMLVideoElement;
    if (pipElement) {
      playerLogger.debug('Found existing PiP element, tracking it');
      pipVideoRef.current = pipElement;
    }
    
    // Listen for when a video enters PiP mode anywhere in the document
    const handleEnterPip = (event: any) => {
      playerLogger.debug('Video entered PiP mode, tracking element');
      pipVideoRef.current = event.target;
    };
    
    // Listen for when a video leaves PiP mode
    const handleLeavePip = (event: any) => {
      playerLogger.debug('Video left PiP mode, clearing reference');
      pipVideoRef.current = null;
    };
    
    // Add these listeners globally to catch PiP events from any video
    document.addEventListener('enterpictureinpicture', handleEnterPip);
    document.addEventListener('leavepictureinpicture', handleLeavePip);
    
    return () => {
      document.removeEventListener('enterpictureinpicture', handleEnterPip);
      document.removeEventListener('leavepictureinpicture', handleLeavePip);
    };
  }, []);
  
  // Add effect to keep PiP video in sync with app state
  useEffect(() => {
    // Get either the PiP element or the regular video element
    const videoElement = document.pictureInPictureElement as HTMLVideoElement || 
      (nft?.isVideo || nft?.metadata?.animation_url ? 
        document.getElementById(`video-${nft.contract}-${nft.tokenId}`) as HTMLVideoElement : null);
    
    if (!videoElement) return;
    
    // Sync the video playback state with the app state
    if (isPlaying) {
      // Only play if it's actually paused to avoid redundant play calls
      if (videoElement.paused) {
        // Create a local variable to hold this specific play promise
        const playPromise = videoElement.play();
        playPromise.catch(e => {
          // Only log if it's not an AbortError (which is expected during transitions)
          if (e.name !== 'AbortError') {
            playerLogger.error('Error playing video from minimized player sync effect:', e);
          }
        });
      }
    } else if (!videoElement.paused) {
      // Only call pause if actually playing
      videoElement.pause();
    }
  }, [isPlaying, nft]);

  // Ref to track if we've logged thumbnail preload for the current NFT
  const hasLoggedThumbnailRef = useRef<string>('');

  // Explicitly preload the thumbnail when component mounts or nft changes
  useEffect(() => {
    if (!nft) return;
    
    // Reset loading state when NFT changes
    setThumbLoaded(false);
    
    // Create image preloader
    const img = new Image();
    
    // Generate a key for this NFT
    const nftKey = `${nft.contract}-${nft.tokenId}`;
    
    // Handle success
    img.onload = () => {
      // Only log if we haven't already logged for this NFT
      if (hasLoggedThumbnailRef.current !== nftKey) {
        playerLogger.info('Successfully preloaded thumbnail for minimized player:', {
          nft: nft.name || 'Unknown NFT',
          contract: nft.contract,
          tokenId: nft.tokenId
        });
        hasLoggedThumbnailRef.current = nftKey;
      }
      setThumbLoaded(true);
    };
    
    // Set source to trigger loading
    img.src = nft.image || nft.metadata?.image || '';
    
    // If already in cache, onload might not fire, so set loaded to true after a short delay
    const timer = setTimeout(() => {
      if (img.complete && img.naturalWidth > 0) {
        setThumbLoaded(true);
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [nft]);

  // Check image status after rendering
  useEffect(() => {
    // Find the actual img element rendered inside our container
    if (imageContainerRef.current) {
      const imgElement = imageContainerRef.current.querySelector('img');
      
      if (imgElement) {
        // If image is already loaded and complete
        if (imgElement.complete && imgElement.naturalWidth > 0) {
          setThumbLoaded(true);
        } else {
          // Otherwise add event listeners
          const handleLoad = () => setThumbLoaded(true);
          const handleError = () => {
            playerLogger.warn('Image failed to load in minimized player', {
              nft: nft?.name,
              src: imgElement.src
            });
            // We'll still set loaded to remove the placeholder
            setThumbLoaded(true);
          };
          
          imgElement.addEventListener('load', handleLoad);
          imgElement.addEventListener('error', handleError);
          
          return () => {
            imgElement.removeEventListener('load', handleLoad);
            imgElement.removeEventListener('error', handleError);
          };
        }
      }
    }
  }, [nft, thumbLoaded]);

  // Inside the MinimizedPlayer component
  // Add this debugging useEffect to track the NFT data
  useEffect(() => {
    if (nft) {
      playerLogger.info('MinimizedPlayer received NFT:', {
        name: nft.name,
        image: nft.image,
        metadataImage: nft.metadata?.image,
        contract: nft.contract,
        tokenId: nft.tokenId,
        isFeatured: FEATURED_NFTS.some(f => 
          f.contract === nft.contract && f.tokenId === nft.tokenId
        )
      });
    }
  }, [nft]);

  // Memoize the featured NFT detection to avoid repeated lookups
  const featuredNft = React.useMemo(() => {
    return FEATURED_NFTS.find(f => 
      f.contract === nft.contract && f.tokenId === nft.tokenId
    );
  }, [nft.contract, nft.tokenId]);

  // Log only once when the featured NFT is found (on nft change)
  useEffect(() => {
    if (featuredNft && featuredNft.image) {
      playerLogger.info('Found matching featured NFT image:', {
        name: nft.name,
        foundImage: featuredNft.image
      });
    }
  }, [featuredNft, nft.name]);

  // Memoize the image URL function to prevent unnecessary recalculations
  const getFeaturedNFTImage = useCallback((currentNft: NFT): string => {
    if (featuredNft && featuredNft.image) {
      return featuredNft.image;
    }
    
    // Fallback to standard image sources
    return currentNft.image || currentNft.metadata?.image || '';
  }, [featuredNft]);

  return (
    <>
      {showInfo && <InfoPanel nft={nft} onClose={() => setShowInfo(false)} userFid={userFid} />}
      <div 
        className="fixed bottom-20 left-0 right-0 bg-black border-t border-purple-400/20 h-20 z-[100] will-change-transform overflow-hidden"
        style={{
          backgroundColor: '#000',
          transform: isAnimating ? 
            (isMinimized ? 'translateY(0)' : 'translateY(100%)') : 
            'translateY(0)',
          transition: 'transform 300ms cubic-bezier(0.33, 1, 0.68, 1)',
          opacity: isAnimating && !isMinimized ? 0 : 1
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Progress bar */}
        <div 
          className="absolute top-0 left-0 right-0 h-1 bg-gray-800 cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            onSeek(duration * percent);
          }}
        >
          <div 
            className="absolute top-0 left-0 h-0.5 bg-indigo-500 transition-all duration-100 group-hover:h-1"
            style={{ 
              width: `${(progress / duration) * 100}%`,
              backgroundColor: '#6366F1' 
            }}
          />
        </div>
        
        {/* Player content */}
        <div className="container mx-auto h-full pt-2">
          <div className="flex items-center justify-between h-[calc(100%-8px)] px-4 gap-4">
            {/* NFT Image and Info */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div 
                ref={imageContainerRef}
                className="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-purple-900/20"
              >
                {/* Add loading placeholder */}
                {!thumbLoaded && (
                  <div className="absolute inset-0 bg-purple-900/30 animate-pulse z-10"></div>
                )}
                
                {/* Use direct image tag for featured NFTs to bypass NFTImage component */}
                {featuredNft ? (
                  <img
                    src={getFeaturedNFTImage(nft)}
                    alt={nft.name}
                    className="w-full h-full object-cover"
                    width={48}
                    height={48}
                    onLoad={() => setThumbLoaded(true)}
                    onError={(e) => {
                      playerLogger.error('Featured NFT image failed to load:', {
                        nft: nft.name,
                        src: (e.target as HTMLImageElement).src
                      });
                      // Try fallback to standard NFTImage
                      setThumbLoaded(true);
                    }}
                  />
                ) : (
                  // For regular NFTs, use the standard approach
                  <NFTImage
                    src={nft.image || nft.metadata?.image || ''}
                    alt={nft.name}
                    className="w-full h-full object-cover"
                    width={48}
                    height={48}
                    priority={true}
                    nft={nft}
                    key={`thumb-regular-${nft.contract}-${nft.tokenId}`}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-purple-400 font-mono text-sm truncate">{nft.name}</h3>
                <div className="inline-flex items-center space-x-0.5">
                  <span className="text-gray-400 text-xs font-mono">{formatTime(Math.floor(progress))}</span>
                  <span className="text-gray-600 text-xs font-mono">/</span>
                  <span className="text-gray-400 text-xs font-mono">{formatTime(Math.floor(duration))}</span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={handleInfoButtonClick}
                className={`text-purple-400 hover:text-purple-300 transition-all ${
                  infoButtonClicked ? 'scale-90 rotate-[360deg]' : ''
                }`}
                style={{
                  transition: infoButtonClicked 
                    ? 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease' 
                    : 'color 0.2s ease'
                }}
                aria-label="Show NFT Information"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                  <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
                </svg>
              </button>
              <button 
                onClick={onNext}
                className="text-purple-400 hover:text-purple-300"
                disabled={!onNext}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M220-240v-480h80v480h-80Zm520 0L380-480l360-240v480Zm-80-240Zm0 90v-180l-136 90 136 90Z"/>
                </svg>
              </button>

              <button 
                onClick={handlePlayPauseWithPipSync}
                className="text-purple-400 hover:text-purple-300"
              >
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor">
                    <path d="M320-640v320h80V-640h-80Zm240 0v320h80V-640h-80Z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor">
                    <path d="M320-200v-560l440 280-440 280Z"/>
                  </svg>
                )}
              </button>

              <button 
                onClick={onPrevious}
                className="text-purple-400 hover:text-purple-300"
                disabled={!onPrevious}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                  <path d="M660-240v-480h80v480h-80Zm-440 0v-480l360 240-360 240Zm80-240Zm0 90 136-90-136-90v180Z"/>
                </svg>
              </button>

              <button
                onClick={onMinimizeToggle}
                className="text-purple-400 hover:text-purple-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                  <path d="M480-600 240-360l56 56 184-184 184 184 56-56-240-240Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}; 