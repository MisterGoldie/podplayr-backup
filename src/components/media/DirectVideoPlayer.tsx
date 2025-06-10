'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { NFT } from '../../types/user';
import { preloadNftMedia } from '../../utils/cdn';
import { getMediaKey, processMediaUrl } from '../../utils/media';
import { logger } from '../../utils/logger';
import { optimizeVideoForConnection } from '../../utils/adaptiveStreaming';
import { videoPerformanceMonitor } from '../../utils/videoPerformanceMonitor';

interface DirectVideoPlayerProps {
  nft: NFT;
  onLoadComplete?: () => void;
  onError?: (error: Error) => void;
}

// Create a dedicated logger for video player
const videoLogger = logger.getModuleLogger('videoPlayer');

// Define the base component
const DirectVideoPlayerBase: React.FC<DirectVideoPlayerProps> = ({ 
  nft, 
  onLoadComplete,
  onError 
}): React.ReactElement => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasError, setHasError] = useState(false);
  const [currentGateway, setCurrentGateway] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 2; // Maximum number of times to cycle through all gateways
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const [bufferingState, setBufferingState] = useState<'none' | 'loading' | 'sufficient' | 'full'>('none');
  const [loadProgress, setLoadProgress] = useState(0);
  const [networkType, setNetworkType] = useState<'cellular' | 'wifi' | 'unknown'>('unknown');
  const [networkGeneration, setNetworkGeneration] = useState<'5G' | '4G' | '3G' | '2G' | 'unknown'>('unknown');
  
  // Get the mediaKey for consistent tracking
  const mediaKey = getMediaKey(nft);
  
  // Get direct video URL without any processing
  const directUrl = nft.metadata?.animation_url || '';
  
  // Detect both iOS and Android
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;
  const posterUrl = nft.image || nft.metadata?.image || '';
  
  // Get network information for adaptive quality
  useEffect(() => {
    // Detect network type and capabilities
    const detectNetwork = () => {
      if (typeof navigator !== 'undefined' && 'connection' in navigator) {
        const connection = (navigator as any).connection;
        
        // Detect cellular vs wifi
        if (connection.type === 'cellular') {
          setNetworkType('cellular');
          
          // Determine generation based on effectiveType and measured performance
          const effectiveType = connection.effectiveType;
          const downlink = connection.downlink || 0; // Mbps
          
          // Check for 5G - ultra high bandwidth or user agent contains 5G
          if (downlink >= 25 || 
              (navigator?.userAgent && navigator.userAgent.toLowerCase().includes('5g'))) {
            setNetworkGeneration('5G');
            videoLogger.info('5G network detected!', { downlink: `${downlink} Mbps` });
          } else if (downlink >= 7 || effectiveType === '4g') {
            setNetworkGeneration('4G');
          } else if (downlink >= 1.5 || effectiveType === '3g') {
            setNetworkGeneration('3G');
          } else if (effectiveType === '2g') {
            setNetworkGeneration('2G');
          } else {
            setNetworkGeneration('unknown');
          }
          
          videoLogger.info('Cellular network detected', { 
            generation: networkGeneration,
            effectiveType,
            downlink: `${downlink} Mbps`
          });
        } else if (connection.type === 'wifi') {
          setNetworkType('wifi');
        } else {
          setNetworkType('unknown');
        }
      }
    };

    
    detectNetwork();
    
    // Monitor network changes
    const handleNetworkChange = () => {
      detectNetwork();
      
      // If on cellular, adjust video quality based on new network conditions
      if (networkType === 'cellular' && videoRef.current) {
        adjustQualityForCellular();
      }
    };

    
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      (navigator as any).connection.addEventListener('change', handleNetworkChange);
    }
    
    return () => {
      if (typeof navigator !== 'undefined' && 'connection' in navigator) {
        (navigator as any).connection.removeEventListener('change', handleNetworkChange);
      }
    };

  }, []);
  
  // Function to adjust video quality based on network conditions
  const adjustQualityForCellular = () => {
    if (!videoRef.current) return;
    
    // Apply optimizations based on network generation
    if (networkType === 'cellular') {
      const video = videoRef.current;
      
      // Basic optimizations for all cellular connections
      video.preload = 'metadata';
      
      if (networkGeneration === '2G' || networkGeneration === '3G') {
        // Lower quality for slower connections
        video.setAttribute('data-quality', 'low');
        
        // Reduce resolution
        video.style.maxHeight = networkGeneration === '2G' ? '360px' : '480px';
        
        // Reduce buffering aggressiveness
        if ('fastSeek' in video) {
          // Some browsers support fastSeek for more efficient seeking
          video.dataset.useFastSeek = 'true';
        }
        
        videoLogger.info('Applied low-quality optimizations for cellular', {
          generation: networkGeneration,
          maxHeight: video.style.maxHeight
        });
      } else {
        // 4G/5G can handle higher quality
        video.setAttribute('data-quality', 'medium');
        video.preload = 'auto';
        
        videoLogger.info('Using medium quality for 4G/5G cellular');
      }
    }
  };

  
  // Monitor buffering state
  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    
    const handleProgress = () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration;
        const progress = Math.round((bufferedEnd / duration) * 100);
        
        setLoadProgress(progress);
        
        // Determine buffering state
        if (progress >= 95) {
          setBufferingState('full');
        } else if (progress >= 15 || bufferedEnd >= video.currentTime + 10) {
          setBufferingState('sufficient');
        } else {
          setBufferingState('loading');
        }
      }
    };

    
    const handleWaiting = () => setBufferingState('loading');
    const handleCanPlay = () => {
      if (bufferingState !== 'full') {
        setBufferingState('sufficient');
      }
    };

    
    video.addEventListener('progress', handleProgress);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    
    return () => {
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
    };

  }, [bufferingState]);
  
  // Define multiple IPFS gateways to try
  const IPFS_GATEWAYS = [
    'https://w3s.link/ipfs/', // Web3.Storage's optimized gateway with caching layer
    'https://ipfs.filebase.io/ipfs/', // Filebase's S3-compatible gateway
    'https://nftstorage.link/ipfs/', // NFT.Storage's dedicated gateway
    'https://ipfs.infura.io/ipfs/', // Infura's enterprise-grade gateway
    'https://cloudflare-ipfs.com/ipfs/', // Cloudflare's high-performance gateway
    'https://ipfs.io/ipfs/', // IPFS project's official gateway
    'https://gateway.pinata.cloud/ipfs/', // Pinata's dedicated gateway
    'https://dweb.link/ipfs/', // Protocol Labs gateway
    'https://ipfs.4everland.io/ipfs/', // 4EVERLAND distributed gateway
    'https://gateway.ipfs.io/ipfs/' // Another official IPFS gateway
  ];
  
  // We'll use processVideoUrl function to get the URL when needed
  // This ensures we always get the most up-to-date URL based on current gateway
  
  // Log that we're initializing the video player
  videoLogger.info('Initializing video player for NFT:', { 
    nft: nft.name || 'Unknown NFT',
    mediaKey
  });
  
  // Preload the media (safe even with CDN disabled)
  useEffect(() => {
    preloadNftMedia(nft);
  }, [nft]);
  
  // Handle URL processing for different protocols
  const processVideoUrl = (): string => {
    if (typeof directUrl === 'string') {
      if (directUrl.startsWith('ipfs://')) {
        // Choose the best gateway for each platform, but also respect fallback state
        const gateway = IPFS_GATEWAYS[currentGateway];
        return directUrl.replace('ipfs://', gateway);
      } else if (directUrl.startsWith('ar://')) {
        return directUrl.replace('ar://', 'https://arweave.net/');
      } else if (directUrl.includes('nftstorage.link')) {
        // Use URL parsing to properly check the hostname
        try {
          const url = new URL(directUrl);
          if (url.hostname === 'nftstorage.link') {
            // NFT.Storage URLs - already direct URLs
            return directUrl;
          }
        } catch (e) {
          videoLogger.warn('URL parsing failed for nftstorage.link check', { directUrl });
        }
      } else if (directUrl.startsWith('http')) {
        try {
          // Properly parse the URL to check hostname
          const url = new URL(directUrl);
          if (url.hostname === 'ipfs.infura.io' || url.hostname.endsWith('.ipfs.infura.io')) {
            // Handle Infura IPFS URLs
            const parts = directUrl.split('/ipfs/');
            if (parts.length > 1) {
              const cid = parts[1];
              const gateway = IPFS_GATEWAYS[currentGateway];
              return `${gateway}${cid}`;
            }
          }
          
          const knownGateways = [
            'cloudflare-ipfs.com',
            'ipfs.dweb.link',
            'gateway.pinata.cloud',
            'ipfs.io',
            'dweb.link',
            'ipfs.4everland.io',
            'gateway.ipfs.io'
          ];
          
          // Check if hostname is a known IPFS gateway
          const isKnownGateway = knownGateways.some(gateway => 
            url.hostname === gateway || url.hostname.endsWith(`.${gateway}`)
          );
          
          if (isKnownGateway && hasError) {
            // If already using a gateway but it failed, try the next one
            const cid = extractIPFSCID(directUrl);
            if (cid) {
              const gateway = IPFS_GATEWAYS[currentGateway];
              return `${gateway}${cid}`;
            }
          }
        } catch (e) {
          // If URL parsing fails, continue with other checks
          videoLogger.warn('URL parsing failed for gateway check', { directUrl });
        }
      }
    }
    
    // For all other cases, return the original URL or processed URL
    return processMediaUrl(directUrl, '', 'audio');
  }
  
  // Extract IPFS CID from various gateway URLs
  function extractIPFSCID(urlString: string): string | null {
    if (typeof urlString !== 'string') return null;
    // Common patterns for IPFS URLs
    const patterns = [
      /ipfs\/([a-zA-Z0-9]+)/,
      /ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/,
      /gateway\.pinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
      /cloudflare-ipfs\.com\/ipfs\/([a-zA-Z0-9]+)/,
      /dweb\.link\/ipfs\/([a-zA-Z0-9]+)/,
      /ipfs\.4everland\.io\/ipfs\/([a-zA-Z0-9]+)/,
      /gateway\.ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/
    ];
    
    for (const pattern of patterns) {
      const match = urlString.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }
  
  // Check if this is a hosted video player URL rather than a direct video file
  // SECURITY: Properly parse URL to prevent URL substring bypass attacks
  const isHostedPlayer = typeof directUrl === 'string' && (() => {
    try {
      // Safely parse the URL
      const parsedUrl = new URL(directUrl);
      
      // Define allowed hosted player domains
      const allowedHostedPlayerDomains = [
        // Video platforms
        { domain: 'player.vimeo.com', exact: true },
        { domain: 'youtube.com', path: '/embed' },
        
        // NFT/Web3 platforms
        { domain: 'opensea.io', path: '/assets' },
        { domain: 'sound.xyz', path: '/embed' },
        { domain: 'zora.co', path: '/collect' },
        { domain: 'embed.zora.co', exact: true },
        { domain: 'foundation.app', path: '/embed' },
        { domain: 'audius.co', path: '/embed' },
        { domain: 'catalog.works', path: '/embed' },
        { domain: 'nina.market', path: '/embed' },
        { domain: 'glass.xyz', path: '/embed' },
        { domain: 'app.manifold.xyz', path: '/embed' },
        { domain: 'embed.manifold.xyz', exact: true }
      ];
      
      // Check if the hostname and path match our allowed hosted player domains
      return allowedHostedPlayerDomains.some(({ domain, exact, path }) => {
        const isHostMatch = exact 
          ? parsedUrl.hostname === domain
          : parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`);
          
        const isPathMatch = !path || parsedUrl.pathname.startsWith(path);
        
        return isHostMatch && isPathMatch;
      });
    } catch (error) {
      // If URL parsing fails, log error and return false
      videoLogger.warn('Invalid video URL:', directUrl);
      return false;
    }
  })();
  
  // Use Intersection Observer for visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        
        // Clean up video resources when no longer visible
        if (!entry.isIntersecting && videoRef.current) {
          videoPerformanceMonitor.cleanupVideoResources(videoRef.current);
        }
      },
      { threshold: 0.1 }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Always preload video metadata, but only fully load when visible
  // This change helps video start faster along with audio
  const shouldLoadVideo = isVisible;
  const shouldPlayVideo = isVisible && isHovered;

  // Early video preload effect - runs once on component mount
  useEffect(() => {
    // Start preloading video metadata as soon as component mounts
    if (typeof directUrl === 'string' && directUrl && !isHostedPlayer) {
      const processedUrl = processVideoUrl();
      
      // Use Image prefetching for video poster
      if (posterUrl) {
        const img = new Image();
        img.src = posterUrl;
      }
      
      // Use link preload for video - this signals browser to start loading
      // even before the video element is fully set up
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'video';
      link.href = processedUrl;
      document.head.appendChild(link);
      
      // Clean up
      return () => {
        document.head.removeChild(link);
      };

    }
  }, [directUrl, isHostedPlayer, posterUrl]);
  
  // Main video loading effect - handles actual video setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHostedPlayer) return;
    
    // Reset video element to prevent previous error states from persisting
    video.removeAttribute('src');
    
    // Progressive loading setup - starts with metadata only
    video.preload = 'metadata';
    
    // Set playsinline early to ensure proper mobile behavior
    video.playsInline = true;
    video.muted = true;
    
    // Force a load to initiate metadata download
    video.load();
    
    // Check if we've exceeded max retries
    if (currentGateway === 0 && retryCount >= MAX_RETRIES) {
      setHasError(true);
      if (onError) onError(new Error('Maximum retry attempts reached'));
      return; // Stop trying after reaching max retries
    }
    
    // Get the processed URL based on current gateway
    const processedUrl = processVideoUrl();
    
    // Set video URL after processing
    video.src = processedUrl;
    
    // Log the URL being used for debugging
    videoLogger.info('Setting video source:', {
      nft: nft.name || 'Unknown NFT',
      mediaKey,
      url: processedUrl,
      retryCount,
      gateway: currentGateway
    });
    
    // Absolute minimal setup - just the essential attributes
    video.muted = true;
    video.playsInline = true;
    
    // Mobile-specific optimizations
    if (isMobile) {
      // Both Android and iOS need these optimizations
      video.style.transform = 'translateZ(0)'; // Hardware acceleration
      
      // Check for cellular connection on mobile
      if (typeof navigator !== 'undefined' && 'connection' in navigator) {
        const connection = (navigator as any).connection;
        
        // Detect cellular vs wifi
        if (connection.type === 'cellular') {
          setNetworkType('cellular');
          
          // Determine generation based on effectiveType and measured performance
          const effectiveType = connection.effectiveType;
          const downlink = connection.downlink || 0; // Mbps
          
          // Check for 5G - ultra high bandwidth or user agent contains 5G
          if (downlink >= 25 || 
              (navigator?.userAgent && navigator.userAgent.toLowerCase().includes('5g'))) {
            setNetworkGeneration('5G');
            videoLogger.info('5G network detected!', { downlink: `${downlink} Mbps` });
          } else if (downlink >= 7 || effectiveType === '4g') {
            setNetworkGeneration('4G');
          } else if (downlink >= 1.5 || effectiveType === '3g') {
            setNetworkGeneration('3G');
          } else if (effectiveType === '2g') {
            setNetworkGeneration('2G');
          } else {
            setNetworkGeneration('unknown');
          }
          
          // Cellular optimizations based on generation
          if (networkGeneration === '5G') {
            // 5G can handle high quality
            video.preload = 'auto';
            // Enable DASH-like segmented loading by setting sizes
            video.dataset.segmentSize = '4000000'; // 4MB segments
            video.setAttribute('data-quality', 'high');
            // No height restrictions for 5G
            
            videoLogger.info('Applied 5G optimizations - using high quality', {
              generation: networkGeneration,
              effectiveType,
              downlink: `${downlink} Mbps`
            });
          }
          else if (networkGeneration === '4G') {
            // 4G can handle good quality
            video.preload = 'auto';
            video.setAttribute('data-quality', 'medium');
            
            videoLogger.info('Applied 4G optimizations - using medium quality', {
              generation: networkGeneration,
              effectiveType,
              downlink: `${downlink} Mbps`
            });
          }
          else if (networkGeneration === '2G' || networkGeneration === '3G') {
            // 2G/3G need low quality settings
            video.preload = 'metadata';
            video.setAttribute('data-quality', 'low');
            video.style.maxHeight = networkGeneration === '2G' ? '360px' : '480px';
            
            videoLogger.info('Applied cellular optimizations for slower networks', {
              generation: networkGeneration,
              effectiveType,
              downlink: `${downlink} Mbps`
            });
          }
        } else if (connection.type === 'wifi') {
          setNetworkType('wifi');
        }
      }
      
      // Android-specific handling
      if (isAndroid) {
        video.preload = 'metadata'; // Save bandwidth on Android
        // Android often performs better with explicit controls
        video.controls = true;
      }
      
      // iOS-specific handling
      if (isIOS) {
        video.setAttribute('webkit-playsinline', 'true');
        video.preload = 'metadata';
        video.controls = true;
      }
    } else {
      // Desktop can handle higher quality and autoloading
      video.preload = 'auto';
    }
    
    const handleCanPlay = (): void => {
      setHasError(false); // Reset error state on successful load
      setBufferingState('sufficient');
      if (onLoadComplete) onLoadComplete();
    };

    
    // Add progress monitoring for buffering state
    const handleProgress = (): void => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration;
        const progress = Math.round((bufferedEnd / duration) * 100);
        
        setLoadProgress(progress);
        
        // Determine buffering state
        if (progress >= 95) {
          setBufferingState('full');
        } else if (progress >= 15 || bufferedEnd >= video.currentTime + 10) {
          setBufferingState('sufficient');
        } else {
          setBufferingState('loading');
        }
      }
    };

    
    const handleWaiting = (): void => {
      setBufferingState('loading');
    };

    
    const handleError = (e: Event): void => {
      // Only log the first error for each video
      if (!hasError) {
        console.error('Video playback error:', e);
      }
      
      // Try the next gateway if this is an IPFS URL
      if (typeof directUrl === 'string' && (
          directUrl.includes('ipfs://') || 
          directUrl.includes('ipfs.') || 
          directUrl.includes('/ipfs/'))) {
        
        const nextGateway = (currentGateway + 1) % IPFS_GATEWAYS.length;
        
        // If we're cycling back to the first gateway, increment retry count
        if (nextGateway === 0) {
          // If we've already hit max retries, give up
          if (retryCount >= MAX_RETRIES) {
            setHasError(true);
            if (onError) onError(new Error('Failed to load video after maximum retries'));
            return;
          }
          
          // Otherwise increment retry count and continue
          setRetryCount(retryCount + 1);
        }
        
        // Only try the next gateway if we haven't exceeded max retries
        if (retryCount < MAX_RETRIES) {
          if (!hasError) {
            console.log(`Trying gateway ${nextGateway + 1}/${IPFS_GATEWAYS.length} (retry ${retryCount + 1}/${MAX_RETRIES + 1})...`);
          }
          setHasError(true);
          setCurrentGateway(nextGateway);
        }
        return;
      }
      
      // For other URLs, fail gracefully after first attempt
      if (!hasError && typeof directUrl === 'string') {
        setHasError(true);
        if (onError) onError(new Error('Video failed to load'));
      }
    };

    
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('waiting', handleWaiting);
    
    // Apply adaptive streaming optimizations based on connection quality
    optimizeVideoForConnection(video, mediaKey, isMobile);
    
    // Add a loadedmetadata listener to transition to auto preload after metadata is loaded
    // This creates a progressive loading effect that gets video started faster
    const handleLoadedMetadata = () => {
      // Once we have basic metadata, switch to auto preload if we're on wifi or 4G/5G
      if (networkType === 'wifi' || 
          (networkType === 'cellular' && 
           (networkGeneration === '4G' || networkGeneration === '5G'))) {
        video.preload = 'auto';
      }
      videoLogger.info('Video metadata loaded, switching to more aggressive loading');
    };

    
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    
    // Simple one-time play attempt when video element is ready
    if (retryCount < MAX_RETRIES) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          // Don't log autoplay errors, they're expected
          if (err.name !== 'NotAllowedError') {
            console.log('Play failed:', err.name);
          }
        });
      }
    }
    
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      
      // Cancel any pending play operation when unmounting
      if (video.src) {
        video.pause();
        video.src = '';
        video.load();
      }
    };

  }, [isHostedPlayer, onLoadComplete, onError, directUrl, isMobile, isIOS, isAndroid, hasError, currentGateway, retryCount, mediaKey, nft, MAX_RETRIES]);

  useEffect(() => {
    if (!videoRef.current || !shouldLoadVideo) return;
    
    const video = videoRef.current;
    const processedUrl = processVideoUrl();
    
    // Apply performance optimizations and memory management
    videoPerformanceMonitor.optimizeVideoElement(video, mediaKey);
    
    // Set up video source if needed
    if (!isHostedPlayer) {
      video.src = processedUrl;
    }
    
    // Set up event handlers
    const handleError = () => {
      videoLogger.warn('Video error occurred', { 
        url: processedUrl, 
        gateway: currentGateway,
        error: video.error?.message || 'Unknown error'
      });
      
      // Try the next gateway
      setHasError(true);
      
      // Clean up resources on error to prevent memory leaks
      videoPerformanceMonitor.cleanupVideoResources(video);
      
      // If we've tried all gateways, increment retry count and start over
      if (currentGateway === IPFS_GATEWAYS.length - 1) {
        if (retryCount < MAX_RETRIES) {
          setRetryCount(retryCount + 1);
          setCurrentGateway(0);
        }
      } else {
        // Try the next gateway
        setCurrentGateway(currentGateway + 1);
      }
    };
    
    const handleLoadedData = () => {
      // Reset error state since video loaded successfully
      setHasError(false);
      
      // Apply optimizations for cellular connections
      if (networkType === 'cellular') {
        adjustQualityForCellular();
      }
      
      // Notify parent component that loading is complete
      onLoadComplete?.();
    };
    
    // We don't need to add these listeners as the performance monitor already does
    // But we'll add our specific handlers for this component's state management
    video.addEventListener('error', handleError);
    video.addEventListener('loadeddata', handleLoadedData);
    
    return () => {
      // Clean up event listeners
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [shouldLoadVideo, currentGateway, retryCount, processVideoUrl, isHostedPlayer, onLoadComplete, networkType, mediaKey]);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        // Use our enhanced video performance monitor to clean up resources
        videoPerformanceMonitor.cleanupVideoResources(videoRef.current);
      }
    };
  }, []);

  // Render an iframe for hosted players, or video for direct media
  if (isHostedPlayer) {
    // Get the processed URL for the iframe
    const iframeUrl = processVideoUrl();
    
    return (
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        className="w-full h-full border-0 rounded-md"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title={nft.name || "NFT Media"}
      />
    );
  }
  
  // If we've tried all gateways and still have errors, show a static image fallback
  if (hasError && (currentGateway === 0 && retryCount >= MAX_RETRIES)) {
    return (
      <div className="relative w-full h-full">
        <img
          src={posterUrl || "/default-nft.png"}
          alt={nft.name || "NFT Media"}
          className="w-full h-full object-cover rounded-md"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-1 px-2 text-center">
          Video unavailable
        </div>
      </div>
    );
  }
  
  return (
    <div 
      ref={elementRef}
      className="relative w-full h-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Static thumbnail */}
      <img
        src={nft.image || nft.metadata?.image || '/default-nft.png'}
        alt={nft.name || 'NFT'}
        className={`w-full h-full object-cover ${shouldLoadVideo ? 'opacity-0' : 'opacity-100'}`}
        style={{
          position: shouldLoadVideo ? 'absolute' : 'relative',
          transition: 'opacity 0.3s ease-in-out'
        }}
      />
      
      {/* Video - always start preloading metadata, but only fully load when needed */}
      {!hasError && (
        <>
          <video
            ref={videoRef}
            id={`video-${nft.contract}-${nft.tokenId}`}
            poster={nft.image || nft.metadata?.image}
            muted
            loop
            playsInline
            autoPlay={shouldPlayVideo} // Only autoplay when visible and hovered
            controls={isMobile} // Add controls for all mobile devices
            className={`w-full h-full object-cover rounded-md ${shouldLoadVideo ? 'opacity-100' : 'opacity-0'}`}
            preload="metadata" // Always start with metadata for faster loading
            data-network-type={networkType}
            data-network-generation={networkGeneration}
            data-media-key={mediaKey} // Ensure mediaKey tracking is maintained
            data-priority="high" // Mark as high priority for browser loading
            style={{ 
              transform: 'translateZ(0)', // Hardware acceleration for all platforms
              // Add Android-specific height limitations to improve performance
              ...(isAndroid ? { maxHeight: '480px' } : {})
            }} 
            {...(isIOS ? { 'webkit-playsinline': 'true' } : {})}
            {...(isAndroid ? { 'playsinline': 'true' } : {})}
          />
          
          {/* Cellular network indicator */}
          {networkType === 'cellular' && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded">
              {networkGeneration !== 'unknown' ? networkGeneration : 'Cellular'}
            </div>
          )}
          
          {/* Loading indicator */}
          {bufferingState === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40">
              <div className="text-white text-sm">
                {loadProgress > 0 ? `Loading: ${loadProgress}%` : 'Buffering...'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Export the memoized component to prevent unnecessary re-renders
export const DirectVideoPlayer = React.memo(DirectVideoPlayerBase, (prevProps, nextProps) => {
  // Only re-render if the NFT mediaKey changes
  const prevMediaKey = getMediaKey(prevProps.nft);
  const nextMediaKey = getMediaKey(nextProps.nft);
  return prevMediaKey === nextMediaKey;
});

