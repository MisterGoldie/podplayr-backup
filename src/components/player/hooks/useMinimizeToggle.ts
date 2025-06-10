import { useRef, useCallback } from 'react';
import type { NFT } from '../../../types/user';

interface UseMinimizeToggleProps {
  nft: NFT;
  isPlaying: boolean;
  isMinimized: boolean;
  onMinimizeToggle: () => void;
  progress: number;
}

export const useMinimizeToggle = ({
  nft,
  isPlaying,
  isMinimized,
  onMinimizeToggle,
  progress
}: UseMinimizeToggleProps) => {
  
  // Keep track of video playback info between state changes
  const lastPlaybackStateRef = useRef({
    isPlaying: false,
    progress: 0,
    nftId: ''
  });
  
  const handleMinimizeToggle = useCallback(() => {
    console.log("Current minimized state:", isMinimized);
    
    // Store current video state before toggling
    const currentNftId = `${nft.contract}-${nft.tokenId}`;
    lastPlaybackStateRef.current = {
      isPlaying,
      progress,
      nftId: currentNftId
    };
    
    // Call the toggle function from props
    onMinimizeToggle();
    
    console.log("New minimized state:", !isMinimized);
    
    // After toggling, sync the video element with the stored state
    // Use requestAnimationFrame to ensure this happens after the DOM updates
    requestAnimationFrame(() => {
      // We add a tiny delay to ensure the DOM has been updated with the new state
      setTimeout(() => {
        try {
          const videoId = `video-${currentNftId}`;
          const videoElement = document.getElementById(videoId) as HTMLVideoElement;
          
          if (videoElement) {
            // Set the current time to match the progress
            videoElement.currentTime = lastPlaybackStateRef.current.progress;
            
            // If it was playing, ensure it continues playing
            if (lastPlaybackStateRef.current.isPlaying) {
              videoElement.play().catch(e => {
                console.error("Failed to play video after minimize toggle:", e);
              });
            }
          }
        } catch (error) {
          console.error("Error during minimize toggle video sync:", error);
        }
      }, 16); // ~1 frame at 60fps
    });
  }, [isMinimized, isPlaying, nft, onMinimizeToggle, progress]);
  
  return { handleMinimizeToggle };
}; 