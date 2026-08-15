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
  if (!url) return '';
  
  // Don't try to optimize data URLs or relative URLs
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

  // For IPFS URLs: use a working gateway (cloudflare-ipfs.com DNS is dead)
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
  return url.includes('wsrv.nl') || url.includes('images.weserv.nl') || url.includes('img-width=');
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
