import { useState, useEffect, useRef } from 'react';
import { processMediaUrl, IPFS_GATEWAYS, isAudioUrlUsedAsImage, getCleanIPFSUrl, processArweaveUrl, getMediaKey, buildArweaveMediaFallbackUrls, buildIpfsFallbackUrls, extractIPFSPath } from '../../utils/media';
import Image from 'next/image';
import type { SyntheticEvent } from 'react';
import type { NFT } from '../../types/user';
import { useNFTPreloader } from '../../hooks/useNFTPreloader';
import { logger } from '../../utils/logger';
import { getNftCdnUrl, preloadNftMedia } from '../../utils/cdn';
import { markNftMediaDead } from '../../utils/deadNftRegistry';
import { rememberWorkingMediaUrl, forgetMediaUrl, getRememberedMediaUrl } from '../../utils/gatewayMemory';

// Create a dedicated logger for NFT images
const imageLogger = logger.getModuleLogger('nftImage');

interface NFTImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  nft?: NFT;
  sizes?: string;
  quality?: number;
  loading?: 'lazy' | 'eager';
  placeholder?: 'empty';
}

/**
 * Safely checks if a URL is an Arweave URL by properly parsing it
 * SECURITY: This function uses URL parsing instead of string inclusion for validation
 */
const isArweaveUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  
  // Skip validation for default/local images
  if (url.startsWith('/') || url.includes('default-nft.png')) return false;
  
  // Protocol check is safe - only if it's the exact protocol
  if (url.startsWith('ar://')) return true;
  
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    return host === 'arweave.net' ||
           host.endsWith('.arweave.net') ||
           host === 'turbo-gateway.com' ||
           host.endsWith('.turbo-gateway.com') ||
           host === 'permagate.io' ||
           host.endsWith('.permagate.io') ||
           host === 'gateway.irys.xyz' ||
           host === 'ar-io.dev' ||
           host === 'g8way.io';
  } catch (error) {
    // Only log for non-default images to reduce console spam
    if (!url.includes('default-nft.png')) {
      imageLogger.warn('Invalid URL in Arweave check', { url });
    }
    return false;
  }
};

/**
 * Safely checks if a URL is an IPFS URL by properly parsing it
 * SECURITY: This function uses URL parsing instead of string inclusion for validation
 */
const isIpfsUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  
  // Protocol check is safe - only if it's the exact protocol
  if (url.startsWith('ipfs://')) return true;
  
  try {
    const parsedUrl = new URL(url);
    
    // Known IPFS gateway hostnames - exact matches required
    const knownIpfsHosts = [
      'ipfs.io',
      'dweb.link',
      'nftstorage.link',
      'gateway.pinata.cloud',
      'w3s.link',
      'gateway.ipfs.io',
      'cloudflare-ipfs.com', // dead DNS; still recognize so we can rewrite/fallback
    ];
    
    // Check hostname (not full URL) against allowed list
    const isKnownHost = knownIpfsHosts.some(host => 
      parsedUrl.hostname === host || 
      parsedUrl.hostname.endsWith(`.${host}`)
    );
    
    // Check if path starts with /ipfs/ exactly (not substring)
    const hasIpfsPath = parsedUrl.pathname.startsWith('/ipfs/');
    
    return isKnownHost || hasIpfsPath;
  } catch (error) {
    // Only log for non-default images to reduce console spam
    if (!url.includes('default-nft.png') && !url.startsWith('/')) {
      imageLogger.warn('Invalid URL in IPFS check', { url });
    }
    return false;
  }
};

/**
 * Get the next IPFS gateway URL for retry attempts (preserves CID/file subpaths).
 */
const getNextIPFSUrl = (url: string, currentIndex: number): { url: string; nextIndex: number } | null => {
  url = getCleanIPFSUrl(url);

  if (currentIndex >= IPFS_GATEWAYS.length - 1) {
    imageLogger.warn('All IPFS gateways have been tried', { url });
    return null;
  }

  const path = extractIPFSPath(url);
  if (!path) {
    imageLogger.warn('Could not extract IPFS path from URL', { url });
    return null;
  }

  const nextIndex = currentIndex + 1;
  return {
    url: `${IPFS_GATEWAYS[nextIndex]}${path}`,
    nextIndex
  };
};

