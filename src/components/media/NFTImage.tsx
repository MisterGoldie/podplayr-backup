import { useState, useEffect, useRef } from 'react';
import { processMediaUrl, IPFS_GATEWAYS, isAudioUrlUsedAsImage, getCleanIPFSUrl, processArweaveUrl, getMediaKey } from '../../utils/media';
import Image from 'next/image';
import type { SyntheticEvent } from 'react';
import type { NFT } from '../../types/user';
import { useNFTPreloader } from '../../hooks/useNFTPreloader';
import { logger } from '../../utils/logger';
import { getNftCdnUrl, preloadNftMedia } from '../../utils/cdn';

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
    // Only check hostname - not paths or query parameters
    return parsedUrl.hostname === 'arweave.net' || 
           parsedUrl.hostname.endsWith('.arweave.net');
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
      'cloudflare-ipfs.com',
      'nftstorage.link',
      'ipfs.infura.io'
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
 * Extract IPFS hash from a URL with secure parsing
 * SECURITY: This function properly parses URLs and uses path-based extraction
 */
const extractIPFSHash = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  
  // Handle ipfs:// protocol - exact protocol match is safe
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', '');
  }

  try {
    // Properly parse the URL to safely extract components
    const parsedUrl = new URL(url);
    
    // Extract hash from path component if it contains /ipfs/ segment
    if (parsedUrl.pathname.includes('/ipfs/')) {
      const parts = parsedUrl.pathname.split('/ipfs/');
      if (parts.length > 1) {
        // Take only the next segment after /ipfs/
        return parts[1].split('/')[0];
      }
    }
    
    // Use regex only on the pathname, not the full URL
    const ipfsRegex = /(?:ipfs\/|\/ipfs\/|ipfs:)([a-zA-Z0-9]{46,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55})/i;
    const match = parsedUrl.pathname.match(ipfsRegex);
    
    if (match) return match[1];
  } catch (error) {
    // Fall back to regex on the full URL only if URL parsing fails
    imageLogger.warn('URL parsing failed in extractIPFSHash', { url, error: String(error) });
    
    // Match IPFS hash patterns - support both v0 and v1 CIDs
    const ipfsRegex = /(?:ipfs\/|\/ipfs\/|ipfs:)([a-zA-Z0-9]{46,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55})/i;
    const match = url.match(ipfsRegex);
    
    if (match) return match[1];
    
    // Handle direct CID
    if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55}|[a-zA-Z0-9]{46,})$/.test(url)) {
      return url;
    }
  }
  
  return null;
};

/**
 * Get the next IPFS gateway URL for retry attempts
 * SECURITY: This function properly parses URLs to avoid substring vulnerabilities
 */
const getNextIPFSUrl = (url: string, currentIndex: number): { url: string; nextIndex: number } | null => {
  // Clean the URL first
  url = getCleanIPFSUrl(url);
  
  // If we've already tried all gateways, return null
  if (currentIndex >= IPFS_GATEWAYS.length - 1) {
    imageLogger.warn('All IPFS gateways have been tried', { url });
    return null;
  }

  // Extract IPFS hash/CID from the URL
  let cid = null;
  
  // Try to find which gateway we're currently using with proper URL parsing
  let currentGateway = null;
  try {
    // Parse the URL to safely extract hostname
    const parsedUrl = new URL(url);
    
    // Match gateway based on hostname comparison (not substring)
    currentGateway = IPFS_GATEWAYS.find(gateway => {
      try {
        // Parse each gateway URL to get its hostname
        const gatewayUrl = new URL(gateway);
        return parsedUrl.hostname === gatewayUrl.hostname;
      } catch {
        return false;
      }
    });
    
    // If we found a gateway and have a path, extract the CID
    if (currentGateway) {
      // Extract CID from pathname safely
      cid = extractIPFSHash(url);
    } else {
      // If not a gateway URL, try extracting hash directly
      cid = extractIPFSHash(url);
    }
  } catch (error) {
    // If URL parsing fails, fall back to extractIPFSHash function
    imageLogger.warn('URL parsing failed in getNextIPFSUrl', { url });
    cid = extractIPFSHash(url);
  }
  
  if (!cid) {
    imageLogger.warn('Could not extract IPFS CID from URL', { url });
    return null;
  }
  
  const nextIndex = (currentIndex + 1) % IPFS_GATEWAYS.length;
  return {
    url: `${IPFS_GATEWAYS[nextIndex]}${cid}`,
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
  
  useEffect(() => {
    // Reset states when src changes, but only if src is valid
    const isValidSrc = src && src !== '' && src !== 'undefined' && src !== 'null';
    
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
    
    // If we have an NFT, try to preload its media into the CDN cache for future requests
    // but only do this once per NFT
    if (nft && retryCount === 0) {
      preloadNftMedia(nft);
    }
    
    // Special handling for Arweave URLs - using proper URL validation
    if (src && isArweaveUrl(src) && retryCount < 1) {
      try {
        // Safe extraction of transaction ID
        const arweaveTxId = src.startsWith('ar://') 
          ? src.substring(5).split('/')[0].split('.')[0]  // Safe string operations on protocol
          : new URL(src).pathname.substring(1).split('/')[0]; // Safe URL parsing
        
        if (arweaveTxId) {
          const directArweaveUrl = `https://arweave.net/${arweaveTxId}`;
          setImgSrc(directArweaveUrl);
          setRetryCount(retryCount + 1);
          return;
        }
      } catch (err) {
        // Silent failure, just continue to fallback
      }
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
    
    // Disabled gateway cycling for now to ensure fallback image works reliably
    /* 
    // Try next IPFS gateway (disabled)
    const nextGateway = getNextIPFSUrl(imgSrc, currentGatewayIndex);
    if (nextGateway) {
      setImgSrc(nextGateway.url);
      setCurrentGatewayIndex(nextGateway.nextIndex);
      setRetryCount(prev => prev + 1);
    }
    */
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
        onLoad={() => setImgLoading(false)}
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