import { useState, useEffect, useRef } from 'react';
import { processMediaUrl, IPFS_GATEWAYS, isAudioUrlUsedAsImage, getCleanIPFSUrl, processArweaveUrl, getMediaKey, buildArweaveImageFallbackUrls, buildIpfsFallbackUrls, buildHttpCdnImageFallbackUrls, extractIPFSPath, getNftMediaUrl, toIpfsGatewayUrl, clearNftMediaUrlCache, pickImageCandidates, shouldProbeIpfsDirectory } from '../../utils/media';
import { getCardThumbUrl, getCardThumbAlternates, shouldPreserveAnimation, isBrowserFriendlyCdnUrl, isArweaveMediaUrl, isIpfsMediaUrl, isVideoMediaUrl, isLikelyTokenVideoCoverUrl, getVideoCoverStillUrl } from '../../utils/imageOptimizer';
import Image from 'next/image';
import type { SyntheticEvent } from 'react';
import type { NFT } from '../../types/user';
import { markNftMediaDead } from '../../utils/deadNftRegistry';
import { rememberWorkingMediaUrl, forgetMediaUrl, getRememberedMediaUrl } from '../../utils/gatewayMemory';
import { enrichNftMediaFromChain, nftNeedsChainMediaEnrich } from '../../lib/nft';

const IMG_LOG = true; // flip off when done debugging broken NFT thumbs

/** Alchemy CDN hashes with no extension that decoded as video (Food / Conflicted). */
const alchemyCdnAsVideoCover = new Set<string>();

const shortUrl = (url?: string | null, max = 120): string => {
  if (!url) return '(empty)';
  return url.length <= max ? url : `${url.slice(0, max)}…`;
};