/**
 * Validate a URL string properly
 * SECURITY: This function uses URL parsing to validate URLs safely
 */
const validateUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  
  // Check for empty or placeholder strings
  if (url === '' || url === 'undefined' || url === 'null') return false;
  
  try {
    // Attempt to parse as a URL - this will catch malformed URLs
    new URL(url);
    return true;
  } catch (error) {
    // Special case: ipfs:// protocol is valid but not a standard URL
    if (url.startsWith('ipfs://') || url.startsWith('ar://')) {
      return true;
    }
    return false;
  }
};

/**
 * Safely check if a URL is for audio or video by properly parsing URL
 * SECURITY: This function avoids substring checks for security
 */
const isMediaUrl = (url: string): { isAudio: boolean; isVideo: boolean } => {
  if (!validateUrl(url)) return { isAudio: false, isVideo: false };
  
  try {
    // Parse the URL to safely check path extension
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.toLowerCase();
    
    // Check file extensions - exact match at end of pathname
    const isAudio = path.endsWith('.mp3') || 
                   path.endsWith('.wav') || 
                   path.endsWith('.ogg') || 
                   path.endsWith('.flac') || 
                   path.endsWith('.m4a');
                   
    const isVideo = path.endsWith('.mp4') || 
                   path.endsWith('.webm') || 
                   path.endsWith('.mov') || 
                   path.endsWith('.m4v') || 
                   path.endsWith('.avi');
    
    // Check for audio/video in path but only with path segment boundary
    // This avoids matching things like /audio-files/image.png or /video-thumbnails/pic.jpg
    const pathParts = parsedUrl.pathname.split('/');
    const hasAudioPath = pathParts.includes('audio');
    const hasVideoPath = pathParts.includes('video');
                   
    return { 
      isAudio: isAudio || hasAudioPath, 
      isVideo: isVideo || hasVideoPath 
    };
  } catch (error) {
    // Fallback for non-standard URLs (ipfs://, ar://)
    if (url.startsWith('ipfs://') || url.startsWith('ar://')) {
      const lowerUrl = url.toLowerCase();
      const isAudio = lowerUrl.endsWith('.mp3') || 
                     lowerUrl.endsWith('.wav') || 
                     lowerUrl.endsWith('.ogg') || 
                     lowerUrl.endsWith('.flac');
                     
      const isVideo = lowerUrl.endsWith('.mp4') || 
                     lowerUrl.endsWith('.webm') || 
                     lowerUrl.endsWith('.mov') || 
                     lowerUrl.endsWith('.avi');
                     
      return { isAudio, isVideo };
    }
    
    return { isAudio: false, isVideo: false };
  }
};

