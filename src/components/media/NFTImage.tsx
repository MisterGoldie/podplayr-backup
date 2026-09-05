import { useState, useEffect, useRef } from 'react';
import { processMediaUrl, IPFS_GATEWAYS, isAudioUrlUsedAsImage, getCleanIPFSUrl, processArweaveUrl, getMediaKey, getNftIdentityKey, buildArweaveImageFallbackUrls, buildIpfsFallbackUrls, buildHttpCdnImageFallbackUrls, extractIPFSPath, getNftMediaUrl, toIpfsGatewayUrl, clearNftMediaUrlCache, pickImageCandidates, shouldProbeIpfsDirectory, sanitizeMediaUrl, looksLikeStillImageUrl, isCollectionOpenSeaStillUrl, isFragileSeaDnPosterUrl, nftHasSeaDnVideoAnimation, rememberNftDisplayCover, getRememberedNftDisplayCover } from '../../utils/media';
import { getCardThumbUrl, getCardThumbAlternates, shouldPreserveAnimation, nftHasAnimatedCover, isBrowserFriendlyCdnUrl, isArweaveMediaUrl, isIpfsMediaUrl, isVideoMediaUrl, isLikelyTokenVideoCoverUrl, getVideoCoverStillUrl, alchemyCoverIsPlaybackVideo, parseAlchemyCdnRef, resizeAlchemyCloudinaryThumb } from '../../utils/imageOptimizer';
import { imageDebug, imageDebugUrlKind, logNftCoverDebug } from '../../utils/imageDebug';
import Image from 'next/image';
import type { SyntheticEvent } from 'react';
import type { NFT } from '../../types/user';
import { markNftMediaDead } from '../../utils/deadNftRegistry';
import { rememberWorkingMediaUrl, forgetMediaUrl, getRememberedMediaUrl } from '../../utils/gatewayMemory';
import { enrichNftMediaFromChain, isOnChainNftIdentity, nftNeedsChainMediaEnrich } from '../../lib/nft';

/** Alchemy CDN hashes with no extension that decoded as video (Food / Conflicted). */
const alchemyCdnAsVideoCover = new Set<string>();

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
  } catch {
    return false;
  }
};

/**
 * Safely checks if a URL is an IPFS URL by properly parsing it
 * SECURITY: This function uses URL parsing instead of string inclusion for validation
 */
const isIpfsUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  url = sanitizeMediaUrl(url);
  
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
  } catch {
    return false;
  }
};

/**
 * Get the next IPFS gateway URL for retry attempts (preserves CID/file subpaths).
 */
