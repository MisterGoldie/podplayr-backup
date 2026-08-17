import { isOpenSeaCdnHost, toOpenSeaCdnProxyUrl } from './openSeaMedia';
import { sanitizeMediaUrl } from './media';

interface OptimizedImage {
  file: File;
  width: number;
  height: number;
  size: number;
}

export const optimizeImage = async (file: File, maxWidth = 680, maxHeight = 560, quality = 0.85): Promise<OptimizedImage> => {
  // Validate file type to ensure it's actually an image
  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!file || !validImageTypes.includes(file.type)) {
    return Promise.reject(new Error('Invalid image file type'));
  }
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate dimensions while maintaining aspect ratio
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Set canvas size
      canvas.width = width;
      canvas.height = height;

      // Draw and optimize
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }

          // Create optimized file
          const optimizedFile = new File(
            [blob],
            file.name.replace(/\.[^/.]+$/, "") + '.jpg',
            { type: 'image/jpeg' }
          );

          resolve({
            file: optimizedFile,
            width,
            height,
            size: optimizedFile.size
          });
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Load image from file - create object URL with proper cleanup
    const objectUrl = URL.createObjectURL(file);
    
    // SECURITY: Validate object URL before assigning to prevent XSS
    try {
      // Use URL constructor to validate - this prevents XSS by ensuring proper URL format
      const url = new URL(objectUrl);
      
      // Only allow blob: URLs (for local files) and data: URLs for images
      if (url.protocol === 'blob:' || (url.protocol === 'data:' && url.pathname.startsWith('image/'))) {
        // Assign to src property using the validated URL string
        // Use the string representation of the URL object to prevent XSS
        img.src = url.href;
      } else {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Invalid image source protocol'));
        return;
      }
    } catch (error) {
      // Invalid URL format
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Invalid image source format'));
      return;
    }
    
    // Add onload handler to revoke the URL after image is loaded
    const originalOnload = img.onload;
    img.onload = (event) => {
      // Call the original onload handler first
      if (originalOnload) {
        // @ts-ignore - TypeScript doesn't like reassigning event handlers
        originalOnload.call(img, event);
      }
      
      // Clean up the object URL to prevent memory leaks
      URL.revokeObjectURL(objectUrl);
    };
  });
};

export function getOptimizedImageUrl(url: string, options: {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
  isMobile?: boolean;
} = {}): string {
  // For IPFS URLs: use a working gateway (cloudflare-ipfs.com DNS is dead)
  url = sanitizeMediaUrl(url);
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('/')) {
    return url;
  }

  const {
    width = options.isMobile ? 400 : 800,
    height = options.isMobile ? 400 : 800,
    quality = options.isMobile ? 70 : 85,
    format = 'webp',
    isMobile = false
  } = options;

  if (typeof url === 'string' && (url.startsWith('ipfs://') || url.includes('/ipfs/'))) {
    const path = url.startsWith('ipfs://')
      ? url.replace(/^ipfs:\/\//, '')
      : (url.match(/\/ipfs\/(.+)$/i)?.[1] ?? '');
    if (path) {
      return `https://gateway.pinata.cloud/ipfs/${path}`;
    }
  }
  
  // For Arweave URLs
  if (typeof url === 'string' && url.startsWith('ar://')) {
    const arweaveHash = url.replace('ar://', '');
    return `https://arweave.net/${arweaveHash}`;
  }

  // For normal HTTP URLs that don't support optimization parameters, just return the URL
  return url;
}

const THUMB_PROXY = 'https://wsrv.nl/?';

function isLocalOrDataUrl(url: string): boolean {
  return !url || url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:');
}

function isAlreadyResized(url: string): boolean {
  return (
    url.includes('wsrv.nl') ||
    url.includes('images.weserv.nl') ||
    url.includes('/_next/image') ||
    /[?&]img-width=\d+/.test(url) ||
    /res\.cloudinary\.com\/alchemyapi\/(?:image\/(?:fetch|upload)|video\/fetch)\/w_\d+/i.test(
      url
    )
  );
}

/**
 * Alchemy-hosted card thumbs (no third-party proxy).
 * Prefer thumbnailv2 / sized video stills — wsrv cold-starts and fails on video blobs.
 */
