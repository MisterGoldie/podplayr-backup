'use client';

import { Player as BasePlayer } from './Player';
import { NFT } from '../../types/user';
import { FC, useEffect, useRef, useCallback, memo } from 'react';
import { 
  isCellularConnection, 
  getOptimizedCellularVideoUrl,
  getCellularVideoSettings
} from '../../utils/cellularOptimizer';
import { getHlsInstance, isHlsUrl } from '../../utils/hlsUtils';
import Hls from 'hls.js';

interface PlayerClientProps {
  nft: NFT;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  isMinimized: boolean;
  onMinimizeToggle: () => void;
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
}

export const PlayerClient: FC<PlayerClientProps> = memo((props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevProgressRef = useRef(props.progress);

  useEffect(() => {
    if (!props.nft?.isVideo && !props.nft?.metadata?.animation_url) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    // Set video properties
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    
    // Play/pause based on isPlaying prop
    if (props.isPlaying) {
      video.play().catch(e => {
        console.error("Player: Failed to play video:", e);
      });
    } else {
      video.pause();
    }
  }, [props.nft, props.isPlaying]);

  useEffect(() => {
    if (!props.nft?.isVideo && !props.nft?.metadata?.animation_url) return;
    
    const video = videoRef.current;
    if (!video) return;
    
    // Set essential properties
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    
    // Get the video URL
    const rawVideoUrl = props.nft.metadata?.animation_url || '';
    
    // Get cellular connection info and settings
    const { isCellular, generation } = isCellularConnection();
    const settings = getCellularVideoSettings();
    
    // Get optimized URL based on network conditions
    const videoUrl = isCellular 
      ? getOptimizedCellularVideoUrl(rawVideoUrl)
      : rawVideoUrl;
    
    // Set appropriate preload strategy based on network
    video.preload = isCellular ? 'metadata' : 'auto';
    
    // Flag to prevent operations on unmounted component
    let isActive = true;
    let hlsInstance: Hls | null = null;
    
    const setupVideo = async () => {
      try {
        // Use HLS.js for streaming if applicable
        if (isHlsUrl(videoUrl) && Hls.isSupported()) {
          // Create HLS instance with cellular-optimized config if needed
          hlsInstance = getHlsInstance(videoUrl, isCellular ? settings.hlsConfig : undefined);
          
          if (hlsInstance) {
            hlsInstance.attachMedia(video);
            
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!isActive) return;
              
              // Log network conditions for debugging
              console.log('Network conditions:', {
                isCellular,
                generation,
                settings: {
                  maxResolution: settings.maxResolution,
                  maxBitrate: settings.maxBitrate
                }
              });
              
              if (props.isPlaying) {
                video.play().catch(e => console.error("HLS play error:", e));
              }
            });
            
            // Handle quality level loading
            hlsInstance.on(Hls.Events.LEVEL_LOADING, (_, data) => {
              console.log('Loading quality level:', data.level);
            });
          }
        } else {
          // Regular video source handling
          if (videoUrl !== video.src) {
            console.log("Setting video source:", {
              isCellular,
              generation,
              isOptimized: isCellular,
              url: videoUrl
            });
            
            video.src = videoUrl;
            video.load();
          }
          
          // Handle playback with appropriate delay for buffering
          const bufferDelay = isCellular ? 500 : 300;
          setTimeout(() => {
            if (!isActive) return;
            if (props.isPlaying) {
              video.play().catch(err => {
                console.error("Video play error:", err);
                // One retry with longer delay
                setTimeout(() => {
                  if (!isActive) return;
                  video.play().catch(e => console.error("Retry failed:", e));
                }, bufferDelay);
              });
            } else {
              video.pause();
            }
          }, bufferDelay);
        }
      } catch (err) {
        console.error("Video setup error:", err);
      }
    };
    
    setupVideo();
    
    // Cleanup function
    return () => {
      isActive = false;
      
      if (hlsInstance) {
        hlsInstance.destroy();
      }
      
      if (video) {
        video.pause();
        video.src = '';
        video.load();
      }
    };
  }, [props.nft, props.isPlaying]);

  // Keep video synchronized with player controls
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.nft?.isVideo && !props.nft?.metadata?.animation_url) return;
    
    if (Math.abs(video.currentTime - props.progress) > 0.5) {
      video.currentTime = props.progress;
    }
    
    const handleTimeUpdate = () => {
      if (Math.abs(video.currentTime - props.progress) > 0.5 && props.onSeek) {
        props.onSeek(video.currentTime);
      }
    };
    
    video.addEventListener('timeupdate', handleTimeUpdate);
    
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [props.progress, props.nft, props.onSeek]);

  // Only update progress when it changes significantly (e.g., by 1%)
  useEffect(() => {
    const progressDiff = Math.abs(props.progress - prevProgressRef.current);
    if (progressDiff > 0.01) {
      prevProgressRef.current = props.progress;
      // Handle progress update
    }
  }, [props.progress]);

  return <BasePlayer {...props} />;
}); 