const getNextIPFSUrl = (url: string, currentIndex: number): { url: string; nextIndex: number } | null => {
  url = getCleanIPFSUrl(url);

  if (currentIndex >= IPFS_GATEWAYS.length - 1) {
    return null;
  }

  const path = extractIPFSPath(url);
  if (!path) {
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
const isLocalPublicPath = (url: string): boolean =>
  url.startsWith('/') && !url.startsWith('//');

const validateUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  url = sanitizeMediaUrl(url);
  
  // Check for empty or placeholder strings
  if (url === '' || url === 'undefined' || url === 'null') return false;

  // Curated covers from /public (e.g. /sazonsfeatured.png)
  if (isLocalPublicPath(url)) return true;
  
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
  const cleanSrc = sanitizeMediaUrl(src);
  // Don't fetch ipfs:// / ar:// on first paint — resolve picks SeaDN/Alchemy
  // first. A doomed gateway 404's onError would clobber that still (Recently Played).
  const protocolSrc = /^(ipfs|ar):\/\//i.test(cleanSrc);
  const initialProcessed =
    cleanSrc && !protocolSrc
      ? processMediaUrl(cleanSrc, fallbackSrc, 'image')
      : fallbackSrc;
  
  // Check if src is valid using proper URL validation
  const initialSrc = !validateUrl(initialProcessed) ? fallbackSrc : initialProcessed;
  const [imgSrc, setImgSrc] = useState<string>(initialSrc);
  const [error, setError] = useState(!validateUrl(initialProcessed));
  const [retryCount, setRetryCount] = useState(0);
  const [currentGatewayIndex, setCurrentGatewayIndex] = useState(0);
  const [isLoadingFallback, setIsLoadingFallback] = useState(!validateUrl(initialProcessed));
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
  const imgSrcRef = useRef<string>(initialSrc);
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

  // Reset enrich state only when the token identity changes (not on cover re-resolve).
  useEffect(() => {
    alchemyEnrichAttemptedRef.current = false;
    alchemyEnrichInFlightRef.current = false;
    pendingEnrichResumeRef.current = false;
  }, [nftContract, nftTokenId]);

  const toDisplaySrc = (url: string) => {
    url = sanitizeMediaUrl(url);
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
      nftHasAnimatedCover(nft) ||
      shouldPreserveAnimation(nft?.image || '') ||
      shouldPreserveAnimation(nft?.metadata?.image || '')
    ) {
      return url;
    }
    // SeaDN token videos — Cloudinary fetch often 400s; native <video> loads direct.
    if (
      useCardThumb &&
      (isVideoMediaUrl(url) || isLikelyTokenVideoCoverUrl(url)) &&
      /raw2?\.seadn\.io/i.test(url) &&
      !/nft2?-cdn\.alchemy\.com/i.test(url)
    ) {
      return url;
    }
    // Card thumbs: never start with raw <video> (iOS blank first frame).
    // Same Alchemy hash for cover + playback = mp4 (Chapter 14) → video/fetch.
    // Separate PNG hash (Isolation) → thumbnailv2. nftIsVideo alone is wrong
    // for both: video/fetch 400s on PNGs, thumbnailv2 400s on mp4 hashes.
    if (
      useCardThumb &&
      (isVideoMediaUrl(url) ||
        isLikelyTokenVideoCoverUrl(url) ||
        alchemyCoverIsPlaybackVideo(nft) ||
        nft?.coverIsVideo)
    ) {
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
        getVideoCoverStillUrl(url, size, { assumeVideo: true }) ||
        getCardThumbUrl(url, size, { preferVideoStill: true });
      return still;
    }
    // Detail / non-card: play MP4 covers natively (Nifty Island, etc.).
    if (isVideoMediaUrl(url) || isLikelyTokenVideoCoverUrl(url)) {
      return url;
    }
    // Profile/grid cards must not decode full-res Alchemy stills (8k–14k OOMs ~90 NFT profiles).
    if (useCardThumb) {
      const proxied = getCardThumbUrl(url, Math.max(width * 2, 360));
      return proxied;
    }
    if (isBrowserFriendlyCdnUrl(url)) {
      return url;
    }
    if (isArweaveMediaUrl(url)) {
      return url;
    }
    if (isIpfsMediaUrl(url)) {
      return url;
    }
    return url;
  };

  /** Apply a resolved cover — video-only SeaDN/Arweave → native <video>, stills → card thumb. */
  const applyResolvedCoverSrc = (next: string) => {
    const cleaned = sanitizeMediaUrl(next);
    if (!cleaned || cleaned === fallbackSrc) return;
    const videoOnlyCover =
      isVideoMediaUrl(cleaned) ||
      isLikelyTokenVideoCoverUrl(cleaned) ||
      (/raw2?\.seadn\.io/i.test(cleaned) &&
        !/\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i.test(cleaned));
    originalUrlRef.current = cleaned;
    if (videoOnlyCover && useCardThumb) {
      setIsVideo(true);
      setImgSrc(cleaned);
    } else {
      setIsVideo(false);
      setImgSrc(toDisplaySrc(cleaned));
    }
    setImgLoading(true);
    setError(false);
    setIsLoadingFallback(false);
  };
  
  useEffect(() => {
    // Prefer a usable cover from the NFT object when the prop src is empty
    // (stale owned-NFT caches briefly had blank image fields).
    const derivedSrc = (() => {
      const fromProp = sanitizeMediaUrl(src);
      const fromNft = sanitizeMediaUrl(nft?.image);
      const fromMeta = sanitizeMediaUrl(nft?.metadata?.image);
      // After enrich, nft.image may be Alchemy/SeaDN while parent src is stale Arweave.
      if (
        fromProp &&
        isArweaveMediaUrl(fromProp) &&
        ((fromNft && !isArweaveMediaUrl(fromNft)) ||
          (fromMeta && !isArweaveMediaUrl(fromMeta)))
      ) {
        return fromNft || fromMeta;
      }
      const seaDnVideo =
        nft && nftHasSeaDnVideoAnimation(nft)
          ? sanitizeMediaUrl(
              nft.metadata?.animation_url || nft.animationUrl || nft.videoUrl || ''
            )
          : '';
      const still =
        fromProp ||
        fromNft ||
        fromMeta ||
        sanitizeMediaUrl(nft?.collection?.image) ||
        '';
      if (
        seaDnVideo &&
        still &&
        isFragileSeaDnPosterUrl(still) &&
        !isFragileSeaDnPosterUrl(seaDnVideo)
      ) {
        return seaDnVideo;
      }
      return (
        still ||
        seaDnVideo ||
        sanitizeMediaUrl(nft?.metadata?.animation_url) ||
        sanitizeMediaUrl(nft?.videoUrl) ||
        ''
      );
    })();
    const isValidSrc = Boolean(derivedSrc);

    // Resolve the URL we would display *before* resetting loading — if it already
    // decoded successfully, a re-resolve (e.g. metadataImage filling in) must NOT
    // set imgLoading=true. Same src won't re-fire onLoad → false arweave hang hops.
    let nextDisplayUrl = '';
    const rememberedDisplay = nft ? getRememberedNftDisplayCover(nft) : '';
    if (rememberedDisplay) {
      nextDisplayUrl = useCardThumb
        ? rememberedDisplay
        : resizeAlchemyCloudinaryThumb(rememberedDisplay, Math.max(width, height, 720));
    } else if (isValidSrc && nft) {
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

    const deferToEnrich =
      nft &&
      !rememberedDisplay &&
      !alreadyLoaded &&
      !alchemyEnrichAttemptedRef.current &&
      nftNeedsChainMediaEnrich(nft) &&
      (isArweaveMediaUrl(derivedSrc) ||
        isArweaveMediaUrl(nft?.image || '') ||
        isArweaveMediaUrl(nft?.metadata?.image || ''));

    if (!alreadyLoaded) {
      arweaveFallbackUrls.current = [];
      arweaveFallbackIndex.current = 0;
      ipfsFallbackUrls.current = [];
      ipfsFallbackIndex.current = 0;
      httpCdnFallbackUrls.current = [];
      httpCdnFallbackIndex.current = 0;
      attemptedFallbacks.current = {};
      loadedOkSrcRef.current = null;
      // Keep alchemyEnrichAttemptedRef across cover re-resolves — enrich mutates
      // nft.image and would otherwise re-fire forever (Neybors thumb thrash).
      alchemyAsVideoTriedRef.current = false;
      pendingEnrichResumeRef.current = false;
    }

    imageCandidates.current = nft ? pickImageCandidates(nft) : [];
    imageCandidateIndex.current = 0;

    
    if (isValidSrc && !deferToEnrich) {
      // Check if we've already processed this URL
      const cacheKey = nft ? `${nft.contract}-${nft.tokenId}` : derivedSrc;
      const cached = processedUrlCache.current[cacheKey];
      const rememberedHit = nft ? getRememberedNftDisplayCover(nft) : '';
      const effectiveSrc = derivedSrc;
      const isFragileUrl = (url?: string | null) => {
        const u = sanitizeMediaUrl(url);
        return !!u && (/\/ipfs\//i.test(u) || u.startsWith('ipfs://') || /\.ipfs\./i.test(u));
      };
      const isCollectionOpenSea = (url?: string | null) =>
        !!url && /i2c\.seadn\.io/i.test(url);
      const stillSrc =
        [effectiveSrc, nft?.image, nft?.metadata?.image].find(
          (u) =>
            looksLikeStillImageUrl(u) &&
            !isCollectionOpenSeaStillUrl(u, nft?.collection?.image)
        ) || '';
      const isTokenVideoCover = (url?: string | null) =>
        !!url &&
        !looksLikeStillImageUrl(url) &&
        (isVideoMediaUrl(url) ||
          /niftyisland\.com/i.test(url) ||
          (/raw2?\.seadn\.io/i.test(url) && !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(url)));

      const isAlchemyStillUrl = (url?: string | null) =>
        !!url && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);
      const alchemySrc =
        (effectiveSrc && isAlchemyStillUrl(effectiveSrc) && effectiveSrc) ||
        (nft?.image && isAlchemyStillUrl(nft.image) && nft.image) ||
        '';
      // Token VIDEO cover only from image fields. Do not steal a jpeg still
      // (PLATTER i2c) in favor of the playback mp4 / Alchemy video/fetch 400s.
      const tokenVideoSrc = stillSrc
        ? ''
        : (effectiveSrc && isTokenVideoCover(effectiveSrc) && effectiveSrc) ||
          (nft?.image && isTokenVideoCover(nft.image) && nft.image) ||
          (!alchemySrc &&
            nft?.metadata?.animation_url &&
            isTokenVideoCover(nft.metadata.animation_url) &&
            nft.metadata.animation_url) ||
          '';
      // Collection image is last-resort only — never a durable primary when we
      // already have a token Alchemy / SeaDN cover (shared across the contract).
      const durableSrc =
        stillSrc ||
        tokenVideoSrc ||
        alchemySrc ||
        (effectiveSrc &&
          !isFragileUrl(effectiveSrc) &&
          /seadn\.io|openseauserdata\.com|i2c\.seadn|cloudinary\.com|niftyisland\.com/i.test(
            effectiveSrc
          ) &&
          !isCollectionOpenSeaStillUrl(effectiveSrc, nft?.collection?.image) &&
          effectiveSrc) ||
        (nft?.image &&
          !isFragileUrl(nft.image) &&
          /seadn\.io|openseauserdata\.com|i2c\.seadn|cloudinary\.com|niftyisland\.com/i.test(
            nft.image
          ) &&
          !isCollectionOpenSeaStillUrl(nft.image, nft?.collection?.image) &&
          nft.image) ||
        (!alchemySrc &&
          !stillSrc &&
          !tokenVideoSrc &&
          nft?.collection?.image &&
          !isFragileUrl(nft.collection.image) &&
          nft.collection.image) ||
        '';

      // Drop stale collection-art cache when we now have a real token video cover.
      // Also drop a cached playback mp4 when a jpeg still exists (PLATTER).
      if (
        cached &&
        ((isFragileUrl(cached) && durableSrc && !isFragileUrl(durableSrc)) ||
          (isCollectionOpenSea(cached) && tokenVideoSrc) ||
          (stillSrc &&
            (isVideoMediaUrl(cached) ||
              /alchemyapi\/video\/fetch/i.test(cached) ||
              isTokenVideoCover(cached))))
      ) {
        delete processedUrlCache.current[cacheKey];
        clearNftMediaUrlCache(nft, 'image');
      }

      let resolveBranch = 'none';
      let resolvedForLog = '';

      // A remembered cover from *before* the server told us this token's
      // image is really video (coverIsVideo) can be the doomed plain-image
      // guess itself — trusting it blindly re-eats the same 400 every mount.
      const rememberedNeedsVideoStillFix =
        !!rememberedHit &&
        !!nft?.coverIsVideo &&
        !isVideoMediaUrl(rememberedHit) &&
        !/alchemyapi\/video\/fetch/i.test(rememberedHit) &&
        !isLikelyTokenVideoCoverUrl(rememberedHit);

      if (rememberedHit && !rememberedNeedsVideoStillFix) {
        const sizedHit = useCardThumb
          ? rememberedHit
          : resizeAlchemyCloudinaryThumb(rememberedHit, Math.max(width, height, 720));
        resolveBranch = 'rememberedDisplay';
        originalUrlRef.current = rememberedHit;
        loadedOkSrcRef.current = sizedHit;
        setIsVideo(
          isVideoMediaUrl(sizedHit) &&
            !/res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(sizedHit)
        );
        resolvedForLog = sizedHit;
        setImgSrc(sizedHit);
        setImgLoading(sizedHit !== rememberedHit);
      } else if (rememberedNeedsVideoStillFix) {
        resolveBranch = 'rememberedDisplay-video-corrected';
        const corrected = toDisplaySrc(rememberedHit);
        processedUrlCache.current[cacheKey] = corrected;
        clearNftMediaUrlCache(nft, 'image');
        setIsVideo(false);
        resolvedForLog = corrected;
        setImgSrc(corrected);
      } else if (stillSrc) {
        resolveBranch = 'stillSrc';
        processedUrlCache.current[cacheKey] = stillSrc;
        clearNftMediaUrlCache(nft, 'image');
        setIsVideo(false);
        resolvedForLog = toDisplaySrc(stillSrc);
        setImgSrc(resolvedForLog);
      } else if (tokenVideoSrc) {
        resolveBranch = 'tokenVideoSrc';
        processedUrlCache.current[cacheKey] = tokenVideoSrc;
        clearNftMediaUrlCache(nft, 'image');
        resolvedForLog = toDisplaySrc(tokenVideoSrc);
        setImgSrc(resolvedForLog);
      } else if (durableSrc && isAlchemyStillUrl(durableSrc)) {
        resolveBranch = 'alchemyDurable';
        processedUrlCache.current[cacheKey] = durableSrc;
        clearNftMediaUrlCache(nft, 'image');
        // Previously decoded as video/mp4 — skip broken <img> attempt.
        if (
          /nft2?-cdn\.alchemy\.com/i.test(durableSrc) &&
          alchemyCdnAsVideoCover.has(durableSrc)
        ) {
          setIsVideo(true);
        } else {
          setIsVideo(false);
        }
        resolvedForLog = toDisplaySrc(durableSrc);
        setImgSrc(resolvedForLog);
      } else if (
        processedUrlCache.current[cacheKey] &&
        !isFragileUrl(processedUrlCache.current[cacheKey]) &&
        !(isCollectionOpenSea(processedUrlCache.current[cacheKey]) && tokenVideoSrc)
      ) {
        resolveBranch = 'processedCache';
        const hit = processedUrlCache.current[cacheKey];
        resolvedForLog = toDisplaySrc(hit);
        setImgSrc(resolvedForLog);
      } else if (durableSrc) {
        resolveBranch = 'durableSrc';
        processedUrlCache.current[cacheKey] = durableSrc;
        clearNftMediaUrlCache(nft, 'image');
        resolvedForLog = toDisplaySrc(durableSrc);
        setImgSrc(resolvedForLog);
      } else if (processedUrlCache.current[cacheKey] && !durableSrc) {
        resolveBranch = 'processedCache-noDurable';
        const hit = processedUrlCache.current[cacheKey];
        resolvedForLog = toDisplaySrc(hit);
        setImgSrc(resolvedForLog);
      } else {
        // Use a consistent approach for all URL types
        if (nft) {
          resolveBranch = 'getNftMediaUrl';
          const mediaUrl = getNftMediaUrl(
            { ...nft, image: effectiveSrc || nft.image },
            'image'
          );
          // Avoid locking in dead IPFS as the component cache.
          if (!isFragileUrl(mediaUrl)) {
            processedUrlCache.current[cacheKey] = mediaUrl;
          }
          resolvedForLog = toDisplaySrc(mediaUrl);
          setImgSrc(resolvedForLog);
        } else {
          resolveBranch = 'processMediaUrl';
          // Process the URL to handle all special protocols (ar://, ipfs://, etc.)
          // using our improved processMediaUrl function
          const processedSrc = processMediaUrl(effectiveSrc, fallbackSrc, 'image');
          if (!isFragileUrl(processedSrc)) {
            processedUrlCache.current[cacheKey] = processedSrc;
          }
          resolvedForLog = toDisplaySrc(processedSrc);
          setImgSrc(resolvedForLog);
        }
      }

      const resolveKind = imageDebugUrlKind(resolvedForLog);
      const coverIsPlayback = alchemyCoverIsPlaybackVideo(nft);
      if (
        !alreadyLoaded &&
        (coverIsPlayback ||
          resolveKind === 'alchemy-thumbnailv2' ||
          resolveKind === 'alchemy-video-fetch' ||
          resolveKind === 'alchemy-cdn' ||
          resolveKind === 'alchemy-image-transform' ||
          resolveKind === 'ipfs' ||
          resolveKind === 'fallback-png' ||
          resolveKind === 'video-file' ||
          !derivedSrc)
      ) {
        imageDebug('cover:resolve', {
          name: nft?.name,
          contract: nft?.contract,
          tokenId: nft?.tokenId,
          branch: resolveBranch,
          useCardThumb,
          width,
          height,
          coverIsPlaybackVideo: coverIsPlayback,
          derivedSrc,
          stillSrc: stillSrc || null,
          tokenVideoSrc: tokenVideoSrc || null,
          durableSrc: durableSrc || null,
          alchemySrc: alchemySrc || null,
          display: resolvedForLog,
          displayKind: resolveKind,
          original: originalUrlRef.current,
        });
      }
      
      setError(false);
      setRetryCount(0);
      setCurrentGatewayIndex(0);
      setIsLoadingFallback(false);
      setImgLoading(!alreadyLoaded);
    } else if (deferToEnrich) {
      setImgLoading(true);
      setError(false);
      setIsLoadingFallback(false);
    } else {
      // No cover yet — show loading and let Alchemy enrich fill it (don't flash default).
      imageDebug('cover:resolve-empty', {
        name: nft?.name,
        contract: nft?.contract,
        tokenId: nft?.tokenId,
        src,
      });
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
      (nftNeedsChainMediaEnrich(nft) ||
        (!isValidSrc && isOnChainNftIdentity(nft.contract, nft.tokenId)))
    ) {
      alchemyEnrichAttemptedRef.current = true;
      alchemyEnrichInFlightRef.current = true;
      void enrichNftMediaFromChain(nft)
        .then((enriched) => {
          const current = originalUrlRef.current || imgSrc || nft.image || '';
          const isFragileCover = (url?: string | null) => {
            const u = sanitizeMediaUrl(url);
            if (!u) return true;
            return (
              /\/ipfs\//i.test(u) ||
              u.startsWith('ipfs://') ||
              /\.ipfs\./i.test(u) ||
              isArweaveMediaUrl(u) ||
              (isFragileSeaDnPosterUrl(u) && nftHasSeaDnVideoAnimation(nft))
            );
          };

          const pickCover = (url?: string | null): string => {
            const u = sanitizeMediaUrl(url);
            if (!u) return '';
            if (u === fallbackSrc) return '';
            if (isFragileCover(u)) return '';
            if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(u)) return '';
            return u;
          };

          const isAlchemyUrl = (u?: string | null) =>
            !!u &&
            /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(u);
          const isCollectionOpenSeaStill = (u?: string | null) =>
            !!u && /i2c\.seadn\.io/i.test(u);

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
          // Collection / OpenSea art — last resort only when token cover is dead.
          const collectionStill = pickCover(enriched.collection?.image);
          const currentIsAlchemy = isAlchemyUrl(current) || isAlchemyUrl(originalUrlRef.current);

          // Prefer Alchemy CDN → enriched non-IPFS. Never yank a live Alchemy
          // token cover for collection i2c (daily journals all share one PNG).
          let next = alchemyImg || '';
          if (!next && enrichedStill && !isCollectionOpenSeaStill(enrichedStill)) {
            next = enrichedStill;
          }
          if ((!next || isFragileCover(next)) && collectionStill) {
            // Never swap a live Arweave still for shared collection i2c
            // (I Found It vs Seasoning with Sazón on the same contract).
            const currentIsArweaveStill =
              isArweaveMediaUrl(current) && !isVideoMediaUrl(current);
            if (
              isFragileCover(current) &&
              !currentIsTokenVideo &&
              !currentIsAlchemy &&
              !currentIsArweaveStill
            ) {
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

          // Keep any in-flight / loaded Alchemy card thumb. Collection art is
          // shared across the whole contract — must not overwrite per-token covers.
          const keepCurrentThumb =
            Boolean(loadedOkSrcRef.current) ||
            (currentIsAlchemy && !isFragileCover(current)) ||
            (Boolean(next) &&
              !isFragileCover(current) &&
              useCardThumb &&
              isAlchemyUrl(current) &&
              isAlchemyUrl(next));

          if (!next || keepCurrentThumb || (next === current && !isFragileCover(current))) {
            // Collection merge only — no better cover, or keep Alchemy thumb.
            // Still carry over coverIsVideo even when keeping the same URL —
            // future resolves of this same nft object (remembered-cover reuse,
            // re-mounts) must not repeat the doomed plain-image guess.
            Object.assign(nft, {
              coverIsVideo: enriched.coverIsVideo ?? nft.coverIsVideo,
              collection: {
                ...nft.collection,
                ...enriched.collection,
                image: enriched.collection?.image || nft.collection?.image,
              },
            });
            imageDebug('cover:enrich-keep', {
              name: nft.name,
              contract: nft.contract,
              tokenId: nft.tokenId,
              current,
              next: next || null,
              keep: true,
              currentIsAlchemy,
            });
            return Boolean(loadedOkSrcRef.current);
          }

          imageDebug('cover:enrich-swap', {
            name: nft.name,
            contract: nft.contract,
            tokenId: nft.tokenId,
            from: current,
            to: next,
            fromKind: imageDebugUrlKind(current),
            toKind: imageDebugUrlKind(next),
          });

          // COVER ONLY — never replace metadata.animation_url / audio (breaks play).
          Object.assign(nft, {
            image: next || enriched.image || nft.image,
            // Server already knows (Alchemy contentType) whether this exact
            // cover needs a video-still fetch — carry it over so toDisplaySrc
            // doesn't have to blind-guess the plain image transform first.
            coverIsVideo: enriched.coverIsVideo ?? nft.coverIsVideo,
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

          if (attemptedFallbacks.current[`${next}-alchemy`] && !isFragileCover(current)) {
            return Boolean(loadedOkSrcRef.current);
          }

          const cacheKey = `${nft.contract}-${nft.tokenId}`;
          processedUrlCache.current[cacheKey] = next;
          attemptedFallbacks.current[`${next}-alchemy`] = true;
          applyResolvedCoverSrc(next);
          return true;
        })
        .then((applied) => {
          alchemyEnrichInFlightRef.current = false;
          if (!pendingEnrichResumeRef.current) return;
          pendingEnrichResumeRef.current = false;
          // Enrich applied a new URL — let onLoad/onError drive the rest.
          if (applied || loadedOkSrcRef.current) return;

          // Kept Alchemy cover but thumb already 400'd — try video/fetch still.
          if (useCardThumb && originalUrlRef.current) {
            const size = Math.max(width * 2, 360);
            const orig = originalUrlRef.current;
            const alchemyCdnPeer = [
              nft.audio,
              nft.metadata?.animation_url,
              nft.animationUrl,
              nft.videoUrl,
              nft.image,
              nft.metadata?.image,
            ].find((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(u)) as string | undefined;
            const nextAlt = getCardThumbAlternates(orig, size, {
              includeVideoStill: /nft2?-cdn\.alchemy\.com/i.test(orig),
              alchemyCdnPeer,
            }).find(
              (u) =>
                u !== imgSrc &&
                !attemptedFallbacks.current[`${u}-card`] &&
                !attemptedFallbacks.current[`${u}-hang`]
            );
            if (nextAlt) {
              attemptedFallbacks.current[`${nextAlt}-card`] = true;
              setImgSrc(nextAlt);
              setImgLoading(true);
              setError(false);
              setIsLoadingFallback(false);
              return;
            }
          }

          const coll = nft.collection?.image;
          const stillHaveAlchemy =
            /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(
              originalUrlRef.current || nft.image || ''
            );
          if (
            coll &&
            !stillHaveAlchemy &&
            !/\/ipfs\//i.test(coll) &&
            !/\.(mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|#|$)/i.test(coll) &&
            !attemptedFallbacks.current[`${coll}-collection`]
          ) {
            attemptedFallbacks.current[`${coll}-collection`] = true;
            imageDebug('cover:hop', {
              name: nft.name,
              contract: nft.contract,
              tokenId: nft.tokenId,
              from: originalUrlRef.current,
              to: coll,
              toKind: imageDebugUrlKind(coll),
              reason: 'enrich-resume-collection',
            });
            originalUrlRef.current = coll;
            setImgSrc(toDisplaySrc(coll));
            setImgLoading(true);
            setError(false);
            setIsLoadingFallback(false);
            return;
          }
          if (nft) markNftMediaDead(nft, 'image');
          setError(true);
          setIsLoadingFallback(true);
          setImgSrc(fallbackSrc);
        })
        .catch(() => {
          alchemyEnrichInFlightRef.current = false;
        });
    }

    // Cover already assigned above. A second getNftMediaUrl pass was
    // overwriting SeaDN/video stills with wsrv-proxied images that 404.
    if (!isValidSrc && (nft?.metadata?.image || nft?.image)) {
      setIsVideo(false);
      const thumbnailUrl = nft.metadata?.image || nft.image;
      
      // Check if image URL matches any audio URL
      if (nft && isAudioUrlUsedAsImage(nft, thumbnailUrl)) {
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
          isVideoMediaUrl(originalUrlRef.current) ||
          alchemyCoverIsPlaybackVideo(nft);
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
          preferVideoStill: hungIsVideo,
          // thumbnailv2 400s on the same mp4 hash — don't "recover" by hopping to it.
          skipThumbnailV2: hungIsVideo,
          alchemyCdnPeer,
        }).find(
          (u) => u !== imgSrc && !attemptedFallbacks.current[`${u}-hang`]
        );
        if (alt) {
          next = alt;
          attemptedFallbacks.current[`${alt}-hang`] = true;
          skipToDisplay = true;
          imageDebug('cover:hop', {
            name: nft?.name,
            contract: nft?.contract,
            tokenId: nft?.tokenId,
            from: imgSrc,
            fromKind: imageDebugUrlKind(imgSrc),
            to: alt,
            toKind: imageDebugUrlKind(alt),
            reason: 'hang-timeout',
          });
        } else {
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
          setImgLoading(false);
          return;
        }
      } else if (isProxy && originalUrlRef.current && originalUrlRef.current !== imgSrc) {
        next = originalUrlRef.current;
      }

      if (!next || next === imgSrc) {
        return;
      }

      setImgSrc(skipToDisplay ? next : toDisplaySrc(next));
      setError(false);
      setIsLoadingFallback(false);
      setImgLoading(true);
    }, waitMs);
    return () => window.clearTimeout(timeout);
  }, [imgSrc, imgLoading, useCardThumb, width, height]);

  imgSrcRef.current = imgSrc;

  const handleError = async (error: SyntheticEvent<HTMLVideoElement | HTMLImageElement>) => {
    const failedSrc = error.currentTarget.src || imgSrc;
    const currentSrc = imgSrcRef.current;
    const failedNorm = sanitizeMediaUrl(failedSrc);
    const currentNorm = sanitizeMediaUrl(currentSrc);

    // Stale onError from a previous src (ipfs gateway 404 after SeaDN already loaded).
    if (
      loadedOkSrcRef.current &&
      (loadedOkSrcRef.current === currentNorm ||
        loadedOkSrcRef.current === currentSrc ||
        (currentNorm && currentNorm !== fallbackSrc && failedNorm !== currentNorm))
    ) {
      return;
    }
    if (currentNorm && failedNorm && failedNorm !== currentNorm && currentNorm !== fallbackSrc) {
      return;
    }
    
    // Skip if we've already tried this fallback strategy.
    // Duplicate onError (React Strict Mode / unmount) must NOT jump to
    // default-nft.png — that aborts video/fetch after a thumbnailv2 400.
    const fallbackKey = `${failedSrc}-${retryCount}`;
    if (attemptedFallbacks.current[fallbackKey]) {
      return;
    }
    

    // Pause gateway thrash while Alchemy enrich may still return a real cover
    // (audio NFTs often have dead IPFS in image + usable thumbnail/collection).
    // Exception: Alchemy sized thumbs (thumbnailv2 / video/fetch) that 400 —
    // enrich won't replace an existing Alchemy cover; hop to video/fetch now
    // (Neybors / Squig / SCAN ME).
    if (alchemyEnrichInFlightRef.current) {
      const alchemySizedThumbFail =
        useCardThumb &&
        /res\.cloudinary\.com\/alchemyapi\/(?:image\/upload|video\/fetch)/i.test(
          failedSrc
        );
      if (!alchemySizedThumbFail) {
        pendingEnrichResumeRef.current = true;
        return;
      }
    }
    
    // Mark this fallback as attempted
    attemptedFallbacks.current[fallbackKey] = true;

    imageDebug('cover:error', {
      name: nft?.name,
      contract: nft?.contract,
      tokenId: nft?.tokenId,
      failed: failedSrc,
      failedKind: imageDebugUrlKind(failedSrc),
      current: currentSrc,
      original: originalUrlRef.current,
      useCardThumb,
      retryCount,
      enrichInFlight: alchemyEnrichInFlightRef.current,
    });

    const isThumbProxy =
      failedSrc.includes('wsrv.nl') ||
      failedSrc.includes('images.weserv.nl') ||
      failedSrc.includes('img-width=') ||
      failedSrc.includes('/api/media-proxy?') ||
      /res\.cloudinary\.com\/alchemyapi\/(?:image\/(?:fetch|upload)|video\/fetch)/i.test(
        failedSrc
      );
    const isCardCdnFail =
      useCardThumb &&
      !isArweaveMediaUrl(originalUrlRef.current || '') &&
      !isArweaveUrl(originalUrlRef.current || '') &&
      (isThumbProxy ||
        isBrowserFriendlyCdnUrl(failedSrc) ||
        isBrowserFriendlyCdnUrl(originalUrlRef.current));
    if (isCardCdnFail) {
      // Cards must never decode full-res Alchemy/CDN stills (14k images OOM the tab).
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
      const videoCoverUrl = [
        nft?.metadata?.animation_url,
        nft?.animationUrl,
        nft?.videoUrl,
        nft?.audio,
      ].find(
        (u) => !!u && (isVideoMediaUrl(u) || isLikelyTokenVideoCoverUrl(u))
      ) as string | undefined;
      const orig = originalUrlRef.current || failedSrc;
      const raw2PosterFail =
        isFragileSeaDnPosterUrl(orig) && !!videoCoverUrl && nftHasSeaDnVideoAnimation(nft);
      if (raw2PosterFail && !attemptedFallbacks.current[`${videoCoverUrl}-native-video`]) {
        attemptedFallbacks.current[`${videoCoverUrl}-native-video`] = true;
        imageDebug('cover:hop', {
          name: nft?.name,
          contract: nft?.contract,
          tokenId: nft?.tokenId,
          from: failedSrc,
          to: videoCoverUrl,
          toKind: imageDebugUrlKind(videoCoverUrl),
          reason: 'native-video-poster',
        });
        setIsVideo(true);
        setImgSrc(videoCoverUrl);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      const thumbFailed = /thumbnailv2/i.test(failedSrc);
      const videoFetchFailed = /video\/fetch/i.test(failedSrc);
      const coverIsPlaybackVideo = alchemyCoverIsPlaybackVideo(nft);
      const parsedPeer =
        parseAlchemyCdnRef(alchemyCdnPeer || '')?.cdnUrl ||
        parseAlchemyCdnRef(orig)?.cdnUrl ||
        parseAlchemyCdnRef(failedSrc)?.cdnUrl;
      const nextAlt = getCardThumbAlternates(orig, size, {
        includeVideoStill: true,
        preferVideoStill: coverIsPlaybackVideo || thumbFailed,
        skipThumbnailV2: videoFetchFailed || coverIsPlaybackVideo,
        alchemyCdnPeer: parsedPeer || alchemyCdnPeer,
        videoCoverUrl,
      }).find(
        (u) => u !== failedSrc && !attemptedFallbacks.current[`${u}-card`]
      );
      if (nextAlt) {
        attemptedFallbacks.current[`${nextAlt}-card`] = true;
        imageDebug('cover:hop', {
          name: nft?.name,
          contract: nft?.contract,
          tokenId: nft?.tokenId,
          from: failedSrc,
          fromKind: imageDebugUrlKind(failedSrc),
          to: nextAlt,
          toKind: imageDebugUrlKind(nextAlt),
          reason: 'card-alt',
          coverIsPlaybackVideo,
          thumbFailed,
          videoFetchFailed,
        });
        setImgSrc(nextAlt);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      const nativeVideo =
        (orig && (isLikelyTokenVideoCoverUrl(orig) || isVideoMediaUrl(orig)) && orig) ||
        videoCoverUrl ||
        ((coverIsPlaybackVideo || thumbFailed) && parsedPeer) ||
        '';
      if (nativeVideo && !attemptedFallbacks.current[`${nativeVideo}-native-video`]) {
        attemptedFallbacks.current[`${nativeVideo}-native-video`] = true;
        imageDebug('cover:hop', {
          name: nft?.name,
          contract: nft?.contract,
          tokenId: nft?.tokenId,
          from: failedSrc,
          to: nativeVideo,
          toKind: imageDebugUrlKind(nativeVideo),
          reason: 'native-video',
        });
        setIsVideo(true);
        setImgSrc(nativeVideo);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
      imageDebug('cover:fallback-png', {
        name: nft?.name,
        contract: nft?.contract,
        tokenId: nft?.tokenId,
        failed: failedSrc,
        failedKind: imageDebugUrlKind(failedSrc),
        original: originalUrlRef.current,
        coverIsPlaybackVideo,
        alchemyPeer: parsedPeer || alchemyCdnPeer || null,
        altsTried: Object.keys(attemptedFallbacks.current).filter((k) => k.endsWith('-card')),
      });
      if (
        nft &&
        !alchemyEnrichAttemptedRef.current &&
        (isArweaveMediaUrl(originalUrlRef.current || '') ||
          isArweaveUrl(originalUrlRef.current || '') ||
          nftNeedsChainMediaEnrich(nft))
      ) {
        alchemyEnrichAttemptedRef.current = true;
        alchemyEnrichInFlightRef.current = true;
        void enrichNftMediaFromChain(nft)
          .then((enriched) => {
            const pickCover = (url?: string | null): string => {
              const u = sanitizeMediaUrl(url);
              if (!u || u === fallbackSrc) return '';
              if (/\/ipfs\//i.test(u) || u.startsWith('ipfs://') || /\.ipfs\./i.test(u)) {
                return '';
              }
              if (isArweaveMediaUrl(u)) return '';
              if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(u)) return '';
              return u;
            };
            const next =
              pickCover(enriched.image) ||
              pickCover(enriched.metadata?.image) ||
              pickCover(enriched.collection?.image) ||
              '';
            Object.assign(nft, {
              image: next || nft.image,
              coverIsVideo: enriched.coverIsVideo ?? nft.coverIsVideo,
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
              return false;
            }
            attemptedFallbacks.current[`${next}-alchemy`] = true;
            applyResolvedCoverSrc(next);
            setRetryCount((c) => c + 1);
            setError(false);
            setIsLoadingFallback(false);
            return true;
          })
          .then((applied) => {
            alchemyEnrichInFlightRef.current = false;
            if (applied) return;
            if (nft) logNftCoverDebug(nft, 'error');
            setImgSrc(fallbackSrc);
            setError(false);
            setIsLoadingFallback(false);
          })
          .catch(() => {
            alchemyEnrichInFlightRef.current = false;
            if (nft) logNftCoverDebug(nft, 'error');
            setImgSrc(fallbackSrc);
            setError(false);
            setIsLoadingFallback(false);
          });
        return;
      }
      if (nft) logNftCoverDebug(nft, 'error');
      setImgSrc(fallbackSrc);
      setError(false);
      setIsLoadingFallback(false);
      return;
    }

    if (isThumbProxy && originalUrlRef.current && originalUrlRef.current !== failedSrc) {
      setImgSrc(originalUrlRef.current);
      setError(false);
      setIsLoadingFallback(false);
      return;
    }

    // The gateway we remembered as "working" just failed — stop recommending it.
    if (nft) {
      const mediaKeyForMemory = getMediaKey(nft);
      if (failedSrc === getRememberedMediaUrl(mediaKeyForMemory, 'image')) {
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
        setImgSrc(toDisplaySrc(nextUrl));
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
        setImgSrc(toDisplaySrc(nextUrl));
        setRetryCount(retryCount + 1);
        setError(false);
        setIsLoadingFallback(false);
        return;
      }
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
      (nftNeedsChainMediaEnrich(nft) ||
        alchemyCdnFailed ||
        isArweaveMediaUrl(originalUrlRef.current || '') ||
        isArweaveUrl(originalUrlRef.current || ''))
    ) {
      alchemyEnrichAttemptedRef.current = true;
      alchemyEnrichInFlightRef.current = true;
      void enrichNftMediaFromChain(nft)
        .then((enriched) => {
          const pickCover = (url?: string | null): string => {
            const u = sanitizeMediaUrl(url);
            if (!u) return '';
            if (u === failedSrc || u === fallbackSrc) return '';
            if (/\/ipfs\//i.test(u) || u.startsWith('ipfs://') || /\.ipfs\./i.test(u)) {
              return '';
            }
            if (isArweaveMediaUrl(u)) return '';
            if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(u)) return '';
            return u;
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
            pickCover(enriched.image) ||
            pickCover(enriched.metadata?.image) ||
            pickCover(enriched.collection?.image) ||
            '';
          const next = videoNext || stillNext;

          // COVER ONLY — preserve playback metadata.
          Object.assign(nft, {
            image: next || nft.image,
            coverIsVideo: enriched.coverIsVideo ?? nft.coverIsVideo,
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
            return false;
          }
          attemptedFallbacks.current[`${next}-alchemy`] = true;
          applyResolvedCoverSrc(next);
          setRetryCount((c) => c + 1);
          setError(false);
          setIsLoadingFallback(false);
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
            originalUrlRef.current = coll;
            setImgSrc(toDisplaySrc(coll));
            setError(false);
            setIsLoadingFallback(false);
            return;
          }
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
    // Same exception as above: Alchemy sized-thumb 400s need video/fetch now.
    if (alchemyEnrichInFlightRef.current) {
      const alchemySizedThumbFail =
        useCardThumb &&
        /res\.cloudinary\.com\/alchemyapi\/(?:image\/upload|video\/fetch)/i.test(
          failedSrc
        );
      if (!alchemySizedThumbFail) {
        return;
      }
    }

    // Enrich already ran but collection/OpenSea cover may not have been tried yet
    // (common for audio NFTs whose image field is a dead IPFS CID).
    // Never use collection art when we still have a per-token Alchemy cover —
    // every token in the contract shares the same collection PNG.
    if (nft?.collection?.image) {
      const coll = nft.collection.image;
      const stillHaveAlchemy =
        /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(
          originalUrlRef.current || nft.image || nft.metadata?.image || ''
        );
      if (
        !stillHaveAlchemy &&
        coll !== failedSrc &&
        coll !== fallbackSrc &&
        !/\.(mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|#|$)/i.test(coll) &&
        !/\/ipfs\//i.test(coll) &&
        !attemptedFallbacks.current[`${coll}-collection`]
      ) {
        attemptedFallbacks.current[`${coll}-collection`] = true;
        imageDebug('cover:hop', {
          name: nft.name,
          contract: nft.contract,
          tokenId: nft.tokenId,
          from: failedSrc,
          to: coll,
          toKind: imageDebugUrlKind(coll),
          reason: 'collection-last-resort',
        });
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
      markNftMediaDead(nft, 'image');
    }

    // CRITICAL: Immediately switch to fallback image and force re-render
    if (loadedOkSrcRef.current) {
      return;
    }
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
      void handleError({
        currentTarget: imgEl,
      } as SyntheticEvent<HTMLImageElement>);
      return;
    }

    if (!loadedSrc || loadedSrc.includes('default-nft.png')) return;
    loadedOkSrcRef.current = loadedSrc;
    imageDebug('cover:ok', {
      name: nft?.name,
      contract: nft?.contract,
      tokenId: nft?.tokenId,
      src: loadedSrc,
      kind: imageDebugUrlKind(loadedSrc),
      naturalWidth: width,
      naturalHeight: height,
      useCardThumb,
    });
    if (!nft) return;
    if (isCollectionOpenSeaStillUrl(loadedSrc, nft.collection?.image)) {
      return;
    }
    rememberNftDisplayCover(nft, loadedSrc);
    if (
      loadedSrc.includes('wsrv.nl') ||
      loadedSrc.includes('images.weserv.nl') ||
      loadedSrc.includes('img-width=')
    ) {
      return;
    }
    // Key covers by contract-tokenId, not shared audio mediaKey.
    rememberWorkingMediaUrl(getNftIdentityKey(nft) || getMediaKey(nft), 'image', loadedSrc);
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
    source = sanitizeMediaUrl(source);
    
    // Basic string validation
    if (source === 'undefined' || 
        source === 'null' || 
        source === '') {
      return false;
    }

    if (isLocalPublicPath(source)) return true;
    
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
  const resolvedSrc = (error || isLoadingFallback || !validateSrc(imgSrc)) ? absoluteFallbackSrc : imgSrc;
  const finalSrc = (() => {
    const cleaned = sanitizeMediaUrl(resolvedSrc) || absoluteFallbackSrc;
    if (cleaned.startsWith('/') || cleaned.startsWith('data:')) return cleaned;
    if (/^(ipfs|ar):\/\//i.test(cleaned)) {
      return processMediaUrl(cleaned, fallbackSrc, 'image');
    }
    return cleaned;
  })();
  
  // Check if this is an Arweave URL using proper validation
  const isArweave = isArweaveUrl(finalSrc);
  const isAnimated = shouldPreserveAnimation(finalSrc) || shouldPreserveAnimation(src) || nftHasAnimatedCover(nft);
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
    isLocalPublicPath(finalSrc) ||
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