export const NFTImage: React.FC<NFTImageProps> = ({ 
  src, 
  alt, 
  className, 
  width = 300, 
  height = 300, 
  priority = false,
  nft,
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  quality = 75,
  loading = 'lazy',
  placeholder = 'empty'
}) => {
  const fallbackSrc = '/default-nft.png';
  const [isVideo, setIsVideo] = useState(false);
  
  // Check if src is valid using proper URL validation
  const initialSrc = !validateUrl(src) ? fallbackSrc : src;
  const [imgSrc, setImgSrc] = useState<string>(initialSrc);
  const [error, setError] = useState(!validateUrl(src));
  const [retryCount, setRetryCount] = useState(0);
  const [currentGatewayIndex, setCurrentGatewayIndex] = useState(0);
  const [isLoadingFallback, setIsLoadingFallback] = useState(!validateUrl(src));
  const [imgLoading, setImgLoading] = useState(true);

  // Cache for processed image URLs to avoid redundant processing
  const processedUrlCache = useRef<Record<string, string>>({});
  const arweaveFallbackUrls = useRef<string[]>([]);
  const arweaveFallbackIndex = useRef(0);
  const ipfsFallbackUrls = useRef<string[]>([]);
  const ipfsFallbackIndex = useRef(0);
  
  useEffect(() => {
    // Reset states when src changes, but only if src is valid
    const isValidSrc = src && src !== '' && src !== 'undefined' && src !== 'null';
    arweaveFallbackUrls.current = [];
    arweaveFallbackIndex.current = 0;
    ipfsFallbackUrls.current = [];
    ipfsFallbackIndex.current = 0;
    
    if (isValidSrc) {
      // Check if we've already processed this URL
      const cacheKey = nft ? `${nft.contract}-${nft.tokenId}` : src;
      
      if (processedUrlCache.current[cacheKey]) {
        setImgSrc(processedUrlCache.current[cacheKey]);
      } else {
        // Use a consistent approach for all URL types
        if (nft) {
          // If we have an NFT object, use the CDN URL specifically for this NFT
          const cdnUrl = getNftCdnUrl(nft, 'image');
          setImgSrc(cdnUrl);
          processedUrlCache.current[cacheKey] = cdnUrl;
        } else {
          // Process the URL to handle all special protocols (ar://, ipfs://, etc.)
          // using our improved processMediaUrl function
          const processedSrc = processMediaUrl(src, fallbackSrc, 'image');
          setImgSrc(processedSrc);
          processedUrlCache.current[cacheKey] = processedSrc;
        }
      }
      
      setError(false);
      setRetryCount(0);
      setCurrentGatewayIndex(0);
      setIsLoadingFallback(false);
    } else {
      // Invalid source, use fallback immediately
      setImgSrc(fallbackSrc);
      setError(true);
      setIsLoadingFallback(true);
    }
    
    // Use our secure isMediaUrl function for all media detection
    const { isAudio, isVideo } = isMediaUrl(src);
    
    // If this is a video URL, set the video flag
    if (isVideo) {
      setIsVideo(true);
    }

    setError(false);
    setRetryCount(0);

    // Always use the NFT's image as thumbnail, regardless of content type
    if (nft?.metadata?.image || nft?.image) {
      setIsVideo(false);
      const thumbnailUrl = nft.metadata?.image || nft.image;
      
      // Check if image URL matches any audio URL
      if (nft && isAudioUrlUsedAsImage(nft, thumbnailUrl)) {
        imageLogger.warn('NFT using audio URL as image, using fallback:', {
          contract: nft.contract,
          tokenId: nft.tokenId
        });
        setImgSrc(fallbackSrc);
        return;
      }
      
      // Use CDN for NFT thumbnails if available
      if (nft) {
        setImgSrc(getNftCdnUrl(nft, 'image'));
      } else {
        setImgSrc(processMediaUrl(thumbnailUrl, fallbackSrc, 'image'));
      }
      return;
    }

    // For NFTs with image
    if (src) {
      // Check if image URL matches any audio URL
      if (nft && isAudioUrlUsedAsImage(nft, src)) {
        setIsVideo(false);
        setImgSrc(fallbackSrc);
        imageLogger.warn('NFT using audio URL as image, using fallback:', {
          contract: nft.contract,
          tokenId: nft.tokenId
        });
        return;
      }
      
      setIsVideo(false);
      // Clean and process the URL - handle all special URL types including ar:// and ipfs://
      if (nft) {
        // Use CDN for NFT images if we have the NFT object
        setImgSrc(getNftCdnUrl(nft, 'image'));
      } else if (isArweaveUrl(src) || isIpfsUrl(src)) {
        // Safely process special URL protocols
        const cleanedUrl = isArweaveUrl(src) ? processArweaveUrl(src) : getCleanIPFSUrl(src);
        setImgSrc(processMediaUrl(cleanedUrl, fallbackSrc, 'image'));
      } else {
        // Use CDN for direct URLs too
        setImgSrc(processMediaUrl(src, fallbackSrc, 'image'));
      }
    }
    // Fallback
    else {
      setIsVideo(false);
      setImgSrc(fallbackSrc);
    }
  }, [src, nft]);

  // Track already attempted fallback strategies to avoid redundant retries
  const attemptedFallbacks = useRef<Record<string, boolean>>({});
  
  const handleError = async (error: SyntheticEvent<HTMLVideoElement | HTMLImageElement>) => {
    // Get the current failing URL
    const failedSrc = error.currentTarget.src || imgSrc;
    
    // Skip if we've already tried this fallback strategy
    const fallbackKey = `${failedSrc}-${retryCount}`;
    if (attemptedFallbacks.current[fallbackKey]) {
      // Go straight to fallback image without logging
      setImgSrc(fallbackSrc);
      return;
    }
    
    // Only log errors in development mode and only for non-default images
    // This reduces console spam for expected fallbacks
    if (process.env.NODE_ENV === 'development' && !failedSrc.includes('/default-nft.png')) {
      imageLogger.warn('NFT Image load failed', { 
        nftName: nft?.name || 'Unknown',
        mediaKey: nft ? getMediaKey(nft) : 'unknown',
        attemptedUrl: failedSrc.substring(0, 100) // Truncate long URLs
      });
    }
    
    // Mark this fallback as attempted
    attemptedFallbacks.current[fallbackKey] = true;

    // The gateway we remembered as "working" just failed — stop recommending it.
    if (nft) {
      const mediaKeyForMemory = getMediaKey(nft);
      if (failedSrc === getRememberedMediaUrl(mediaKeyForMemory, 'image')) {
        forgetMediaUrl(mediaKeyForMemory, 'image');
      }
    }
    
    // If we have an NFT, try to preload its media into the CDN cache for future requests
    // but only do this once per NFT
    if (nft && retryCount === 0) {
      preloadNftMedia(nft);
    }
    
    // Special handling for Arweave / PODs URLs — cycle turbo/permagate /raw/ fallbacks
    if (src && isArweaveUrl(src)) {
      if (arweaveFallbackUrls.current.length === 0) {
        arweaveFallbackUrls.current = buildArweaveMediaFallbackUrls(src);
        arweaveFallbackIndex.current = 0;
      }

      // Skip the URL that already failed
      while (
        arweaveFallbackIndex.current < arweaveFallbackUrls.current.length &&
        (arweaveFallbackUrls.current[arweaveFallbackIndex.current] === failedSrc ||
          attemptedFallbacks.current[`${arweaveFallbackUrls.current[arweaveFallbackIndex.current]}-ar`])
      ) {
        arweaveFallbackIndex.current += 1;
      }

      if (arweaveFallbackIndex.current < arweaveFallbackUrls.current.length) {
        const nextUrl = arweaveFallbackUrls.current[arweaveFallbackIndex.current];
        attemptedFallbacks.current[`${nextUrl}-ar`] = true;
        arweaveFallbackIndex.current += 1;
        setImgSrc(nextUrl);
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }

    // Cycle working IPFS gateways (cloudflare-ipfs.com and others may fail)
    if ((src && isIpfsUrl(src)) || (failedSrc && isIpfsUrl(failedSrc))) {
      if (ipfsFallbackUrls.current.length === 0) {
        ipfsFallbackUrls.current = buildIpfsFallbackUrls(src || failedSrc);
        ipfsFallbackIndex.current = 0;
      }

      while (
        ipfsFallbackIndex.current < ipfsFallbackUrls.current.length &&
        (ipfsFallbackUrls.current[ipfsFallbackIndex.current] === failedSrc ||
          attemptedFallbacks.current[`${ipfsFallbackUrls.current[ipfsFallbackIndex.current]}-ipfs`])
      ) {
        ipfsFallbackIndex.current += 1;
      }

      if (ipfsFallbackIndex.current < ipfsFallbackUrls.current.length) {
        const nextUrl = ipfsFallbackUrls.current[ipfsFallbackIndex.current];
        attemptedFallbacks.current[`${nextUrl}-ipfs`] = true;
        ipfsFallbackIndex.current += 1;
        setImgSrc(nextUrl);
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }
    
    // Every gateway/fallback has been tried at this point — safe to remember
    // this NFT's image as dead so other views don't retry it needlessly.
    if (nft) {
      markNftMediaDead(nft, 'image');
    }

    // CRITICAL: Immediately switch to fallback image and force re-render
    setTimeout(() => {
      // Use setTimeout to ensure state updates happen in new event loop
      setError(true);
      setIsLoadingFallback(true);
      setImgSrc(fallbackSrc);
      
      // Force image element to reload with fallback
      const imgElement = error.currentTarget as HTMLImageElement;
      if (imgElement) {
        imgElement.src = fallbackSrc;
      }
    }, 0);
  };

  // A successful load means whatever URL is currently displayed actually works —
  // remember it so future renders of this same media skip straight past dead gateways.
  const handleLoad = (loadedSrc: string) => {
    if (!nft || !loadedSrc || loadedSrc.includes('default-nft.png')) return;
    rememberWorkingMediaUrl(getMediaKey(nft), 'image', loadedSrc);
  };

  // SECURITY: Use proper URL validation for determining render method
  // Use regular img tag for IPFS/Arweave content to bypass Next.js image optimization
  const isSpecialProtocol = isIpfsUrl(imgSrc) || isArweaveUrl(imgSrc);
  
  // CRITICAL: Additional validation before finalizing source
  // This ensures we NEVER show a blank card, even for malformed NFT data
  const validateSrc = (source: string): boolean => {
    if (!source || typeof source !== 'string') return false;
    
    // Basic string validation
    if (source === 'undefined' || 
        source === 'null' || 
        source === '') {
      return false;
    }
    
    try {
      // Try to parse as URL to catch malformed URLs
      // Special case for ipfs:// and ar:// protocols
      if (source.startsWith('ipfs://') || source.startsWith('ar://')) {
        return true;
      }
      
      // Parse URL to validate
      const parsedUrl = new URL(source);
      
      // Check for invalid/empty hostname
      if (!parsedUrl.hostname || 
          parsedUrl.hostname === 'undefined' || 
          parsedUrl.hostname === 'null') {
        return false;
      }
      
      return true;
    } catch (error) {
      // URL parsing failed
      return false;
    }
  };
  
  // CRITICAL: Always display fallback image when there's an error or invalid source - NO EXCEPTIONS
  // Double-validate that fallback path is correct and accessible
  const absoluteFallbackSrc = fallbackSrc.startsWith('/') ? fallbackSrc : `/${fallbackSrc}`;
  const finalSrc = (error || isLoadingFallback || !validateSrc(imgSrc)) ? absoluteFallbackSrc : imgSrc;
  
  // Check if this is an Arweave URL using proper validation
  const isArweave = isArweaveUrl(finalSrc);
  
  // For Arweave URLs, use regular img tag to bypass Next.js image restrictions
  if (isArweave) {
    // Convert ar:// to https://arweave.net/ if needed
    const arweaveUrl = finalSrc.startsWith('ar://') 
      ? processArweaveUrl(finalSrc)
      : finalSrc;
      
    return (
      <img
        src={arweaveUrl}
        alt={alt}
        className={className}
        width={width || 300}
        height={height || 300}
        onError={handleError}
        onLoad={() => handleLoad(arweaveUrl)}
        // Add a data attribute to help with debugging
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        data-original-src={src}
        // Force re-render when source changes to ensure fallback works
        key={`nft-img-${error ? 'fallback' : 'original'}-${nft?.contract || ''}-${nft?.tokenId || ''}-${isLoadingFallback ? 'fallback' : 'normal'}`}
      />
    );
  }
  
  // For other content types, use Next.js Image or regular img based on protocol type
  if (isVideo || !isSpecialProtocol) {
    return (
      <Image
        src={finalSrc}
        alt={alt}
        className={className}
        width={width || 300}
        height={height || 300}
        quality={quality}
        sizes={sizes}
        loading={priority ? 'eager' : loading}
        placeholder={placeholder}
        onError={handleError}
        onLoad={() => handleLoad(finalSrc)}
        // Add a data attribute to help with debugging
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        // Force re-render when source changes to ensure fallback works
        key={`nft-img-${error ? 'fallback' : 'original'}-${nft?.contract || ''}-${nft?.tokenId || ''}-${isLoadingFallback ? 'fallback' : 'normal'}`}
      />
    );
  }

  return (
    <>
      {imgLoading && <div className="animate-pulse bg-gray-700 absolute inset-0"></div>}
      <img
        src={finalSrc}
        alt={alt}
        className={className}
        width={width || 300}
        height={height || 300}
        onError={handleError}
        onLoad={() => { setImgLoading(false); handleLoad(finalSrc); }}
        // Add a data attribute to help with debugging
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        loading={priority ? 'eager' : loading}
        sizes={sizes}
        // Improve the key to be more stable and unique
        key={`nft-img-${nft?.contract || 'unknown'}-${nft?.tokenId || 'unknown'}`}
        style={{ objectFit: 'cover' }}
      />
    </>
  );
};
////