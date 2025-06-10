import { logger } from './logger';
import { NFT } from '../types/user';
import { getMediaKey, processMediaUrl } from './media';
import { v4 as uuidv4 } from 'uuid';

// Create a dedicated CDN logger
export const cdnLogger = logger.getModuleLogger('cdn');

// CDN configuration
export const CDN_CONFIG = {
  // Whether the CDN is enabled
  enabled: true,
  
  // Base CDN URL - using Vercel's built-in CDN 
  baseUrl: '',
  
  // CDN regions for global distribution
  regions: {
    default: 'us-east-1',
    northAmerica: 'us-east-1',
    europe: 'eu-west-1',
    asia: 'ap-southeast-1'
  },
  
  // Cache TTL settings (in seconds)
  cacheTTL: {
    images: 86400 * 7, // 7 days for images
    audio: 86400 * 14, // 14 days for audio
    metadata: 3600 * 6  // 6 hours for metadata
  },
  
  // Fallback options
  fallbacks: {
    image: '/default-nft.png',
    audio: '/default-audio.mp3'
  },
  
  // CDN feature flags
  features: {
    imageOptimization: true,
    audioTranscoding: false,
    geolocationRouting: false,
    cacheWarming: true
  }
};

/**
 * Determines the best CDN region based on user's location
 * Note: This function now returns an empty string as regions are no longer used in the URL
 */
export const getBestCdnRegion = (): string => {
  return ''; // Regions are no longer used in the URL format
};

/**
 * Constructs a CDN URL for the given media URL
 */
export const getCdnUrl = (url: string, type: 'image' | 'audio' | 'metadata' = 'image'): string => {
  if (!url) {
    cdnLogger.warn('Empty URL provided to getCdnUrl, using fallback', { type });
    return type === 'image' ? CDN_CONFIG.fallbacks.image : CDN_CONFIG.fallbacks.audio;
  }
  
  // Don't process URLs that are already using our CDN
  if (url.includes(CDN_CONFIG.baseUrl)) {
    cdnLogger.info('URL already using CDN, returning as-is', { url });
    return url;
  }
  
  try {
    // Create a safe URL path for the CDN
    const encodedUrl = encodeURIComponent(url);
    
    // Updated: Use query parameter format instead of path segments
    // This matches the fix mentioned in the memory about CDN URL format
    const cdnUrl = `${CDN_CONFIG.baseUrl}/api/cdn/${type}?url=${encodedUrl}`;
    
    // Only log in development and not during media playback
    if (process.env.NODE_ENV === 'development') {
      cdnLogger.debug('Generated CDN URL', {
        originalUrl: url,
        cdnUrl,
        type
      });
    }
    
    return cdnUrl;
  } catch (error) {
    cdnLogger.error('Error generating CDN URL', { url, error });
    return url; // Fall back to original URL on error
  }
};

// In-memory cache for NFT CDN URLs to prevent redundant processing
const nftCdnUrlCache: Record<string, Record<string, string>> = {};

/**
 * Gets a CDN URL for an NFT's media (image or audio)
 * Uses mediaKey for consistent caching across identical content
 */
