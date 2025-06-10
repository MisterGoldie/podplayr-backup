import React, { useRef, useState, useEffect, useCallback } from 'react';
import { usePlayerState } from './hooks/usePlayerState';
import { NFTImage } from '../media/NFTImage';
import { processMediaUrl, getMediaKey } from '../../utils/media';
import type { NFT } from '../../types/user';
import sdk from '@farcaster/frame-sdk';
import { getNftCdnUrl, preloadNftMedia } from '../../utils/cdn';
import { logger } from '../../utils/logger';

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
  isAnimating
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [videoLoading, setVideoLoading] = useState(false);
  const hideControlsTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [isForcePressed, setIsForcePressed] = useState(false);
  const [isActivelyScrubbingBar, setIsActivelyScrubbingBar] = useState(false);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [pipActive, setPipActive] = useState(false);
  
  // Auto-hide controls after inactivity
  useEffect(() => {
    const handleUserActivity = () => {
      setShowControls(true);
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
      }
      hideControlsTimer.current = setTimeout(() => {
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
  }, []);
  
  // PiP event handlers that need access to the latest state
  // Define these using useCallback to maintain reference stability
  const handlePipPlay = useCallback(() => {
    console.log('PiP play event fired, current isPlaying state:', isPlaying);
    if (!isPlaying) {
      console.log('Syncing state: PiP started playing → updating app state');
      onPlayPause();
    }
  }, [isPlaying, onPlayPause]);
  
  const handlePipPause = useCallback(() => {
    console.log('PiP pause event fired, current isPlaying state:', isPlaying);
    if (isPlaying) {
      console.log('Syncing state: PiP paused → updating app state');
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
      console.log('Entered PiP mode, setting up sync event listeners');
      setPipActive(true);
      
      // Add direct event listeners to sync state when PiP controls are used
      videoElement.addEventListener('play', handlePipPlay);
      videoElement.addEventListener('pause', handlePipPause);
    };
    
    // Function to clean up when PiP ends
    const handleLeavePiP = () => {
      console.log('Left PiP mode, removing sync event listeners');
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
      console.log('Component updated while PiP active - ensuring listeners are attached');
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
        console.log('Exiting PiP mode');
        await document.exitPictureInPicture();
        return;
      }
      
      if (!nft?.isVideo && !nft?.metadata?.animation_url) {
        console.log('No video content to put in PiP mode');
        return;
      }
      
      // Function to check if video is ready for PiP
      const isVideoReadyForPiP = (video: HTMLVideoElement): boolean => {
        // Check multiple readiness conditions
        const isLoaded = video.readyState >= 2; // HAVE_CURRENT_DATA or higher
        const hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
        const canUsePiP = document.pictureInPictureEnabled && video.disablePictureInPicture !== true;
        
        console.log('Video readiness check:', { 
          readyState: video.readyState,
          hasVideo,
          canUsePiP,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight
        });
        
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
          
          console.log('Waiting for video to be ready for PiP...');
          
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
          console.log('Preparing to request PiP with ref');
          
          // Wait for video to be ready before requesting PiP
          await waitForVideoReadiness(videoRef.current);
          
          console.log('Video is ready, requesting PiP with ref');
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
          console.log('Preparing to request PiP with DOM query');
          
          // Wait for video to be ready before requesting PiP
          await waitForVideoReadiness(videoElement);
          
          console.log('Video is ready, requesting PiP with DOM query');
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

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  // Create a dedicated logger for player
  const playerLogger = logger.getModuleLogger('player');
  
  // Preload the NFT media when component mounts (safe with CDN disabled)
  useEffect(() => {
    if (nft) {
      playerLogger.info('Preloading NFT media for player:', {
        nft: nft.name || 'Unknown NFT',
        mediaKey: getMediaKey(nft)
      });
      // This is safe even with CDN disabled
      preloadNftMedia(nft);
    }
  }, [nft]);
  
  // Preload the thumbnail when the component mounts
  useEffect(() => {
    if (nft && (nft.image || nft.metadata?.image)) {
      // Create an image element to preload
      const img = new Image();
      img.src = nft.image || nft.metadata?.image || '';
      
      // Log preloading attempt
      playerLogger.info('Preloading NFT thumbnail:', {
        nft: nft.name || 'Unknown NFT',
        source: img.src
      });
    }
  }, [nft]);
  
  // Track the last logged mediaKey to prevent duplicate logs
  const lastLoggedMediaKeyRef = useRef<string>('');
  
  // Render video with proper fallbacks
  const renderVideo = () => {
    // Get the processed URL - this will use CDN if enabled or fall back to direct URL
    const videoUrl = processMediaUrl(nft.metadata?.animation_url || '', '', 'audio');
    const currentMediaKey = getMediaKey(nft);
    
    // Only log when the mediaKey changes to avoid excessive logging
    if (lastLoggedMediaKeyRef.current !== currentMediaKey) {
      playerLogger.info('Video playback source:', {
        nft: nft.name || 'Unknown NFT',
        mediaKey: currentMediaKey,
        url: videoUrl
      });
      lastLoggedMediaKeyRef.current = currentMediaKey;
    }
    
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <video
          ref={videoRef}
          id={`video-${nft.contract}-${nft.tokenId}`}
          src={videoUrl}
          playsInline
          loop
          muted={!nft.metadata?.animation_url?.match(/\.(mp4|webm|mov)$/i)}
          autoPlay={isPlaying}
          preload="auto"
          className="w-auto h-auto object-contain rounded-lg max-h-[60vh] min-h-[40vh] min-w-[60%] max-w-full"
          style={{ 
            opacity: 1, 
            willChange: 'transform',
            objectFit: 'contain'
          }}
          onLoadedData={() => {
            setVideoLoading(false);
            playerLogger.info('Video loaded successfully:', {
              nft: nft.name || 'Unknown NFT',
              mediaKey: getMediaKey(nft)
            });
            
            // Set the video time to the saved position when loaded
            if (videoRef.current && lastPosition && lastPosition > 0) {
              videoRef.current.currentTime = lastPosition;
              playerLogger.info("Restored position to:", lastPosition);
            }
          }}
          onError={(e) => {
            playerLogger.warn('Error loading video:', {
              nft: nft.name || 'Unknown NFT',
              mediaKey: getMediaKey(nft),
              error: e.currentTarget.error?.message || 'Unknown error'
            });
          }}
        />

        {videoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm rounded-lg">
            <div className="loader"></div>
          </div>
        )}
      </div>
    );
  };

  // Keep the essential minimize toggle function but remove the alert
  const handleMinimizeToggle = () => {
    console.log('Minimize toggle clicked. Current state: maximized');
    onMinimizeToggle();
    console.log('After toggle called. New state will be: minimized');
  };

  // For the minimize button at the bottom of the page, make it extremely visible for testing
  const minimizeButtonStyle = {
    backgroundColor: '#6366F1', // Indigo color
    color: 'white',
    padding: '10px 15px',
    borderRadius: '8px',
    fontWeight: 'bold',
    cursor: 'pointer',
    zIndex: 9999, // Ensure it's on top of everything
    position: 'relative' as 'relative'
  };

  // Add one simple effect to handle play/pause
  useEffect(() => {
    // Only run this if we have a video element
    if (!videoRef.current) return;
    
    // Simple play/pause logic
    if (isPlaying) {
      videoRef.current.play().catch(e => {
        console.error("Video play error:", e);
      });
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Optional: Add a simple effect to handle time sync for big jumps
  useEffect(() => {
    if (!videoRef.current) return;
    
    // Only sync time if the difference is significant (>1 second)
    if (Math.abs(videoRef.current.currentTime - progress) > 1) {
      videoRef.current.currentTime = progress;
    }
  }, [progress]);

  // Add these helper functions below your existing functions
  const handleProgressBarMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    updateScrubPosition(e.clientX);
    
    // Add event listeners for mouse movement and release
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      updateScrubPosition(e.clientX);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (isDragging) {
      updateScrubPosition(e.clientX);
      
      // Perform the actual seek
      if (scrubPosition !== null) {
        onSeek(scrubPosition);
      }
      
      // Reset state
      setIsDragging(false);
      setScrubPosition(null);
      
      // Remove event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };

  const updateScrubPosition = (clientX: number) => {
    if (progressBarRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      setScrubPosition(duration * percent);
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

  const handleTouchEnd = () => {
    // If we were scrubbing and have a position, seek to it
    if (isActivelyScrubbingBar && scrubPosition !== null) {
      onSeek(scrubPosition);
    }
    
    // Reset states
    setIsActivelyScrubbingBar(false);
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
      <div className="fixed inset-0 z-[100] bg-black will-change-transform flex flex-col" style={{ backfaceVisibility: 'hidden' }}>
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center max-h-[70vh] px-4 py-4 overflow-hidden">
            {/* Title Bar */}
            <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-purple-400/20">
              <div className="container mx-auto flex items-center justify-between px-4 py-3">
                <h3 className="font-mono text-purple-400 text-sm truncate flex-1 min-w-0">{nft.name}</h3>
                <button 
                  onClick={handleMinimizeToggle} // Use our working function
                  className="text-purple-400 hover:text-purple-300 p-1 transition-colors touch-manipulation"
                  style={{position: 'relative', zIndex: 1000}} // Add z-index to ensure clickability
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                    <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z"/>
                  </svg>
                </button>
              </div>
            </div>
            {/* NFT Image/Video Container */}
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Action Icons Overlay */}
              <div className={`absolute top-4 left-4 right-4 flex justify-between z-10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex gap-2">
                  {onLikeToggle && (
                    <button 
                      onClick={() => onLikeToggle(nft)}
                      className={`${isLiked ? 'text-red-500' : 'text-purple-400'} hover:text-purple-300 transition-all duration-300 hover:scale-125`}
                    >
                      {isLiked ? (
                        <svg xmlns="http://www.w3.org/2000/svg" height="26" viewBox="0 -960 960 960" width="26" fill="currentColor">
                          <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" height="26" viewBox="0 -960 960 960" width="26" fill="currentColor">
                          <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                        </svg>
                      )}
                    </button>
                  )}
                  {nft && (
                    <button
                      onClick={() => {
                        // Personalize the share message with the NFT name
                        const shareText = `Check out "${nft.name}" on @podplayr! ▶️`;
                        const shareUrl = 'podplayr.xyz';
                        
                        // Build the base share URL without image
                        let shareUrlWithEmbeds = `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}&embeds[]=${encodeURIComponent(shareUrl)}`;
                        
                        // Get the NFT image URL for sharing
                        let shareImage = nft.image || nft.metadata?.image || '';
                        logger.debug('player', 'Original image URL:', shareImage);
                        
                        // Skip sharing image completely if it contains known problematic patterns
                        const skipImagePatterns = [
                          'dweb.link/COMPRESSED', 
                          'ipfs.dweb.link/COMPRESSED',
                          'bafybeie7mejoxle27ki56vxmzebb67kcrttu54stlin74xowaq5ugu3sdi',
                          '.ipfs.dweb.link/COMPRESSED'
                        ];
                        
                        const shouldSkipImage = skipImagePatterns.some(pattern => 
                          shareImage.includes(pattern)
                        );
                        
                        if (shouldSkipImage) {
                          logger.debug('player', 'Skipping problematic image URL:', shareImage);
                          // Use the share URL without any image embed
                          sdk.actions.openUrl(shareUrlWithEmbeds);
                          return;
                        }
                        
                        // Only include the image if it exists and is likely to be valid
                        if (shareImage) {
                          // Special handling for IPFS URLs
                          if (shareImage.includes('ipfs') || 
                              shareImage.includes('dweb.link') || 
                              shareImage.startsWith('ipfs://')) {
                            // Skip IPFS URLs completely as they often cause 422 errors
                            logger.debug('player', 'Skipping IPFS URL for sharing:', shareImage);
                            // Just use the base URL without image
                          }
                          // Special handling for Arweave URLs - use them directly without CDN transformation
                          else if (shareImage.includes('arweave.net') || shareImage.startsWith('ar://')) {
                            // If it's an ar:// URL, convert to https format
                            if (shareImage.startsWith('ar://')) {
                              const txId = shareImage.replace('ar://', '');
                              shareImage = `https://arweave.net/${txId}`;
                            }
                            
                            // For Arweave URLs, use them directly without CDN processing
                            logger.debug('player', 'Using direct Arweave URL for sharing:', shareImage);
                            
                            // Only add the image URL if it's a valid Arweave URL (contains a transaction ID)
                            if (shareImage.includes('arweave.net/') && shareImage.split('arweave.net/')[1]?.length > 10) {
                              shareUrlWithEmbeds += `&embeds[]=${encodeURIComponent(shareImage)}`;
                            }
                          } else {
                            // For non-Arweave URLs, process normally
                            const processedUrl = processMediaUrl(shareImage, '', 'image');
                            
                            // Ensure the URL is absolute
                            let finalUrl = processedUrl;
                            if (!finalUrl.startsWith('http')) {
                              finalUrl = `https://${finalUrl}`;
                            }
                            
                            // Only add the image if it's likely to be a valid URL
                            // and doesn't contain any problematic patterns
                            if (finalUrl.startsWith('http') && finalUrl.length > 15 && 
                                !skipImagePatterns.some(pattern => finalUrl.includes(pattern))) {
                              logger.debug('player', 'Sharing NFT with processed image URL:', finalUrl);
                              shareUrlWithEmbeds += `&embeds[]=${encodeURIComponent(finalUrl)}`;
                            }
                          }
                        }
                        
                        // Use the imported SDK directly with the appropriate share URL
                        sdk.actions.openUrl(shareUrlWithEmbeds);
                      }}
                      className="text-purple-400 hover:text-purple-300 p-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                        <path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"/>
                      </svg>
                    </button>
                  )}
                </div>
                {(nft.isVideo || nft.metadata?.animation_url) && (
                  <button
                    onClick={handlePictureInPicture}
                    className="text-white hover:text-white/80 p-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                      <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Zm280-200h320v-240H440v240Zm80-80v-80h160l-80-80-80 80Z"/>
                    </svg>
                  </button>
                )}
              </div>

              <div className={`transition-transform duration-500 ease-in-out transform ${isPlaying ? 'scale-100' : 'scale-90'} max-h-[60vh] flex items-center justify-center`}>
                {nft.isVideo || nft.metadata?.animation_url ? (
                  renderVideo()
                ) : (
                  <div className="relative rounded-lg overflow-hidden max-h-[60vh]">
                    {/* Special handling for GIF images */}
                    {(nft.name === 'ACYL RADIO - Hidden Tales' || nft.name === 'ACYL RADIO - WILL01' || nft.name === 'ACYL RADIO - Chili Sounds 🌶️') ? (
                      <img
                        src={nft.image}
                        alt={nft.name}
                        className="w-auto h-auto object-contain rounded-lg max-h-[60vh]"
                        width={400}
                        height={400}
                        style={{ 
                          maxWidth: '90vw', 
                          maxHeight: '60vh',
                          willChange: 'transform', 
                          transform: 'translateZ(0)'
                        }}
                      />
                    ) : (
                      <NFTImage
                        src={nft.image || nft.metadata?.image || ''}
                        alt={nft.name}
                        className="w-auto h-auto object-contain rounded-lg max-h-[60vh]"
                        width={400}
                        height={400}
                        priority={true}
                        nft={nft}
                        key={`thumb-${nft.contract}-${nft.tokenId}`}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="relative flex-none">
            <div className="container mx-auto px-4 pt-4 pb-16">
              {/* Progress Bar - slimmer version */}
              <div 
                ref={progressBarRef}
                className={`relative ${isActivelyScrubbingBar ? 'h-4 -mt-1 mb-3' : 'h-2'} bg-gray-800 rounded-full mb-4 transition-all duration-150 touch-none`}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                onClick={(e) => {
                  // For standard click handling (non-mobile)
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  onSeek(duration * percent);
                }}
              >
                {/* Background progress */}
                <div 
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full"
                  style={{ width: `${((scrubPosition !== null ? scrubPosition : progress) / duration) * 100}%` }}
                />
                
                {/* Scrubber handle - only shows during active scrubbing */}
                {isActivelyScrubbingBar && (
                  <div 
                    className="absolute top-1/2 h-8 w-8 rounded-full bg-white shadow-lg transform -translate-y-1/2 opacity-100 scale-100"
                    style={{ 
                      left: `calc(${((scrubPosition !== null ? scrubPosition : progress) / duration) * 100}% - 16px)`,
                    }}
                  />
                )}

                {/* Time Preview bubble - only shows during active scrubbing - KEEP THIS */}
                {isActivelyScrubbingBar && scrubPosition !== null && (
                  <div 
                    className="absolute -top-10 py-1 px-3 bg-black/90 text-white text-sm font-medium rounded-md transform -translate-x-1/2 shadow-lg"
                    style={{ 
                      left: `${(scrubPosition / duration) * 100}%`,
                    }}
                  >
                    {formatTime(Math.floor(scrubPosition))}
                  </div>
                )}
              </div>

              {/* Time Display - KEEP THIS */}
              <div className="flex justify-between text-gray-400 text-xs font-mono mb-4">
                <span>{formatTime(Math.floor(isActivelyScrubbingBar && scrubPosition !== null ? scrubPosition : progress))}</span>
                <span>{formatTime(Math.floor(duration))}</span>
              </div>

              {/* Playback Controls */}
              <div className="flex justify-center items-center gap-12 mb-8">
                {/* Previous Track */}
                <button
                  onClick={onNext}
                  className="text-white hover:scale-110 transition-transform"
                  disabled={!onNext}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="currentColor">
                    <path d="M220-240v-480h80v480h-80Zm440 0v-480l-360 240 360 240Z"/>
                  </svg>
                </button>

                {/* Play/Pause Button */}
                <button
                  onClick={onPlayPause}
                  className="w-20 h-20 rounded-full bg-purple-500 text-black flex items-center justify-center hover:scale-105 transition-transform"
                >
                  {isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" height="40px" viewBox="0 -960 960 960" width="40px" fill="currentColor">
                      <path d="M560-200v-560h80v560H560Zm-320 0v-560h80v560H240Z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" height="40px" viewBox="0 -960 960 960" width="40px" fill="currentColor">
                      <path d="M320-200v-560l440 280-440 280Z"/>
                    </svg>
                  )}
                </button>

                {/* Next Track */}
                <button
                  onClick={onPrevious}
                  className="text-white hover:scale-110 transition-transform"
                  disabled={!onPrevious}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="currentColor">
                    <path d="M660-240v-480h80v480h-80ZM220-240v-480l360 240-360 240Z"/>
                  </svg>
                </button>
              </div>

              {/* Secondary Controls - REMOVED THE PIP BUTTON FROM HERE */}
              <div className="flex justify-center items-center gap-8">
                {/* No buttons here - removed the redundant PIP button */}
              </div>
            </div>
          </div>
        </div>

        {/* Now Playing Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-purple-400/20">
          <div className="container mx-auto flex items-center justify-between px-4 py-5">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-mono text-purple-400 truncate">{nft.name}</div>
            </div>
            <div className="flex-shrink-0">
              <button 
                onClick={handleMinimizeToggle} // Use our working function
                className="text-purple-400 hover:text-purple-300 p-1 transition-colors"
                style={{position: 'relative', zIndex: 1000}} // Add z-index to ensure clickability
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                  <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}; 