export function getAlchemyNativeCardThumb(url: string, size = 360): string | null {
  if (!url || isLocalOrDataUrl(url)) return null;

  let u = url;
  const fetchWrapped = url.match(
    /res\.cloudinary\.com\/alchemyapi\/image\/fetch\/[^?]+\/(https?:\/\/\S+)/i
  );
  if (fetchWrapped?.[1]) u = fetchWrapped[1];

  if (
    /res\.cloudinary\.com\/alchemyapi\/(?:image\/upload|video\/fetch)/i.test(u) &&
    /\/w_\d+/.test(u)
  ) {
    return u;
  }

  if (/res\.cloudinary\.com\/alchemyapi\/image\/upload/i.test(u)) {
    return u.replace(
      /(\/image\/upload\/)/i,
      `$1w_${size},h_${size},c_fill,q_70/`
    );
  }

  if (/res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(u)) {
    // Enrich often already has f_png,so_0 — don't duplicate those transforms.
    const hasStill = /(?:^|\/|,)(?:f_png|so_0)(?:,|\/|$)/i.test(u);
    const inject = hasStill
      ? `w_${size},h_${size},c_fill,q_70,`
      : `w_${size},h_${size},c_fill,q_70,f_png,so_0,`;
    return u.replace(/(\/video\/fetch\/)/i, `$1${inject}`);
  }

  const cdn = u.match(/nft2?-cdn\.alchemy\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (cdn) {
    return `https://res.cloudinary.com/alchemyapi/image/upload/w_${size},h_${size},c_fill,q_70/thumbnailv2/${cdn[1]}/${cdn[2]}`;
  }

  return null;
}

/**
 * Ordered card fallbacks.
 * video/fetch is only for known video covers or hard fails — never as a hang
 * hop for normal stills (Alchemy returns 400 when the CDN hash isn't video).
 */
export function getCardThumbAlternates(
  url: string,
  size = 360,
  opts?: {
    includeVideoStill?: boolean;
    alchemyCdnPeer?: string | null;
    /** Playback mp4 / SeaDN video when the still image is a different URL. */
    videoCoverUrl?: string | null;
  }
): string[] {
  url = sanitizeMediaUrl(url);
  const alts: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    alts.push(u);
  };

  if (isIpfsMediaUrl(url) || url.startsWith('ipfs://') || url.startsWith('ar://')) {
    push(getOptimizedImageUrl(url));
  }

  const isVideoFetch = /res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(url);
  const includeVideoStill = opts?.includeVideoStill ?? isVideoFetch;
  // Only SeaDN / mp4 / nifty — NOT “has an Alchemy peer” (every Alchemy image has that).
  const knownVideoCover =
    isLikelyTokenVideoCoverUrl(url) || isVideoMediaUrl(url);

  // Known video covers: video/fetch first (thumbnailv2 400s on video hashes).
  // Normal Alchemy stills: thumbnailv2 first — video/fetch 400 spam otherwise.
  if (knownVideoCover) {
    push(getVideoCoverStillUrl(opts?.alchemyCdnPeer || '', size, { assumeVideo: true }));
    push(getVideoCoverStillUrl(url, size));
  }
  if (opts?.videoCoverUrl && opts.videoCoverUrl !== url) {
    push(getVideoCoverStillUrl(opts.videoCoverUrl, size));
  }

  push(getAlchemyNativeCardThumb(url, size));
  if (opts?.alchemyCdnPeer) {
    push(getAlchemyNativeCardThumb(opts.alchemyCdnPeer, size));
  }

  let underlying = url;
  const fetchWrapped = url.match(
    /res\.cloudinary\.com\/alchemyapi\/image\/fetch\/[^?]+\/(https?:\/\/\S+)/i
  );
  if (fetchWrapped?.[1]) underlying = fetchWrapped[1];
  const fromVideo = url.match(/https?:\/\/nft2?-cdn\.alchemy\.com\/[^\s"'?]+/i);
  if (fromVideo?.[0]) underlying = fromVideo[0];

  const cdnFull =
    (opts?.alchemyCdnPeer &&
      opts.alchemyCdnPeer.match(/https?:\/\/nft2?-cdn\.alchemy\.com\/[^/?#]+\/[^/?#]+/i)?.[0]) ||
    underlying.match(/https?:\/\/nft2?-cdn\.alchemy\.com\/[^/?#]+\/[^/?#]+/i)?.[0];
  // After thumbnailv2 fails on a video hash (Neybors etc.), try video/fetch once.
  if (includeVideoStill && cdnFull) {
    push(
      `https://res.cloudinary.com/alchemyapi/video/fetch/w_${size},h_${size},c_fill,q_70,f_png,so_0/${cdnFull}`
    );
  }

  if (knownVideoCover && isLikelyTokenVideoCoverUrl(url)) {
    push(getVideoCoverStillUrl(url, size));
  }

  const skipWsrv =
    isBrowserFriendlyCdnUrl(underlying) ||
    isVideoMediaUrl(underlying) ||
    isLikelyTokenVideoCoverUrl(underlying) ||
    knownVideoCover ||
    /nft2?-cdn\.alchemy\.com/i.test(underlying) ||
    shouldPreserveAnimation(underlying) ||
    isIpfsMediaUrl(underlying) ||
    underlying.startsWith('ipfs://') ||
    underlying.startsWith('ar://');

  // OpenSea / imgur / similar: wsrv is often blocked. Direct, then our proxy,
  // then Alchemy fetch — same hops for every NFT on those CDNs.
  if (
    underlying &&
    !isLocalOrDataUrl(underlying) &&
    isBrowserFriendlyCdnUrl(underlying) &&
    !isVideoMediaUrl(underlying) &&
    !isLikelyTokenVideoCoverUrl(underlying)
  ) {
    push(underlying);
    try {
      const host = new URL(underlying).hostname.toLowerCase();
      if (isOpenSeaCdnHost(host)) {
        push(toOpenSeaCdnProxyUrl(underlying));
        push(
          `https://res.cloudinary.com/alchemyapi/image/fetch/w_${size},h_${size},c_fill,q_70/${underlying}`
        );
      }
    } catch {
      // ignore invalid URLs
    }
  }

  // Don't wsrv video bytes / token video covers / CDNs that block the proxy.
  if (
    underlying &&
    !isLocalOrDataUrl(underlying) &&
    !skipWsrv
  ) {
    let forProxy = underlying;
    if (
      forProxy.startsWith('ipfs://') ||
      forProxy.includes('/ipfs/') ||
      forProxy.startsWith('ar://')
    ) {
      forProxy = getOptimizedImageUrl(forProxy);
    }
    const params = new URLSearchParams({
      url: forProxy,
      w: String(size),
      h: String(size),
      fit: 'cover',
      q: '65',
      output: 'webp',
      n: '-1',
    });
    push(`${THUMB_PROXY}${params.toString()}`);
    push(`https://images.weserv.nl/?${params.toString()}`);
  }

  return alts;
}

/**
 * GIFs / APNGs must not go through the static WebP thumb proxy (n=0 freezes
 * animation, and large Pinata GIFs often never finish converting).
 * Dedicated mypinata.cloud CIDs also omit a .gif extension.
 */
export function shouldPreserveAnimation(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/\.(gif|apng)(?:\?|#|$)/i.test(lower)) return true;
  if (lower.includes('image/gif') || lower.includes('image%2fgif')) return true;
  if (/mypinata\.cloud/i.test(lower)) return true;
  return false;
}

/**
 * OpenSea / Cloudinary / Alchemy / similar CDNs already serve sized assets and
 * often hang or block behind wsrv.nl + Next image-optimizer. Load them direct.
 */
export function isBrowserFriendlyCdnUrl(url: string): boolean {
  if (!url || isLocalOrDataUrl(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'seadn.io' ||
      host.endsWith('.seadn.io') ||
      host === 'openseauserdata.com' ||
      host.endsWith('.openseauserdata.com') ||
      host === 'res.cloudinary.com' ||
      host.endsWith('.cloudinary.com') ||
      host === 'nft-cdn.alchemy.com' ||
      host === 'nft2-cdn.alchemy.com' ||
      host.endsWith('.alchemy.com') ||
      host === 'i.imgur.com' ||
      host === 'cdn.simplehash.com' ||
      host.endsWith('.simplehash.com')
    );
  } catch {
    return /seadn\.io|openseauserdata|cloudinary\.com|nft2?-cdn\.alchemy\.com|imgur\.com|simplehash/i.test(
      url
    );
  }
}

/** Arweave gateways hang or 404 behind wsrv — load them direct. */
export function isArweaveMediaUrl(url: string): boolean {
  if (!url || isLocalOrDataUrl(url)) return false;
  if (url.startsWith('ar://')) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'arweave.net' ||
      host.endsWith('.arweave.net') ||
      host === 'turbo-gateway.com' ||
      host.endsWith('.turbo-gateway.com') ||
      host === 'permagate.io' ||
      host.endsWith('.permagate.io') ||
      host === 'gateway.irys.xyz' ||
      host === 'ar-io.dev' ||
      host === 'g8way.io'
    );
  } catch {
    return /arweave|turbo-gateway|permagate|irys|ar-io|g8way/i.test(url);
  }
}

/** IPFS thumbs also hang behind wsrv — load gateways direct. */
export function isIpfsMediaUrl(url: string): boolean {
  url = sanitizeMediaUrl(url);
  if (!url || isLocalOrDataUrl(url)) return false;
  if (url.startsWith('ipfs://')) return true;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/ipfs/')) return true;
    const host = parsed.hostname.toLowerCase();
    // Includes subdomain gateways: {cid}.ipfs.w3s.link / .dweb.link / etc.
    return (
      host === 'ipfs.io' ||
      host.endsWith('.ipfs.io') ||
      host === 'gateway.pinata.cloud' ||
      host.endsWith('.mypinata.cloud') ||
      host === 'nftstorage.link' ||
      host.endsWith('.nftstorage.link') ||
      host === 'dweb.link' ||
      host.endsWith('.dweb.link') ||
      host === 'w3s.link' ||
      host.endsWith('.w3s.link') ||
      host === 'gateway.ipfs.io' ||
      /\.ipfs\./i.test(host)
    );
  } catch {
    return /ipfs|pinata|nftstorage|dweb\.link|w3s\.link/i.test(url);
  }
}

/** True when a "cover" URL is actually a video file (cannot go through image CDNs). */
export function isVideoMediaUrl(url: string): boolean {
  if (!url || isLocalOrDataUrl(url)) return false;
  if (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(url)) return true;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(mp4|webm|mov|m4v)$/.test(path);
  } catch {
    return false;
  }
}

/**
 * Extensionless SeaDN / Nifty / explicit video URLs used as card covers.
 * Cards must not rely on <video preload=metadata> — iOS often never paints a frame.
 */
export function isLikelyTokenVideoCoverUrl(url: string): boolean {
  if (!url || isLocalOrDataUrl(url)) return false;
  // Alchemy Cloudinary transforms embed the origin URL — don't treat stills as video.
  if (/res\.cloudinary\.com\/alchemyapi/i.test(url)) return false;
  if (isVideoMediaUrl(url) || /niftyisland\.com/i.test(url)) return true;
  return (
    /raw2?\.seadn\.io/i.test(url) &&
    !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(url)
  );
}

/** Alchemy Cloudinary still frame from a remote video / Alchemy CDN hash. */
export function getVideoCoverStillUrl(
  url: string,
  size = 360,
  opts?: { assumeVideo?: boolean }
): string | null {
  if (!url || isLocalOrDataUrl(url)) return null;
  // Already a sized still — keep it.
  if (
    /res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(url) &&
    /(?:^|\/|,)(?:f_png|so_0)(?:,|\/|$)/i.test(url)
  ) {
    return /\/w_\d+/.test(url)
      ? url
      : url.replace(
          /(\/video\/fetch\/)/i,
          `$1w_${size},h_${size},c_fill,q_70,`
        );
  }

  const cdn = url.match(/https?:\/\/nft2?-cdn\.alchemy\.com\/[^/?#]+\/[^/?#]+/i)?.[0];
  // Bare Alchemy CDN is usually an image — thumbnailv2. Only video/fetch when
  // caller knows it's a video hash (Coinage / Neybors / SeaDN peer).
  if (
    cdn &&
    (opts?.assumeVideo || isVideoMediaUrl(url) || isLikelyTokenVideoCoverUrl(url))
  ) {
    return `https://res.cloudinary.com/alchemyapi/video/fetch/w_${size},h_${size},c_fill,q_70,f_png,so_0/${cdn}`;
  }

  if (!isLikelyTokenVideoCoverUrl(url) && !isVideoMediaUrl(url)) return null;

  // SeaDN / Nifty / other mp4 — extract frame via Alchemy video/fetch (PNG).
  if (/^https?:\/\//i.test(url)) {
    return `https://res.cloudinary.com/alchemyapi/video/fetch/w_${size},h_${size},c_fill,q_70,f_png,so_0/${url}`;
  }
  return null;
}

/**
 * Card-grid thumbs: always cap decode size.
 * Alchemy assets → Cloudinary thumbnailv2 first (image hashes).
 * Known video covers → video/fetch still (never raw <video> on cards — blank on iOS).
 * Other remotes → wsrv. Never return raw 8k–14k CDN originals.
 */
export function getCardThumbUrl(url: string, size = 360): string {
  url = sanitizeMediaUrl(url);
  if (
    !url ||
    isLocalOrDataUrl(url) ||
    isAlreadyResized(url) ||
    /\.svg(\?|$)/i.test(url) ||
    shouldPreserveAnimation(url)
  ) {
    return url;
  }

  // wsrv cannot fetch ipfs:// (and a leading space made it `url=+ipfs://…`).
  // Load a public gateway directly — same as profile cards with SeaDN stills.
  if (isIpfsMediaUrl(url) || url.startsWith('ipfs://') || url.startsWith('ar://')) {
    return getOptimizedImageUrl(url);
  }

  // Only force video still for known video covers — not every Alchemy CDN hash.
  if (isLikelyTokenVideoCoverUrl(url) || isVideoMediaUrl(url)) {
    const videoStill = getVideoCoverStillUrl(url, size);
    if (videoStill) return videoStill;
  }

  const alchemy = getAlchemyNativeCardThumb(url, size);
  if (alchemy) return alchemy;

  // OpenSea / imgur / SimpleHash already serve browser-reachable stills.
  // wsrv.nl is frequently blocked by those CDNs (hotlink / bot checks).
  if (
    isBrowserFriendlyCdnUrl(url) &&
    !isVideoMediaUrl(url) &&
    !isLikelyTokenVideoCoverUrl(url)
  ) {
    return url;
  }

  let resolved = url;
  const fetchWrapped = url.match(
    /res\.cloudinary\.com\/alchemyapi\/image\/fetch\/[^?]+\/(https?:\/\/\S+)/i
  );
  if (fetchWrapped?.[1]) {
    resolved = fetchWrapped[1];
  }

  if (resolved.startsWith('ipfs://') || resolved.includes('/ipfs/') || resolved.startsWith('ar://')) {
    resolved = getOptimizedImageUrl(resolved);
  }

  const params = new URLSearchParams({
    url: resolved,
    w: String(size),
    h: String(size),
    fit: 'cover',
    q: '65',
    output: 'webp',
    n: '-1',
  });
  return `${THUMB_PROXY}${params.toString()}`;
}

/** Display-sized card thumbnail so grids don't download full Arweave/IPFS originals. */
export function getResizedImageUrl(url: string, size = 360): string {
  if (
    isLocalOrDataUrl(url) ||
    isAlreadyResized(url) ||
    /\.svg(\?|$)/i.test(url) ||
    shouldPreserveAnimation(url) ||
    isBrowserFriendlyCdnUrl(url) ||
    isArweaveMediaUrl(url) ||
    isIpfsMediaUrl(url) ||
    // wsrv/_next/image cannot thumbnail MP4 covers (Nifty Island, etc.)
    isVideoMediaUrl(url)
  ) {
    return url;
  }

  let resolved = url;
  if (url.startsWith('ipfs://') || url.includes('/ipfs/') || url.startsWith('ar://')) {
    resolved = getOptimizedImageUrl(url);
  }

  const params = new URLSearchParams({
    url: resolved,
    w: String(size),
    h: String(size),
    fit: 'cover',
    q: '65',
    output: 'webp',
    n: '-1',
  });
  return `${THUMB_PROXY}${params.toString()}`;
}
