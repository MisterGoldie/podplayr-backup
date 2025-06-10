'use client';

import { useEffect, useRef } from 'react';
import type { NFT } from '../../types/user';
import { setupHls, destroyHls, isHlsUrl, getHlsUrl } from '../../utils/hlsUtils';
import { processMediaUrl } from '../../utils/media';

interface VideoSyncManagerProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  currentPlayingNFT: NFT | null;
  isPlaying: boolean;
  audioProgress: number;
  onPlayPause: () => void;
}

export const VideoSyncManager: React.FC<VideoSyncManagerProps> = ({
  videoRef,
  currentPlayingNFT,
  isPlaying,
  audioProgress,
  onPlayPause
}) => {
  const hlsInitializedRef = useRef(false);
  const lastPlayStateRef = useRef(isPlaying);
  
  // Optimize the video sync manager for better performance
  useEffect(() => {
    if (!currentPlayingNFT?.isVideo) return;
    
    // Find the video element directly by a unique ID based on the NFT
    const videoId = `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`;
    const videoElement = document.getElementById(videoId) as HTMLVideoElement;
    
    if (!videoElement) {
      console.error(`VideoSyncManager: Could not find video element with ID ${videoId}`);
      return;
    }

    // Handle play state changes immediately - this is critical for UI responsiveness
    if (isPlaying !== lastPlayStateRef.current) {
      if (isPlaying && videoElement.paused) {
        videoElement.play().catch(e => {
          console.error("Failed to play video on play state change:", e);
        });
      } else if (!isPlaying && !videoElement.paused) {
        videoElement.pause();
      }
      lastPlayStateRef.current = isPlaying;
    }
    
    // Use requestAnimationFrame for smoother sync
    let animationFrameId: number;
    let lastSyncTime = 0;
    
    const syncVideoState = (timestamp: number) => {
      // Only sync every 50ms for efficiency but more responsive than before
      if (timestamp - lastSyncTime > 50) {
        // Double-check play state to ensure synchronization
        const videoIsPlaying = !videoElement.paused;
        if (isPlaying !== videoIsPlaying) {
          if (isPlaying) {
            videoElement.play().catch(e => {
              if (e.name !== 'AbortError') {
                console.error("Failed to play video in sync manager:", e);
                videoElement.muted = true;
                videoElement.play().catch(e2 => console.error("Failed even with muted:", e2));
              }
            });
          } else {
            videoElement.pause();
          }
        }
        
        // Sync time only if difference is significant
        if (Math.abs(videoElement.currentTime - audioProgress) > 0.3) {
          videoElement.currentTime = audioProgress;
        }
        
        lastSyncTime = timestamp;
      }
      
      animationFrameId = requestAnimationFrame(syncVideoState);
    };
    
    // Start the sync loop
    animationFrameId = requestAnimationFrame(syncVideoState);

    // Add event listeners to ensure sync
    const handleVideoPlay = () => {
      if (!isPlaying) {
        // If video plays but audio is paused, sync them
        onPlayPause(); // This will trigger audio to play
      }
    };

    const handleVideoPause = () => {
      if (isPlaying) {
        // If video pauses but audio is playing, sync them
        onPlayPause(); // This will trigger audio to pause
      }
    };

    // Add listeners for user interactions with the video element
    videoElement.addEventListener('play', handleVideoPlay);
    videoElement.addEventListener('pause', handleVideoPause);
    
    // Clean up
    return () => {
      cancelAnimationFrame(animationFrameId);
      
      // Remove event listeners
      videoElement.removeEventListener('play', handleVideoPlay);
      videoElement.removeEventListener('pause', handleVideoPause);
      
      if (hlsInitializedRef.current) {
        destroyHls(videoId);
        hlsInitializedRef.current = false;
      }
    };
  }, [isPlaying, audioProgress, currentPlayingNFT, onPlayPause]);

  return null;
};

export default VideoSyncManager;
//