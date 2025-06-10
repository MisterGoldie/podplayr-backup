import { useState, useRef, useEffect } from 'react';
import type { NFT } from '../../../types/user';
import { processMediaUrl } from '../../../utils/media';

interface UsePlayerStateProps {
  nft: NFT;
  isPlaying: boolean;
  isMinimized: boolean;
  progress: number;
  onPlayPause: () => void;
}

export const usePlayerState = ({
  nft,
  isPlaying,
  isMinimized,
  progress,
  onPlayPause
}: UsePlayerStateProps) => {
  // All the same state variables from the original Player component
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeDistance, setSwipeDistance] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const [videoLoading, setVideoLoading] = useState(false);
  const prevPlayingRef = useRef(isPlaying);
  const [showInfo, setShowInfo] = useState(false);
  
  // All the same useEffects from the original Player component
  
  // Auto-hide controls after 3 seconds of inactivity (only in maximized state)
  useEffect(() => {
    // Don't run auto-hide in minimized state
    if (isMinimized) {
      setShowControls(true);
      return;
    }

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
  }, [isMinimized]);
  
  // Video synchronization effect - exactly as in the original
  useEffect(() => {
    // Detect if we're resuming playback (changing from paused to playing)
    const isResuming = isPlaying && !prevPlayingRef.current;
    
    // Update the ref for next render
    prevPlayingRef.current = isPlaying;
    
    // First try using our ref
    if (videoRef.current) {
      try {
        if (isPlaying) {
          // Only sync time when resuming playback to avoid choppy video
          if (isResuming) {
            videoRef.current.currentTime = progress;
          }
          videoRef.current.play().catch(e => console.error("Video play error with ref:", e));
        } else {
          videoRef.current.pause();
        }
      } catch (e) {
        console.error("Error controlling video with ref:", e);
      }
    }
    
    // As a backup, try direct DOM access for both minimized and maximized states
    if (nft?.isVideo || nft?.metadata?.animation_url) {
      const videoId = `video-${nft.contract}-${nft.tokenId}`;
      const videoElement = document.getElementById(videoId) as HTMLVideoElement;
      
      if (videoElement && videoElement !== videoRef.current) {
        try {
          if (isPlaying) {
            // Only sync time when resuming playback to avoid choppy video
            if (isResuming) {
              videoElement.currentTime = progress;
            }
            videoElement.play().catch(e => console.error("Video play error with DOM:", e));
          } else {
            videoElement.pause();
          }
        } catch (e) {
          console.error("Error controlling video with DOM:", e);
        }
      }
    }
  }, [isPlaying, nft, progress]);

  // Touch handlers - exactly as in the original
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

  const handlePictureInPicture = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      
      if (!nft?.isVideo && !nft?.metadata?.animation_url) return;
      
      const videoId = `video-${nft.contract}-${nft.tokenId}`;
      
      // Try with ref first
      if (videoRef.current) {
        try {
          await videoRef.current.requestPictureInPicture();
          return;
        } catch (e) {
          console.error("Error requesting PIP with ref:", e);
        }
      }
      
      // Then try with direct DOM access
      const videoElement = document.getElementById(videoId) as HTMLVideoElement;
      if (videoElement) {
        try {
          await videoElement.requestPictureInPicture();
          return;
        } catch (e) {
          console.error("Error requesting PIP with DOM:", e);
        }
      }
      
      // Final check before requesting PIP
      if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (error) {
      console.error('Error toggling Picture-in-Picture mode:', error);
    }
  };

  // All the same functions from the original Player component
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  };

  return {
    // Return everything needed by the components
    touchStart,
    touchEnd,
    swipeDistance,
    videoRef,
    videoElement,
    showControls,
    videoLoading,
    showInfo,
    setShowInfo,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePictureInPicture,
    formatTime,
    setVideoLoading
  };
}; 