export const getNftCdnUrl = (nft: NFT, mediaType: 'image' | 'audio'): string => {
  if (!nft) {
    // Don't log this warning repeatedly
    return mediaType === 'image' ? CDN_CONFIG.fallbacks.image : CDN_CONFIG.fallbacks.audio;
  }
  
  // Check cache first using contract+tokenId as the key
  const cacheKey = `${nft.contract}-${nft.tokenId}`;
  
  if (nftCdnUrlCache[cacheKey] && nftCdnUrlCache[cacheKey][mediaType]) {
    return nftCdnUrlCache[cacheKey][mediaType];
  }
  
  // Get the mediaKey for consistent caching of identical content
  const mediaKey = getMediaKey(nft);
  
  try {
    // If CDN is not enabled, use the original URL processing
    if (!CDN_CONFIG.enabled || !CDN_CONFIG.baseUrl) {
      if (mediaType === 'image') {
        const url = processMediaUrl(nft.metadata?.image || '', '', 'image');
        return url;
      } else {
        const url = processMediaUrl(nft.metadata?.animation_url || '', '', 'audio');
        return url;
      }
    }
    
    // We already have the mediaKey from above
    
    // Determine the source URL based on media type
    let sourceUrl = '';
    if (mediaType === 'image') {
      sourceUrl = nft.image || nft.metadata?.image || '';
      if (!sourceUrl) return CDN_CONFIG.fallbacks.image;
    } else {
      sourceUrl = nft.audio || nft.metadata?.animation_url || '';
      if (!sourceUrl) return CDN_CONFIG.fallbacks.audio;
    }
    
    // Process the URL first to ensure IPFS gateway conversion
    const processedUrl = processMediaUrl(sourceUrl, '', mediaType);
    
    // If URL processing failed, return the fallback
    if (!processedUrl) {
      return mediaType === 'image' ? CDN_CONFIG.fallbacks.image : CDN_CONFIG.fallbacks.audio;
    }
    
    // Add mediaKey as a query parameter for cache consistency
    const cdnUrl = getCdnUrl(processedUrl, mediaType);
    // Properly append mediaKey as a query parameter, handling existing query parameters
    const separator = cdnUrl.includes('?') ? '&' : '?';
    const result = `${cdnUrl}${separator}mediaKey=${encodeURIComponent(mediaKey)}`;
    
    // Cache the result
    if (!nftCdnUrlCache[cacheKey]) {
      nftCdnUrlCache[cacheKey] = {};
    }
    nftCdnUrlCache[cacheKey][mediaType] = result;
    
    return result;
  } catch (error) {
    cdnLogger.error('Error generating NFT CDN URL', { nft: nft.name, mediaKey, mediaType, error });
    // On error, fall back to the original URL processing
    if (mediaType === 'image') {
      const url = processMediaUrl(nft.metadata?.image || '', '', 'image');
      cdnLogger.info('Falling back to direct image URL after error', { mediaKey, url });
      return url;
    } else {
      const url = processMediaUrl(nft.metadata?.animation_url || '', '', 'audio');
      cdnLogger.info('Falling back to direct audio URL after error', { mediaKey, url });
      return url;
    }
  }
};

/**
 * Preloads important NFT media into the CDN cache
 * Call this function for key NFTs that should be cached proactively
 * This is a no-op if CDN is disabled
 */
export const preloadNftMedia = async (nft: NFT): Promise<void> => {
  // Skip if no NFT or cache warming is disabled
  if (!nft || !CDN_CONFIG.enabled || !CDN_CONFIG.features.cacheWarming) return;
  
  try {
    // Get URLs but don't log errors if they fail
    let imageUrl = '';
    let audioUrl = '';
    
    try {
      imageUrl = getNftCdnUrl(nft, 'image');
    } catch (e) {}
    
    try {
      audioUrl = getNftCdnUrl(nft, 'audio');
    } catch (e) {}
    
    // Only proceed if we have valid URLs
    if (!imageUrl && !audioUrl) return;
    
    // Trigger cache warming by making non-blocking requests
    if (typeof window !== 'undefined') {
      // Image preloading if we have a valid URL
      if (imageUrl) {
        const imgPreload = new Image();
        imgPreload.src = imageUrl;
      }
      
      // Audio preloading if we have a valid URL (using fetch with HEAD request)
      if (audioUrl) {
        fetch(audioUrl, { method: 'HEAD' })
          .catch(() => {
            // Silently fail - this is just cache warming
          });
      }
      
      cdnLogger.info('Preloaded NFT media', { 
        nft: nft.name || 'Unknown', 
        mediaKey: getMediaKey(nft),
        cdnEnabled: CDN_CONFIG.enabled
      });
    }
  } catch (error) {
    // Don't log errors for preloading - it's a non-critical operation
  }
};

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};