const nftImgLog = (
  stage: string,
  nft: NFT | undefined,
  details: Record<string, unknown> = {}
) => {
  if (!IMG_LOG) return;
  console.log(`[NFT-IMG] ${stage}`, {
    name: nft?.name || '(no nft)',
    id: nft ? `${nft.contract?.slice(0, 10)}…/${nft.tokenId}` : undefined,
    ...details,
  });
};

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
      console.warn('[NFT-IMG] Invalid URL in Arweave check', shortUrl(url));
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
      console.warn('[NFT-IMG] Invalid URL in IPFS check', shortUrl(url));
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
    console.warn('[NFT-IMG] All IPFS gateways exhausted', shortUrl(url));
    return null;
  }

  const path = extractIPFSPath(url);
  if (!path) {
    console.warn('[NFT-IMG] Could not extract IPFS path', shortUrl(url));
    return null;
  }

  const nextIndex = currentIndex + 1;
  return {
    url: toIpfsGatewayUrl(path, IPFS_GATEWAYS[nextIndex]),
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
  const originalUrlRef = useRef<string>(initialSrc);
  const arweaveFallbackUrls = useRef<string[]>([]);
  const arweaveFallbackIndex = useRef(0);
  const ipfsFallbackUrls = useRef<string[]>([]);
  const ipfsFallbackIndex = useRef(0);
  const httpCdnFallbackUrls = useRef<string[]>([]);
  const httpCdnFallbackIndex = useRef(0);
  const imageCandidates = useRef<string[]>([]);
  const imageCandidateIndex = useRef(0);
  /** Last URL that decoded with naturalWidth>0 — avoid hang-timer thrash on re-resolve. */
  const loadedOkSrcRef = useRef<string | null>(null);
  const attemptedFallbacks = useRef<Record<string, boolean>>({});
  const alchemyEnrichAttemptedRef = useRef(false);
  const alchemyEnrichInFlightRef = useRef(false);
  const alchemyAsVideoTriedRef = useRef(false);
  /** True when an image error was deferred until Alchemy enrich finishes. */
  const pendingEnrichResumeRef = useRef(false);
  const nftContract = nft?.contract;
  const nftTokenId = nft?.tokenId;
  const nftImage = nft?.image;
  const nftMetadataImage = nft?.metadata?.image;
  const useCardThumb = width < 400 && height < 400;

  const toDisplaySrc = (url: string) => {
    originalUrlRef.current = url;
    if (!url || url === fallbackSrc || url.startsWith('/') || url.startsWith('data:')) {
      return url;
    }
    // Never send GIFs through the static WebP proxy — it freezes animation
    // and large Pinata GIFs often never finish loading.
    // Check prop/nft sources too: turbo /raw/ rewrites strip the .gif extension.
    if (
      shouldPreserveAnimation(url) ||
      shouldPreserveAnimation(src) ||
      shouldPreserveAnimation(nft?.image || '') ||
      shouldPreserveAnimation(nft?.metadata?.image || '')
    ) {
      nftImgLog('display:preserve-animation', nft, { url: shortUrl(url) });
      return url;
    }
    // Card thumbs: never start with raw <video> (iOS blank first frame).
    // Alchemy peer for video NFTs is usually the mp4 hash — use video/fetch still,
    // NOT thumbnailv2 (400 on video hashes, Coinage Subscriber).
    if (useCardThumb && (isVideoMediaUrl(url) || isLikelyTokenVideoCoverUrl(url))) {
      const size = Math.max(width * 2, 360);
      const alchemyPeer = [
        nft?.audio,
        nft?.metadata?.animation_url,
        nft?.animationUrl,
        nft?.videoUrl,
        nft?.image,
        nft?.metadata?.image,
      ].find((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(u)) as string | undefined;
      const still =
        getVideoCoverStillUrl(alchemyPeer || '', size, { assumeVideo: true }) ||
        getVideoCoverStillUrl(url, size) ||
        getCardThumbUrl(url, size);
      nftImgLog('display:card-video-still', nft, {
        original: shortUrl(url),
        alchemyPeer: shortUrl(alchemyPeer),
        display: shortUrl(still),
      });
      return still;
    }
    // Detail / non-card: play MP4 covers natively (Nifty Island, etc.).
    if (isVideoMediaUrl(url) || isLikelyTokenVideoCoverUrl(url)) {
      nftImgLog('display:direct-video-cover', nft, { url: shortUrl(url) });
      return url;
    }
    // Profile/grid cards must not decode full-res Alchemy stills (8k–14k OOMs ~90 NFT profiles).
    if (useCardThumb) {
      const proxied = getCardThumbUrl(url, Math.max(width * 2, 360));
      nftImgLog('display:card-thumb', nft, {
        original: shortUrl(url),
        display: shortUrl(proxied),
        proxied: proxied !== url,
      });
      return proxied;
    }
    if (isBrowserFriendlyCdnUrl(url)) {
      nftImgLog('display:direct-cdn', nft, { url: shortUrl(url) });
      return url;
    }
    if (isArweaveMediaUrl(url)) {
      nftImgLog('display:direct-arweave', nft, { url: shortUrl(url) });
      return url;
    }
    if (isIpfsMediaUrl(url)) {
      nftImgLog('display:direct-ipfs', nft, { url: shortUrl(url) });
      return url;
    }
    nftImgLog('display:full-size', nft, { url: shortUrl(url) });
    return url;
  };
  
  useEffect(() => {
    // Prefer a usable cover from the NFT object when the prop src is empty
    // (stale owned-NFT caches briefly had blank image fields).
    const derivedSrc =
      (src && src !== '' && src !== 'undefined' && src !== 'null' && src) ||
      nft?.image ||
      nft?.metadata?.image ||
      nft?.collection?.image ||
      nft?.metadata?.animation_url ||
      nft?.videoUrl ||
      '';
    const isValidSrc = Boolean(derivedSrc);

    // Resolve the URL we would display *before* resetting loading — if it already
    // decoded successfully, a re-resolve (e.g. metadataImage filling in) must NOT
    // set imgLoading=true. Same src won't re-fire onLoad → false arweave hang hops.
    let nextDisplayUrl = '';
    if (isValidSrc && nft) {
      nextDisplayUrl = toDisplaySrc(getNftMediaUrl({ ...nft, image: derivedSrc || nft.image }, 'image'));
    } else if (isValidSrc) {
      nextDisplayUrl = toDisplaySrc(processMediaUrl(derivedSrc, fallbackSrc, 'image'));
    }

    const alreadyLoaded =
      !!nextDisplayUrl &&
      !!loadedOkSrcRef.current &&
      (loadedOkSrcRef.current === nextDisplayUrl ||
        loadedOkSrcRef.current === originalUrlRef.current ||
        loadedOkSrcRef.current.replace(/\/+$/, '') === nextDisplayUrl.replace(/\/+$/, ''));

    if (!alreadyLoaded) {
      arweaveFallbackUrls.current = [];
      arweaveFallbackIndex.current = 0;
      ipfsFallbackUrls.current = [];
      ipfsFallbackIndex.current = 0;
      httpCdnFallbackUrls.current = [];
      httpCdnFallbackIndex.current = 0;
      attemptedFallbacks.current = {};
      loadedOkSrcRef.current = null;
      alchemyEnrichAttemptedRef.current = false;
      alchemyEnrichInFlightRef.current = false;
      alchemyAsVideoTriedRef.current = false;
      pendingEnrichResumeRef.current = false;
    }

    imageCandidates.current = nft ? pickImageCandidates(nft) : [];
    imageCandidateIndex.current = 0;

    nftImgLog('resolve:start', nft, {
      propSrc: shortUrl(src),
      derivedSrc: shortUrl(derivedSrc),
      nftImage: shortUrl(nft?.image),
      metadataImage: shortUrl(nft?.metadata?.image),
      imageCandidates: imageCandidates.current.map((u) => shortUrl(u)),
      remembered: nft ? shortUrl(getRememberedMediaUrl(getMediaKey(nft), 'image')) : undefined,
      alreadyLoaded,
      width,
      height,
      useCardThumb,
    });
    
    if (isValidSrc) {
      // Check if we've already processed this URL
      const cacheKey = nft ? `${nft.contract}-${nft.tokenId}` : derivedSrc;
      const cached = processedUrlCache.current[cacheKey];
      const effectiveSrc = derivedSrc;
      const isFragileUrl = (url?: string | null) =>
        !!url &&
        (/\/ipfs\//i.test(url) || url.startsWith('ipfs://') || /\.ipfs\./i.test(url));
      const isCollectionOpenSea = (url?: string | null) =>
        !!url && /i2c\.seadn\.io/i.test(url);
      const isTokenVideoCover = (url?: string | null) =>
        !!url &&
        (isVideoMediaUrl(url) ||
          /niftyisland\.com/i.test(url) ||
          (/raw2?\.seadn\.io/i.test(url) && !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(url)));

      const isAlchemyStillUrl = (url?: string | null) =>
        !!url && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);
      const alchemySrc =
        (effectiveSrc && isAlchemyStillUrl(effectiveSrc) && effectiveSrc) ||
        (nft?.image && isAlchemyStillUrl(nft.image) && nft.image) ||
        '';
      // Token VIDEO cover only from image fields (Nifty / SeaDN mp4). Do NOT pull
      // animation_url when an Alchemy still exists — that stole Base House /
      // Coinbase Pass stills in favor of playback mp4s.
      const tokenVideoSrc =
        (effectiveSrc && isTokenVideoCover(effectiveSrc) && effectiveSrc) ||
        (nft?.image && isTokenVideoCover(nft.image) && nft.image) ||
        (!alchemySrc &&
          nft?.metadata?.animation_url &&
          isTokenVideoCover(nft.metadata.animation_url) &&
          nft.metadata.animation_url) ||
        '';
      const durableSrc =
        tokenVideoSrc ||
        alchemySrc ||
        (effectiveSrc &&
          !isFragileUrl(effectiveSrc) &&
          /seadn\.io|openseauserdata\.com|i2c\.seadn|cloudinary\.com|niftyisland\.com/i.test(
            effectiveSrc
          ) &&
          effectiveSrc) ||
        (nft?.image &&
          !isFragileUrl(nft.image) &&
          /seadn\.io|openseauserdata\.com|i2c\.seadn|cloudinary\.com|niftyisland\.com/i.test(
            nft.image
          ) &&
          nft.image) ||
        (nft?.collection?.image && !isFragileUrl(nft.collection.image) && nft.collection.image) ||
        '';

      // Drop stale collection-art cache when we now have a real token video cover.
      if (
        cached &&
        ((isFragileUrl(cached) && durableSrc && !isFragileUrl(durableSrc)) ||
          (isCollectionOpenSea(cached) && tokenVideoSrc))
      ) {
        delete processedUrlCache.current[cacheKey];
        clearNftMediaUrlCache(nft, 'image');
      }

      if (tokenVideoSrc) {
        processedUrlCache.current[cacheKey] = tokenVideoSrc;
        clearNftMediaUrlCache(nft, 'image');
        nftImgLog('resolve:token-video-cover', nft, { mediaUrl: shortUrl(tokenVideoSrc) });
        setImgSrc(toDisplaySrc(tokenVideoSrc));
      } else if (durableSrc && isAlchemyStillUrl(durableSrc)) {
        processedUrlCache.current[cacheKey] = durableSrc;
        clearNftMediaUrlCache(nft, 'image');
        // Previously decoded as video/mp4 — skip broken <img> attempt.
        if (
          /nft2?-cdn\.alchemy\.com/i.test(durableSrc) &&
          alchemyCdnAsVideoCover.has(durableSrc)
        ) {
          setIsVideo(true);
          nftImgLog('resolve:alchemy-cdn-as-video', nft, { mediaUrl: shortUrl(durableSrc) });
        } else {
          setIsVideo(false);
          nftImgLog('resolve:alchemy-cdn', nft, { mediaUrl: shortUrl(durableSrc) });
        }
        setImgSrc(toDisplaySrc(durableSrc));
      } else if (
        processedUrlCache.current[cacheKey] &&
        !isFragileUrl(processedUrlCache.current[cacheKey]) &&
        !(isCollectionOpenSea(processedUrlCache.current[cacheKey]) && tokenVideoSrc)
      ) {
        const hit = processedUrlCache.current[cacheKey];
        nftImgLog('resolve:component-cache-hit', nft, { cached: shortUrl(hit) });
        setImgSrc(toDisplaySrc(hit));
      } else if (durableSrc) {
        processedUrlCache.current[cacheKey] = durableSrc;
        clearNftMediaUrlCache(nft, 'image');
        nftImgLog('resolve:durable-cdn', nft, { mediaUrl: shortUrl(durableSrc) });
        setImgSrc(toDisplaySrc(durableSrc));
      } else if (processedUrlCache.current[cacheKey] && !durableSrc) {
        const hit = processedUrlCache.current[cacheKey];
        nftImgLog('resolve:component-cache-hit', nft, { cached: shortUrl(hit) });
        setImgSrc(toDisplaySrc(hit));
      } else {
        // Use a consistent approach for all URL types
        if (nft) {
          const mediaUrl = getNftMediaUrl(
            { ...nft, image: effectiveSrc || nft.image },
            'image'
          );
          // Avoid locking in dead IPFS as the component cache.
          if (!isFragileUrl(mediaUrl)) {
            processedUrlCache.current[cacheKey] = mediaUrl;
          }
          nftImgLog('resolve:getNftMediaUrl', nft, { mediaUrl: shortUrl(mediaUrl) });
          setImgSrc(toDisplaySrc(mediaUrl));
        } else {
          // Process the URL to handle all special protocols (ar://, ipfs://, etc.)
          // using our improved processMediaUrl function
          const processedSrc = processMediaUrl(effectiveSrc, fallbackSrc, 'image');
          if (!isFragileUrl(processedSrc)) {
            processedUrlCache.current[cacheKey] = processedSrc;
          }
          nftImgLog('resolve:processMediaUrl', undefined, {
            src: shortUrl(effectiveSrc),
            processed: shortUrl(processedSrc),
          });
          setImgSrc(toDisplaySrc(processedSrc));
        }
      }
      
      setError(false);
      setRetryCount(0);
      setCurrentGatewayIndex(0);
      setIsLoadingFallback(false);
      setImgLoading(!alreadyLoaded);
    } else {
      // No cover yet — show loading and let Alchemy enrich fill it (don't flash default).
      nftImgLog('resolve:empty-src → enrich', nft, { propSrc: shortUrl(src) });
      setImgLoading(true);
      setError(false);
      setIsLoadingFallback(false);
    }
    
    // Use our secure isMediaUrl function for all media detection
    const { isAudio, isVideo } = isMediaUrl(derivedSrc || src);
    
    // If this is a video URL, set the video flag
    if (isVideo) {
      setIsVideo(true);
    }

    setError(false);
    setRetryCount(0);

    // Prefer Alchemy static thumb when cover is video / dead IPFS / SeaDN —
    // don't wait for load failure (Nifty Island mp4 covers, etc.).
    // Also enrich when src was empty so we can recover covers.
    if (
      nft &&
      !alreadyLoaded &&
      !alchemyEnrichAttemptedRef.current &&
      (nftNeedsChainMediaEnrich(nft) || !isValidSrc)
    ) {
      alchemyEnrichAttemptedRef.current = true;
      alchemyEnrichInFlightRef.current = true;
      nftImgLog('resolve:proactive-alchemy-enrich', nft, {
        image: shortUrl(nft.image),
      });
      void enrichNftMediaFromChain(nft)
        .then((enriched) => {
          const current = originalUrlRef.current || imgSrc || nft.image || '';
          const isFragileCover = (url?: string | null) =>
            !url ||
            /\/ipfs\//i.test(url) ||
            url.startsWith('ipfs://') ||
            /\.ipfs\./i.test(url);

          const pickCover = (url?: string | null): string => {
            if (!url || typeof url !== 'string') return '';
            if (url === fallbackSrc) return '';
            if (isFragileCover(url)) return '';
            if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(url)) return '';
            return url;
          };

          const currentIsTokenVideo =
            isVideoMediaUrl(current) &&
            !isFragileCover(current) &&
            !/seadn\.io|i2c\.seadn|openseauserdata\.com/i.test(current);

          const alchemyImg = pickCover(
            enriched.image && /nft2?-cdn\.alchemy\.com/i.test(enriched.image)
              ? enriched.image
              : ''
          );
          const enrichedStill = pickCover(enriched.image);
          // Collection / OpenSea art — always eligible when token image is dead IPFS.
          const collectionStill = pickCover(enriched.collection?.image);

          // Prefer Alchemy CDN → enriched non-IPFS → collection. If we already have a
          // working token-specific video (Nifty Island), don't replace with collection.
          let next = alchemyImg || enrichedStill || '';
          if ((!next || isFragileCover(next)) && collectionStill) {
            if (!currentIsTokenVideo || isFragileCover(current)) {
              next = collectionStill;
            }
          }
          // Video file as cover when that's all Alchemy has.
          if (!next) {
            const videoCover =
              [enriched.image, enriched.metadata?.animation_url, enriched.videoUrl, enriched.audio]
                .map(pickCover)
                .find((u) => u && (isVideoMediaUrl(u) || /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u)));
            if (videoCover) next = videoCover;
          }

          // COVER ONLY — never replace metadata.animation_url / audio (breaks play).
          Object.assign(nft, {
            image: next || enriched.image || nft.image,
            metadata: {
              ...nft.metadata,
              image: next || enriched.image || nft.metadata?.image,
            },
            collection: {
              ...nft.collection,
              ...enriched.collection,
              image: enriched.collection?.image || nft.collection?.image,
            },
          });
          clearNftMediaUrlCache(nft, 'image');
          imageCandidates.current = pickImageCandidates(nft);
          imageCandidateIndex.current = 0;

          if (!next) {
            nftImgLog('resolve:proactive-alchemy-no-cover', nft, {
              enrichedImage: shortUrl(enriched.image),
              collection: shortUrl(enriched.collection?.image),
            });
            return false;
          }
          if (next === current && !isFragileCover(current)) {
            return Boolean(loadedOkSrcRef.current);
          }
          if (attemptedFallbacks.current[`${next}-alchemy`] && !isFragileCover(current)) {
            return Boolean(loadedOkSrcRef.current);
          }

          const cacheKey = `${nft.contract}-${nft.tokenId}`;
          processedUrlCache.current[cacheKey] = next;
          attemptedFallbacks.current[`${next}-alchemy`] = true;
          originalUrlRef.current = next;
          setImgSrc(toDisplaySrc(next));
          setImgLoading(true);
          setError(false);
          setIsLoadingFallback(false);
          nftImgLog('resolve:proactive-alchemy-using', nft, { next: shortUrl(next) });
          return true;
        })
        .then((applied) => {
          alchemyEnrichInFlightRef.current = false;
          if (!pendingEnrichResumeRef.current) return;
          pendingEnrichResumeRef.current = false;
          // Enrich applied a new URL — let onLoad/onError drive the rest.
          if (applied || loadedOkSrcRef.current) return;
          const coll = nft.collection?.image;
          if (
            coll &&
            !/\/ipfs\//i.test(coll) &&
            !/\.(mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|#|$)/i.test(coll) &&
            !attemptedFallbacks.current[`${coll}-collection`]
          ) {
            attemptedFallbacks.current[`${coll}-collection`] = true;
            nftImgLog('retry:collection-image-after-enrich', nft, { next: shortUrl(coll) });
            originalUrlRef.current = coll;
            setImgSrc(toDisplaySrc(coll));
            setImgLoading(true);
            setError(false);
            setIsLoadingFallback(false);
            return;
          }
          nftImgLog('give-up → default-nft.png', nft, { after: 'alchemy-enrich' });
          if (nft) markNftMediaDead(nft, 'image');
          setError(true);
          setIsLoadingFallback(true);
          setImgSrc(fallbackSrc);
        })
        .catch(() => {
          alchemyEnrichInFlightRef.current = false;
        });
    }

    // Always use the NFT's image as thumbnail, regardless of content type
    if (nft?.metadata?.image || nft?.image) {
      setIsVideo(false);
      const thumbnailUrl = nft.metadata?.image || nft.image;
      
      // Check if image URL matches any audio URL
      if (nft && isAudioUrlUsedAsImage(nft, thumbnailUrl)) {
        nftImgLog('resolve:BLOCKED audio-url-as-image', nft, {
          thumbnailUrl: shortUrl(thumbnailUrl),
          audio: shortUrl(nft.audio),
          animation_url: shortUrl(nft.metadata?.animation_url),
        });
        setImgSrc(fallbackSrc);
        return;
      }
      
      if (nft) {
        const mediaUrl = getNftMediaUrl(nft, 'image');
        // Prefer token video cover over getNftMediaUrl when it still returns collection art.
        const prefer =
          (isVideoMediaUrl(thumbnailUrl) || /niftyisland\.com/i.test(thumbnailUrl)
            ? thumbnailUrl
            : '') || mediaUrl;
        nftImgLog('resolve:thumbnail-path', nft, {
          thumbnailUrl: shortUrl(thumbnailUrl),
          mediaUrl: shortUrl(mediaUrl),
          using: shortUrl(prefer),
        });
        if (nft.contract && nft.tokenId && prefer) {
          const cacheKey = `${nft.contract}-${nft.tokenId}`;
          if (isVideoMediaUrl(prefer) || /niftyisland\.com/i.test(prefer)) {
            processedUrlCache.current[cacheKey] = prefer;
          }
        }
        setImgSrc(toDisplaySrc(prefer));
      } else {
        setImgSrc(toDisplaySrc(processMediaUrl(thumbnailUrl, fallbackSrc, 'image')));
      }
      if (alreadyLoaded) setImgLoading(false);
      return;
    }

    // For NFTs with image
    if (src) {
      // Check if image URL matches any audio URL
      if (nft && isAudioUrlUsedAsImage(nft, src)) {
        setIsVideo(false);
        setImgSrc(fallbackSrc);
        nftImgLog('resolve:BLOCKED audio-url-as-image (src)', nft, {
          src: shortUrl(src),
          audio: shortUrl(nft.audio),
        });
        return;
      }
      
      setIsVideo(false);
      // Clean and process the URL - handle all special URL types including ar:// and ipfs://
      if (nft) {
        setImgSrc(toDisplaySrc(getNftMediaUrl(nft, 'image')));
      } else if (isArweaveUrl(src) || isIpfsUrl(src)) {
        // Safely process special URL protocols
        const cleanedUrl = isArweaveUrl(src) ? processArweaveUrl(src) : getCleanIPFSUrl(src);
        setImgSrc(toDisplaySrc(processMediaUrl(cleanedUrl, fallbackSrc, 'image')));
      } else {
        setImgSrc(toDisplaySrc(processMediaUrl(src, fallbackSrc, 'image')));
      }
      if (alreadyLoaded) setImgLoading(false);
    }
    // Fallback
    else {
      setIsVideo(false);
      nftImgLog('resolve:no-image → default', nft);
      setImgSrc(fallbackSrc);
    }
  }, [src, nftContract, nftTokenId, nftImage, nftMetadataImage, width, height]);

  // If the thumb proxy hangs, fall back. Arweave gets a long window — large
  // PNGs (e.g. 7MB) need more than a few seconds and must not thrash gateways.
  useEffect(() => {
    const isProxy =
      imgSrc.includes('wsrv.nl') ||
      imgSrc.includes('images.weserv.nl') ||
      imgSrc.includes('img-width=');
    const isAlchemySizedThumb =
      /res\.cloudinary\.com\/alchemyapi\/(?:image\/upload|video\/fetch)\/w_\d+/i.test(
        imgSrc
      );
    const isCardHangCandidate = useCardThumb && (isProxy || isAlchemySizedThumb);
    const isArweaveHangCandidate =
      isArweaveMediaUrl(imgSrc) || isArweaveUrl(imgSrc) || isArweaveUrl(src);
    if (
      !imgLoading ||
      (!isProxy && !isCardHangCandidate && !isArweaveHangCandidate) ||
      !originalUrlRef.current
    ) {
      return;
    }
    // Card/proxy: 8s (Alchemy thumbs under burst). Arweave: 20s.
    const waitMs = isArweaveHangCandidate && !isCardHangCandidate ? 20000 : 8000;
    const timeout = window.setTimeout(() => {
      // Re-resolve often sets imgLoading=true for the same URL; onLoad won't
      // re-fire, so this timer must not thrash a URL that already decoded.
      if (
        loadedOkSrcRef.current &&
        (loadedOkSrcRef.current === imgSrc ||
          loadedOkSrcRef.current === originalUrlRef.current ||
          loadedOkSrcRef.current.replace(/\/+$/, '') === (imgSrc || '').replace(/\/+$/, ''))
      ) {
        nftImgLog('timeout:hang — ignore, already decoded', nft, {
          hung: shortUrl(imgSrc),
          loadedOk: shortUrl(loadedOkSrcRef.current),
        });
        setImgLoading(false);
        return;
      }

      if (nft) {
        const key = getMediaKey(nft);
        forgetMediaUrl(key, 'image');
        clearNftMediaUrlCache(nft, 'image');
        delete processedUrlCache.current[`${nft.contract}-${nft.tokenId}`];
      }

      const raw = nft?.image || nft?.metadata?.image || src;
      const fresh = nft
        ? getNftMediaUrl(nft, 'image')
        : processMediaUrl(raw, fallbackSrc, 'image');

      let next = fresh && fresh !== imgSrc ? fresh : originalUrlRef.current;
      let skipToDisplay = false;

      if (useCardThumb && originalUrlRef.current) {
        // Hang hops skip video/fetch for stills (400 spam). Hard errors try it.
        const size = Math.max(width * 2, 360);
        attemptedFallbacks.current[`${imgSrc}-hang`] = true;
        const hungIsVideo =
          /video\/fetch/i.test(imgSrc) ||
          /video\/fetch/i.test(originalUrlRef.current) ||
          isLikelyTokenVideoCoverUrl(originalUrlRef.current) ||
          isVideoMediaUrl(originalUrlRef.current);
        const alchemyCdnPeer = [
          nft?.audio,
          nft?.metadata?.animation_url,
          nft?.animationUrl,
          nft?.videoUrl,
          nft?.image,
          nft?.metadata?.image,
        ].find((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(u)) as string | undefined;
        const alt = getCardThumbAlternates(originalUrlRef.current, size, {
          includeVideoStill: hungIsVideo,
          alchemyCdnPeer,
        }).find(
          (u) => u !== imgSrc && !attemptedFallbacks.current[`${u}-hang`]
        );
        if (alt) {
          next = alt;
          attemptedFallbacks.current[`${alt}-hang`] = true;
          skipToDisplay = true;
        } else {
          nftImgLog('timeout:card-hang — keeping current (no more sized alts)', nft, {
            hung: shortUrl(imgSrc),
          });
          setImgLoading(false);
          return;
        }
      } else if (isArweaveUrl(raw) || isArweaveMediaUrl(raw) || isArweaveMediaUrl(imgSrc)) {
        if (arweaveFallbackUrls.current.length === 0) {
          arweaveFallbackUrls.current = buildArweaveImageFallbackUrls(raw || next).slice(0, 3);
          arweaveFallbackIndex.current = 0;
        }
        while (
          arweaveFallbackIndex.current < arweaveFallbackUrls.current.length &&
          (arweaveFallbackUrls.current[arweaveFallbackIndex.current] === imgSrc ||
            arweaveFallbackUrls.current[arweaveFallbackIndex.current] ===
              originalUrlRef.current ||
            attemptedFallbacks.current[
              `${arweaveFallbackUrls.current[arweaveFallbackIndex.current]}-hang`
            ])
        ) {
          arweaveFallbackIndex.current += 1;
        }
        if (arweaveFallbackIndex.current < arweaveFallbackUrls.current.length) {
          next = arweaveFallbackUrls.current[arweaveFallbackIndex.current];
          attemptedFallbacks.current[`${next}-hang`] = true;
          arweaveFallbackIndex.current += 1;
        } else {
          // Exhausted short list — keep waiting on current URL rather than
          // marking a valid large image dead.
          nftImgLog('timeout:arweave-hang — keeping current (no more hops)', nft, {
            hung: shortUrl(imgSrc),
          });
          setImgLoading(false);
          return;
        }
      } else if (isProxy && originalUrlRef.current && originalUrlRef.current !== imgSrc) {
        next = originalUrlRef.current;
      }

      if (!next || next === imgSrc) {
        nftImgLog('timeout:hang — no alternate URL', nft, {
          hung: shortUrl(imgSrc),
        });
        return;
      }

      nftImgLog(
        useCardThumb
          ? 'timeout:card-hang → sized-alt'
          : isProxy
            ? 'timeout:proxy-hang → fallback'
            : 'timeout:arweave-hang → fallback',
        nft,
        {
          hung: shortUrl(imgSrc),
          next: shortUrl(next),
          fresh: shortUrl(fresh),
        }
      );
      setImgSrc(skipToDisplay ? next : toDisplaySrc(next));
      setError(false);
      setIsLoadingFallback(false);
      setImgLoading(true);
    }, waitMs);
    return () => window.clearTimeout(timeout);
  }, [imgSrc, imgLoading, useCardThumb, width, height]);

  const handleError = async (error: SyntheticEvent<HTMLVideoElement | HTMLImageElement>) => {
    // Get the current failing URL
    const failedSrc = error.currentTarget.src || imgSrc;
    
    // Skip if we've already tried this fallback strategy
    const fallbackKey = `${failedSrc}-${retryCount}`;
    if (attemptedFallbacks.current[fallbackKey]) {
      nftImgLog('error:duplicate → default', nft, {
        failed: shortUrl(failedSrc),
        retryCount,
      });
      setImgSrc(fallbackSrc);
      return;
    }
    
    nftImgLog('error:load-failed', nft, {
      failed: shortUrl(failedSrc),
      original: shortUrl(originalUrlRef.current),
      propSrc: shortUrl(src),
      retryCount,
      isProxy:
        failedSrc.includes('wsrv.nl') ||
        failedSrc.includes('images.weserv.nl') ||
        failedSrc.includes('img-width='),
      isIpfs: isIpfsUrl(failedSrc),
      isArweave: isArweaveUrl(failedSrc) || isArweaveUrl(src),
      isCdn: isBrowserFriendlyCdnUrl(failedSrc),
    });

    // Pause gateway thrash while Alchemy enrich may still return a real cover
    // (audio NFTs often have dead IPFS in image + usable thumbnail/collection).
    if (alchemyEnrichInFlightRef.current) {
      pendingEnrichResumeRef.current = true;
      nftImgLog('retry:wait-alchemy-enrich', nft, { failed: shortUrl(failedSrc) });
      return;
    }
    
    // Mark this fallback as attempted
    attemptedFallbacks.current[fallbackKey] = true;

    const isThumbProxy =
      failedSrc.includes('wsrv.nl') ||
      failedSrc.includes('images.weserv.nl') ||
      failedSrc.includes('img-width=') ||
      /res\.cloudinary\.com\/alchemyapi\/(?:image\/(?:fetch|upload)|video\/fetch)/i.test(
        failedSrc
      );
    if (isThumbProxy && originalUrlRef.current && originalUrlRef.current !== failedSrc) {
      // Cards must never decode full-res Alchemy/CDN stills (14k images OOM the tab).
      if (useCardThumb) {
        const size = Math.max(width * 2, 360);
        attemptedFallbacks.current[`${failedSrc}-card`] = true;
        const alchemyCdnPeer = [
          nft?.audio,
          nft?.metadata?.animation_url,
          nft?.animationUrl,
          nft?.videoUrl,
          nft?.image,
          nft?.metadata?.image,
        ].find((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(u)) as string | undefined;
        const orig = originalUrlRef.current;
        const nextAlt = getCardThumbAlternates(orig, size, {
          // video/fetch only when origin is a video cover, already on video/fetch,
          // or Alchemy CDN (thumbnailv2 can 400 on video hashes like Neybors).
          includeVideoStill:
            isLikelyTokenVideoCoverUrl(orig) ||
            isVideoMediaUrl(orig) ||
            /video\/fetch/i.test(failedSrc) ||
            /nft2?-cdn\.alchemy\.com/i.test(orig),
          alchemyCdnPeer,
        }).find(
          (u) => u !== failedSrc && !attemptedFallbacks.current[`${u}-card`]
        );
        if (nextAlt) {
          attemptedFallbacks.current[`${nextAlt}-card`] = true;
          nftImgLog('retry:card-thumb-alt', nft, {
            failed: shortUrl(failedSrc),
            next: shortUrl(nextAlt),
          });
          setImgSrc(nextAlt);
          setError(false);
          setIsLoadingFallback(false);
          return;
        }
        // Stills exhausted — native <video> cover (desktop paints; iOS may still blank).
        if (
          orig &&
          (isLikelyTokenVideoCoverUrl(orig) || isVideoMediaUrl(orig)) &&
          !attemptedFallbacks.current[`${orig}-native-video`]
        ) {
          attemptedFallbacks.current[`${orig}-native-video`] = true;
          nftImgLog('retry:card-thumb → native-video', nft, { next: shortUrl(orig) });
          setIsVideo(true);
          setImgSrc(orig);
          setError(false);
          setIsLoadingFallback(false);
          return;
        }
        nftImgLog('retry:card-thumb-fail → placeholder', nft, {
          failed: shortUrl(failedSrc),
        });
        setImgSrc(fallbackSrc);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      nftImgLog('retry:proxy-fail → original', nft, {
        next: shortUrl(originalUrlRef.current),
      });
      setImgSrc(originalUrlRef.current);
      setError(false);
      setIsLoadingFallback(false);
      return;
    }

    // The gateway we remembered as "working" just failed — stop recommending it.
    if (nft) {
      const mediaKeyForMemory = getMediaKey(nft);
      if (failedSrc === getRememberedMediaUrl(mediaKeyForMemory, 'image')) {
        nftImgLog('memory:forget-dead-gateway', nft, { failed: shortUrl(failedSrc) });
        forgetMediaUrl(mediaKeyForMemory, 'image');
      }
    }
    
    // Special handling for Arweave / PODs URLs — short image gateway list
    if (src && isArweaveUrl(src)) {
      if (arweaveFallbackUrls.current.length === 0) {
        arweaveFallbackUrls.current = buildArweaveImageFallbackUrls(src);
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
        nftImgLog('retry:arweave-gateway', nft, {
          index: arweaveFallbackIndex.current,
          next: shortUrl(nextUrl),
        });
        setImgSrc(toDisplaySrc(nextUrl));
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      nftImgLog('retry:arweave-exhausted', nft, {
        tried: arweaveFallbackUrls.current.length,
      });
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
        nftImgLog('retry:ipfs-gateway', nft, {
          index: ipfsFallbackIndex.current,
          next: shortUrl(nextUrl),
        });
        setImgSrc(toDisplaySrc(nextUrl));
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      nftImgLog('retry:ipfs-exhausted', nft, {
        tried: ipfsFallbackUrls.current.length,
      });
    }

    // OpenSea / generic HTTP CDN — try alternate widths / strip query params
    const httpSource = src || failedSrc || originalUrlRef.current;
    if (
      httpSource &&
      (httpSource.startsWith('http://') || httpSource.startsWith('https://')) &&
      !isIpfsUrl(httpSource) &&
      !isArweaveUrl(httpSource)
    ) {
      if (httpCdnFallbackUrls.current.length === 0) {
        httpCdnFallbackUrls.current = buildHttpCdnImageFallbackUrls(httpSource, {
          contract: nft?.contract,
          network: nft?.network,
        });
        httpCdnFallbackIndex.current = 0;
      }
      while (
        httpCdnFallbackIndex.current < httpCdnFallbackUrls.current.length &&
        (httpCdnFallbackUrls.current[httpCdnFallbackIndex.current] === failedSrc ||
          attemptedFallbacks.current[`${httpCdnFallbackUrls.current[httpCdnFallbackIndex.current]}-cdn`])
      ) {
        httpCdnFallbackIndex.current += 1;
      }
      if (httpCdnFallbackIndex.current < httpCdnFallbackUrls.current.length) {
        const nextUrl = httpCdnFallbackUrls.current[httpCdnFallbackIndex.current];
        attemptedFallbacks.current[`${nextUrl}-cdn`] = true;
        httpCdnFallbackIndex.current += 1;
        nftImgLog('retry:http-cdn', nft, {
          index: httpCdnFallbackIndex.current,
          next: shortUrl(nextUrl),
        });
        originalUrlRef.current = nextUrl;
        // Keep card thumbs sized — never set raw Alchemy CDN on grid cards.
        setImgSrc(toDisplaySrc(nextUrl));
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }

    // Same asset failed across gateways — try the next metadata image field
    // (image_url, properties.files, collection image, etc.).
    if (nft && imageCandidates.current.length > 0) {
      while (imageCandidateIndex.current < imageCandidates.current.length - 1) {
        imageCandidateIndex.current += 1;
        const nextRaw = imageCandidates.current[imageCandidateIndex.current];
        if (!nextRaw || attemptedFallbacks.current[`${nextRaw}-candidate`]) continue;
        attemptedFallbacks.current[`${nextRaw}-candidate`] = true;

        const nextProcessed = processMediaUrl(nextRaw, fallbackSrc, 'image');
        if (!nextProcessed || nextProcessed === fallbackSrc || nextProcessed === failedSrc) {
          continue;
        }

        // Reset per-asset gateway lists for the new candidate.
        arweaveFallbackUrls.current = [];
        arweaveFallbackIndex.current = 0;
        ipfsFallbackUrls.current = isIpfsUrl(nextRaw) || !!extractIPFSPath(nextRaw)
          ? buildIpfsFallbackUrls(nextRaw)
          : [];
        ipfsFallbackIndex.current = 0;
        if (isArweaveUrl(nextRaw)) {
          arweaveFallbackUrls.current = buildArweaveImageFallbackUrls(nextRaw);
        }

        nftImgLog('retry:next-image-candidate', nft, {
          index: imageCandidateIndex.current,
          next: shortUrl(nextProcessed),
          raw: shortUrl(nextRaw),
        });
        originalUrlRef.current = nextProcessed;
        setImgSrc(toDisplaySrc(nextProcessed));
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }
    
    // Alchemy CDN "image" hashes are often video/mp4 (Food / Conflicted). Try
    // <video> with the same URL before SeaDN enrich — keeps unique per-token covers.
    const alchemyCdnFailed = /nft2?-cdn\.alchemy\.com/i.test(failedSrc);
    if (alchemyCdnFailed && isVideo && alchemyAsVideoTriedRef.current) {
      // Same hash failed as <video> too (unlikely) — clear and fall through to enrich.
      alchemyCdnAsVideoCover.delete(failedSrc);
      setIsVideo(false);
    }
    if (alchemyCdnFailed && !alchemyAsVideoTriedRef.current && !isVideo) {
      alchemyAsVideoTriedRef.current = true;
      alchemyCdnAsVideoCover.add(failedSrc);
      nftImgLog('retry:alchemy-cdn-as-video', nft, { failed: shortUrl(failedSrc) });
      setIsVideo(true);
      originalUrlRef.current = failedSrc;
      setImgSrc(failedSrc);
      setRetryCount((c) => c + 1);
      setError(false);
      setIsLoadingFallback(false);
      setImgLoading(true);
      return;
    }

    // Public IPFS unreplicated — Alchemy CDN / OpenSea / collection often still has a cover.
    // Also re-enrich when an Alchemy CDN "image" fails (often the audio hash).
    if (
      nft &&
      !alchemyEnrichAttemptedRef.current &&
      (nftNeedsChainMediaEnrich(nft) || alchemyCdnFailed)
    ) {
      alchemyEnrichAttemptedRef.current = true;
      alchemyEnrichInFlightRef.current = true;
      nftImgLog('retry:alchemy-enrich', nft, { failed: shortUrl(failedSrc) });
      void enrichNftMediaFromChain(nft)
        .then((enriched) => {
          const pickCover = (url?: string | null): string => {
            if (!url || typeof url !== 'string') return '';
            if (url === failedSrc || url === fallbackSrc) return '';
            if (/\/ipfs\//i.test(url) || url.startsWith('ipfs://') || /\.ipfs\./i.test(url)) {
              return '';
            }
            if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(url)) return '';
            return url;
          };
          // Prefer SeaDN / Nifty token VIDEO covers over another Alchemy CDN hash.
          // Do NOT treat i2c.seadn collection stills as video.
          const isTokenVideoCover = (u: string) =>
            isVideoMediaUrl(u) ||
            /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) ||
            /niftyisland\.com/i.test(u) ||
            (/raw2?\.seadn\.io/i.test(u) &&
              !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(u));
          const videoNext =
            [
              enriched.metadata?.animation_url,
              enriched.animationUrl,
              enriched.videoUrl,
              enriched.image,
            ]
              .map(pickCover)
              .find((u) => u && isTokenVideoCover(u)) || '';
          const stillNext =
            pickCover(
              enriched.image && !/nft2?-cdn\.alchemy\.com/i.test(enriched.image)
                ? enriched.image
                : ''
            ) || pickCover(enriched.collection?.image) || '';
          const next = videoNext || stillNext;

          // COVER ONLY — preserve playback metadata.
          Object.assign(nft, {
            image: next || nft.image,
            metadata: {
              ...nft.metadata,
              image: next || nft.metadata?.image,
            },
            collection: {
              ...nft.collection,
              ...enriched.collection,
              image: enriched.collection?.image || nft.collection?.image,
            },
          });
          clearNftMediaUrlCache(nft, 'image');
          imageCandidates.current = pickImageCandidates(nft);
          imageCandidateIndex.current = 0;

          if (!next || attemptedFallbacks.current[`${next}-alchemy`]) {
            nftImgLog('alchemy-enrich:no-better-image', nft, {
              enrichedImage: shortUrl(enriched.image),
              collection: shortUrl(enriched.collection?.image),
            });
            return false;
          }
          attemptedFallbacks.current[`${next}-alchemy`] = true;
          originalUrlRef.current = next;
          setImgSrc(toDisplaySrc(next));
          setRetryCount((c) => c + 1);
          setError(false);
          setIsLoadingFallback(false);
          nftImgLog('alchemy-enrich:using', nft, { next: shortUrl(next) });
          return true;
        })
        .then((applied) => {
          alchemyEnrichInFlightRef.current = false;
          if (!pendingEnrichResumeRef.current) return;
          pendingEnrichResumeRef.current = false;
          if (applied || loadedOkSrcRef.current) return;
          const coll = nft.collection?.image;
          if (
            coll &&
            !/\/ipfs\//i.test(coll) &&
            !/\.(mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|#|$)/i.test(coll) &&
            !attemptedFallbacks.current[`${coll}-collection`]
          ) {
            attemptedFallbacks.current[`${coll}-collection`] = true;
            nftImgLog('retry:collection-image-after-enrich', nft, { next: shortUrl(coll) });
            originalUrlRef.current = coll;
            setImgSrc(toDisplaySrc(coll));
            setError(false);
            setIsLoadingFallback(false);
            return;
          }
          nftImgLog('give-up → default-nft.png', nft, { after: 'alchemy-enrich-retry' });
          markNftMediaDead(nft, 'image');
          setError(true);
          setIsLoadingFallback(true);
          setImgSrc(fallbackSrc);
        })
        .catch(() => {
          alchemyEnrichInFlightRef.current = false;
        });
      return;
    }

    // Still waiting on proactive Alchemy enrich — don't mark dead yet.
    if (alchemyEnrichInFlightRef.current) {
      nftImgLog('retry:wait-alchemy-enrich', nft, { failed: shortUrl(failedSrc) });
      return;
    }

    // Enrich already ran but collection/OpenSea cover may not have been tried yet
    // (common for audio NFTs whose image field is a dead IPFS CID).
    if (nft?.collection?.image) {
      const coll = nft.collection.image;
      if (
        coll !== failedSrc &&
        coll !== fallbackSrc &&
        !/\.(mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|#|$)/i.test(coll) &&
        !/\/ipfs\//i.test(coll) &&
        !attemptedFallbacks.current[`${coll}-collection`]
      ) {
        attemptedFallbacks.current[`${coll}-collection`] = true;
        nftImgLog('retry:collection-image', nft, { next: shortUrl(coll) });
        originalUrlRef.current = coll;
        setImgSrc(toDisplaySrc(coll));
        setRetryCount((c) => c + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }

    // Alchemy CDN "image" hashes are often the audio file — try token video
    // covers (Nifty / raw2 SeaDN / .mp4) before swapping hosts or giving up.
    // Never treat i2c.seadn collection stills as video.
    if (nft && /nft2?-cdn\.alchemy\.com/i.test(failedSrc)) {
      const videoCandidates = [
        nft.metadata?.animation_url,
        nft.animationUrl,
        nft.videoUrl,
        nft.metadata?.image,
        nft.image,
      ].filter((u): u is string => typeof u === 'string' && !!u);
      for (const candidate of videoCandidates) {
        if (
          candidate === failedSrc ||
          candidate === fallbackSrc ||
          attemptedFallbacks.current[`${candidate}-video-cover`]
        ) {
          continue;
        }
        const looksVideo =
          isVideoMediaUrl(candidate) ||
          /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(candidate) ||
          /niftyisland\.com/i.test(candidate) ||
          (/raw2?\.seadn\.io/i.test(candidate) &&
            !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(candidate));
        const looksAudio = /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(candidate);
        if (!looksVideo || looksAudio) continue;
        if (/\/ipfs\//i.test(candidate) || candidate.startsWith('ipfs://')) continue;

        attemptedFallbacks.current[`${candidate}-video-cover`] = true;
        if (nft.contract && nft.tokenId) {
          processedUrlCache.current[`${nft.contract}-${nft.tokenId}`] = candidate;
        }
        nftImgLog('retry:video-cover-after-alchemy', nft, {
          failed: shortUrl(failedSrc),
          next: shortUrl(candidate),
        });
        originalUrlRef.current = candidate;
        setImgSrc(toDisplaySrc(candidate));
        setRetryCount((c) => c + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }

    // nft-cdn vs nft2-cdn — Alchemy sometimes serves on only one hostname.
    if (/nft2?-cdn\.alchemy\.com/i.test(failedSrc)) {
      const swapped = failedSrc.includes('nft2-cdn.alchemy.com')
        ? failedSrc.replace('nft2-cdn.alchemy.com', 'nft-cdn.alchemy.com')
        : failedSrc.replace('nft-cdn.alchemy.com', 'nft2-cdn.alchemy.com');
      if (swapped !== failedSrc && !attemptedFallbacks.current[`${swapped}-alchemy-host`]) {
        attemptedFallbacks.current[`${swapped}-alchemy-host`] = true;
        nftImgLog('retry:alchemy-cdn-host', nft, {
          failed: shortUrl(failedSrc),
          next: shortUrl(swapped),
        });
        originalUrlRef.current = swapped;
        setImgSrc(toDisplaySrc(swapped));
        setRetryCount((c) => c + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
    }

    // Every gateway/fallback has been tried at this point — safe to remember
    // this NFT's image as dead so other views don't retry it needlessly.
    if (nft) {
      nftImgLog('dead:mark-image', nft, { failed: shortUrl(failedSrc) });
      markNftMediaDead(nft, 'image');
    }

    // CRITICAL: Immediately switch to fallback image and force re-render
    nftImgLog('give-up → default-nft.png', nft, { failed: shortUrl(failedSrc) });
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
  const handleLoad = (loadedSrc: string, imgEl?: HTMLImageElement | null) => {
    const width = imgEl?.naturalWidth ?? 0;
    const height = imgEl?.naturalHeight ?? 0;
    // Only reject when nothing decoded. Gateways often resolve directory CIDs
    // (trailing slash) to a real image — naturalWidth>0 means keep it.
    // HTML directory listings typically decode as 0×0.
    if (imgEl && (width === 0 || height === 0)) {
      nftImgLog('success:rejected-non-image', nft, {
        loaded: shortUrl(loadedSrc),
        naturalWidth: width,
        naturalHeight: height,
        looksLikeDir: shouldProbeIpfsDirectory(loadedSrc),
      });
      void handleError({
        currentTarget: imgEl,
      } as SyntheticEvent<HTMLImageElement>);
      return;
    }

    nftImgLog('success:loaded', nft, {
      loaded: shortUrl(loadedSrc),
      naturalWidth: width || undefined,
      naturalHeight: height || undefined,
    });
    if (!loadedSrc || loadedSrc.includes('default-nft.png')) return;
    loadedOkSrcRef.current = loadedSrc;
    if (!nft) return;
    if (loadedSrc.includes('wsrv.nl') || loadedSrc.includes('images.weserv.nl') || loadedSrc.includes('img-width=')) {
      return;
    }
    rememberWorkingMediaUrl(getMediaKey(nft), 'image', loadedSrc);
  };

  // SECURITY: Use proper URL validation for determining render method
  // Use regular img tag for IPFS/Arweave/CDN content to bypass Next.js image optimization
  const isSpecialProtocol = isIpfsUrl(imgSrc) || isArweaveUrl(imgSrc) ||
    imgSrc.includes('wsrv.nl') || imgSrc.includes('images.weserv.nl') || imgSrc.includes('img-width=') ||
    /amazonaws\.com|cloudfront\.net/i.test(imgSrc) ||
    isBrowserFriendlyCdnUrl(imgSrc);
  
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
  const isAnimated = shouldPreserveAnimation(finalSrc) || shouldPreserveAnimation(src);
  // Only treat as <video> when the *display* URL is still a video file.
  // Cards rewrite SeaDN/Nifty mp4 → Alchemy PNG still; don't keep isVideo/src forcing <video>
  // (iOS leaves preload=metadata blank — Coinage Subscriber, etc.).
  const isVideoCover =
    !error &&
    !isLoadingFallback &&
    (isVideoMediaUrl(finalSrc) ||
      isLikelyTokenVideoCoverUrl(finalSrc) ||
      alchemyCdnAsVideoCover.has(finalSrc) ||
      (!useCardThumb &&
        (isVideo ||
          isVideoMediaUrl(src) ||
          alchemyCdnAsVideoCover.has(originalUrlRef.current || ''))));
  const useNativeImg =
    isArweave ||
    isAnimated ||
    isBrowserFriendlyCdnUrl(finalSrc) ||
    isSpecialProtocol ||
    isVideoCover;

  // Video file used as card cover — <img>/Next Image cannot decode MP4.
  if (isVideoCover && !error && !isLoadingFallback && validateSrc(finalSrc)) {
    return (
      <video
        src={finalSrc}
        className={className}
        width={width || 300}
        height={height || 300}
        muted
        playsInline
        preload="metadata"
        loop
        autoPlay={false}
        onError={handleError as unknown as (e: SyntheticEvent<HTMLVideoElement>) => void}
        onLoadedData={(e) => {
          const vid = e.currentTarget;
          setImgLoading(false);
          // <video> uses videoWidth/videoHeight — naturalWidth is always 0.
          if (vid.videoWidth > 0 || vid.readyState >= 2) {
            loadedOkSrcRef.current = finalSrc;
            if (nft) {
              rememberWorkingMediaUrl(getMediaKey(nft), 'image', finalSrc);
            }
            nftImgLog('success:video-cover-loaded', nft, {
              loaded: shortUrl(finalSrc),
              videoWidth: vid.videoWidth,
              videoHeight: vid.videoHeight,
            });
            return;
          }
          handleLoad(finalSrc, null);
        }}
        data-nft-image-status="video-cover"
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        data-original-src={src}
        key={`nft-vid-${nft?.contract || 'unknown'}-${nft?.tokenId || 'unknown'}`}
        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
      />
    );
  }

  // Native <img> for Arweave, GIFs, OpenSea/CDN hosts, and thumb proxies.
  // Next/Image re-encodes GIFs and often fails fetching seadn/cloudinary from the optimizer.
  if (useNativeImg && !isVideo) {
    // Convert ar:// to https://arweave.net/ if needed
    const nativeUrl = finalSrc.startsWith('ar://') 
      ? processArweaveUrl(finalSrc)
      : finalSrc;
      
    return (
      <img
        src={nativeUrl}
        alt={alt}
        className={className}
        width={width || 300}
        height={height || 300}
        onError={handleError}
        onLoad={(e) => {
          setImgLoading(false);
          handleLoad(nativeUrl, e.currentTarget);
        }}
        decoding="async"
        loading={priority ? 'eager' : loading}
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        data-original-src={src}
        key={`nft-img-${nft?.contract || 'unknown'}-${nft?.tokenId || 'unknown'}`}
        style={{ objectFit: 'cover' }}
      />
    );
  }
  
  // For other content types, use Next.js Image
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
        onLoad={(e) => {
          setImgLoading(false);
          handleLoad(finalSrc, e.currentTarget);
        }}
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        key={`nft-img-${nft?.contract || 'unknown'}-${nft?.tokenId || 'unknown'}`}
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
        onLoad={(e) => {
          setImgLoading(false);
          handleLoad(finalSrc, e.currentTarget);
        }}
        decoding="async"
        data-nft-image-status={error ? 'error' : 'loaded'}
        data-nft-id={nft ? `${nft.contract}-${nft.tokenId}` : 'unknown'}
        loading={priority ? 'eager' : loading}
        sizes={sizes}
        key={`nft-img-${nft?.contract || 'unknown'}-${nft?.tokenId || 'unknown'}`}
        style={{ objectFit: 'cover' }}
      />
    </>
  );
};
////