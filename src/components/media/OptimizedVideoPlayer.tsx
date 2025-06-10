'use client';

import React, { useState, useEffect, useRef } from 'react';
import { NFT } from '../../types/user';
import { processMediaUrl, getMediaKey } from '../../utils/media';
import { NFTImage } from './NFTImage';
import { setupHls, destroyHls, isHlsUrl, getHlsUrl } from '../../utils/hlsUtils';
import { videoPerformanceMonitor } from '../../utils/videoPerformanceMonitor';

interface OptimizedVideoPlayerProps {
  nft: NFT;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  onLoadStart?: () => void;
  onLoadComplete?: () => void;
  onError?: (error: Error) => void;
}

export const OptimizedVideoPlayer: React.FC<OptimizedVideoPlayerProps> = ({
  nft,
  autoPlay = false,
  muted = true,
  loop = true,
  onLoadStart,
  onLoadComplete,
  onError
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [useHls, setUseHls] = useState(false);
  const [hlsInitialized, setHlsInitialized] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Detect if we're on mobile
  useEffect(() => {
    setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
  }, []);
  
  // Use Intersection Observer to only load when visible
  useEffect(() => {
    if (!containerRef.current) return;
    
    const options = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1
    };
    
    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else if (!isLoaded) {
          setIsVisible(false);
        }
      });
    };
    
    const observer = new IntersectionObserver(handleIntersection, options);
    observer.observe(containerRef.current);
    
    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, [isLoaded, nft.contract, nft.tokenId]);
  
  // Process video URL and determine if we should use HLS
  const posterUrl = processMediaUrl(nft.image || nft.metadata?.image || '');
  const rawVideoUrl = processMediaUrl(nft.metadata?.animation_url || '');
  const videoUrl = getHlsUrl(rawVideoUrl);
  
  // Decide if we should use HLS
  useEffect(() => {
    if (isHlsUrl(videoUrl) && typeof window !== 'undefined') {
      if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari has native HLS support
        setUseHls(true);
      } else {
        // For other browsers, we'll let the setupHls function handle it
        setUseHls(true);
      }
    }
  }, [videoUrl]);
  
  // Generate a consistent videoId for this component instance
  const getVideoId = () => `video-${nft.contract}-${nft.tokenId}`;
  
  // Load the video when it becomes visible AND autoPlay is true
  useEffect(() => {
    if (!videoRef.current || !isVisible || !autoPlay) return;
    
    const video = videoRef.current;
    
    // Calculate mediaKey for this NFT to enable proper resource tracking
    const mediaKey = getMediaKey(nft);
    
    // Apply performance optimizations and memory management
    videoPerformanceMonitor.optimizeVideoElement(video, mediaKey);
    
    const handleLoadStart = () => {
      onLoadStart?.();
    };
    
    const handleLoadedData = () => {
      setIsLoaded(true);
      onLoadComplete?.();
    };
    
    const handleError = (e: Event) => {
      // Silently handle errors when just browsing profiles
      setPlaybackError('Error loading video');
      // Only log error to console, don't propagate unless explicitly playing
      if (autoPlay) {
        console.error('Video loading error:', e);
        onError?.(new Error('Failed to load video'));
      }
      // Clean up resources on error
      videoPerformanceMonitor.cleanupVideoResources(video);
    };
    
    // We don't need to add these listeners as the performance monitor already does
    // But we'll add our specific handlers for this component's state management
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('loadeddata', handleLoadedData);
    
    // Only set up video if autoPlay is true or user has explicitly requested playback
    if (autoPlay) {
      // Set up HLS if needed and not already initialized
      if (useHls && !hlsInitialized) {
        setHlsInitialized(true);
        
        setupHls(getVideoId(), video, videoUrl)
          .then(() => {
            // Successful initialization doesn't need console logging
          })
          .catch((error: Error) => {
            // Only log error if explicitly trying to play
            if (autoPlay) {
              console.error('Error setting up HLS:', error);
            }
            setPlaybackError('Error initializing video player');
            // Fall back to regular video
            if (!isHlsUrl(videoUrl)) {
              video.src = rawVideoUrl;
              video.load();
            }
          });
      } else if (!useHls && !video.src) {
        // For non-HLS, set the source directly if not already set
        try {
          video.src = rawVideoUrl;
          video.load();
        } catch (error) {
          setPlaybackError('Error loading video source');
          if (autoPlay) {
            console.error('Error loading video source:', error);
          }
        }
      }
    }
    
    return () => {
      // Cleanup event listeners
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('loadeddata', handleLoadedData);
      
      // Clean up HLS if needed
      if (useHls) {
        destroyHls(getVideoId());
      }
    };
  }, [isVisible, nft, rawVideoUrl, videoUrl, useHls, hlsInitialized, onLoadStart, onLoadComplete, onError, autoPlay]);
  
  // Basic buffering detection
  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    
    const handleWaiting = () => {
      setIsBuffering(true);
    };
    
    const handlePlaying = () => {
      setIsBuffering(false);
    };
    
    const handleError = () => {
      const errorMessage = video.error?.message || 'Unknown error';
      setPlaybackError(errorMessage);
      // Only propagate errors when explicitly playing
      if (onError && autoPlay) {
        onError(new Error(errorMessage));
      }
    };
    
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);
    
    return () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', handleError);
    };
  }, [onError]);

  // Cleanup function for component unmount
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        // Ensure we clean up all video resources when component unmounts
        videoPerformanceMonitor.cleanupVideoResources(videoRef.current);
        
        // Also clean up HLS if needed
        if (useHls) {
          destroyHls(getVideoId());
        }
      }
    };
  }, [useHls]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {isVisible ? (
        <>
          <video
            ref={videoRef}
            id={getVideoId()}
            className="w-full h-full object-cover rounded-md"
            poster={posterUrl}
            muted={muted}
            loop={loop}
            playsInline
            autoPlay={autoPlay}
            preload="metadata"
            controls
            data-media-key={getMediaKey(nft)}
          >
            {!useHls && <source src={rawVideoUrl} type="video/mp4" />}
            Your browser does not support the video tag.
          </video>
          
          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-900"></div>
            </div>
          )}
          
          {/* Show playback error */}
          {playbackError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-white text-center p-4 max-w-[80%] rounded">
                <p>Unable to play video</p>
                <p className="text-sm opacity-75">{playbackError}</p>
              </div>
            </div>
          )}
        </>
      ) : (
        // Show poster image when not visible
        <NFTImage 
          nft={nft} 
          src={posterUrl}
          alt={nft.name || 'NFT Media'}
          className="w-full h-full object-contain" 
        />
      )}
    </div>
  );
}; 
