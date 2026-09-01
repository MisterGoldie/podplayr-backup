/**
 * Server-safe OpenSea CDN URL helpers (no React / "use client").
 * Legacy i.seadn.io + openseauserdata.com hosts are NXDOMAIN; OpenSea serves
 * the same bytes from raw2.seadn.io/{chain}/{contract}/{hash.slice(2)}/{hash}.ext
 */

export const unwrapMediaProxyUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('/api/media-proxy?')) return url;
  try {
    const params = new URL(url, 'http://localhost').searchParams.get('url');
    return params || url;
  } catch {
    return url;
  }
};

/** Hosts that no longer resolve (NXDOMAIN / SOA-only). Prefer raw2.seadn.io. */
export const DEAD_OPENSEA_CDN_HOSTS = new Set([
  'i.seadn.io',
  'openseauserdata.com',
  'www.openseauserdata.com',
]);

export const isOpenSeaCdnHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === 'i.seadn.io' ||
    host.endsWith('.seadn.io') ||
    host === 'openseauserdata.com' ||
    host.endsWith('.openseauserdata.com')
  );
};

const openSeaChainSlug = (network?: string): 'ethereum' | 'base' =>
  network === 'base' ? 'base' : 'ethereum';

const SEADN_VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i;
const SEADN_STILL_EXT_RE = /\.(png|jpe?g|gif|webp)(?:\?|#|$)/i;

/** raw2.seadn still poster — often 403 while the token mp4 animation plays fine. */
export const isFragileSeaDnPosterUrl = (url?: string | null): boolean =>
  !!url && /raw2?\.seadn\.io/i.test(url) && SEADN_STILL_EXT_RE.test(url);

/** Token animation is a SeaDN video (Deep Space / OpenSea shared storefront). */
export const nftHasSeaDnVideoAnimation = (nft: {
  metadata?: { animation_url?: string };
  animationUrl?: string;
  videoUrl?: string;
} | null | undefined): boolean => {
  const anim = nft?.metadata?.animation_url || nft?.animationUrl || nft?.videoUrl || '';
  if (!anim || /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(anim)) return false;
  if (!/raw2?\.seadn\.io/i.test(anim)) return false;
  return SEADN_VIDEO_EXT_RE.test(anim) || !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(anim);
};

/**
 * OpenSea migrated CDN paths: legacy i.seadn.io/gcs/files/{hash} and
 * openseauserdata.com/files/{hash} → raw2.seadn.io/{chain}/{contract}/{hash.slice(2)}/{hash}.ext
 */
export const rewriteLegacyOpenSeaMediaUrl = (
  url: string,
  contract?: string | null,
  network?: string
): string => {
  if (!url || !contract) return url;
  try {
    const source = unwrapMediaProxyUrl(url);
    const u = new URL(source);
    const host = u.hostname.toLowerCase();
    if (host === 'raw2.seadn.io' || host === 'raw.seadn.io') return source;

    let hash = '';
    let ext = '';
    const gcs = u.pathname.match(/\/gcs\/files\/([a-f0-9]+)\.([a-z0-9]+)/i);
    const files = u.pathname.match(/\/files\/([a-f0-9]+)\.([a-z0-9]+)/i);
    if (gcs) {
      hash = gcs[1];
      ext = gcs[2];
    } else if (
      files &&
      (DEAD_OPENSEA_CDN_HOSTS.has(host) ||
        host.endsWith('.seadn.io') ||
        host.includes('openseauserdata'))
    ) {
      hash = files[1];
      ext = files[2];
    } else {
      return source;
    }
    if (hash.length < 4) return source;
    const chain = openSeaChainSlug(network);
    return `https://raw2.seadn.io/${chain}/${contract.toLowerCase()}/${hash.slice(2)}/${hash}.${ext}`;
  } catch {
    return url;
  }
};

/**
 * Same-origin proxy for dead OpenSea CDN hosts that still appear in metadata.
 * Live hosts (raw2.seadn.io) are left alone — they resolve in mini-apps.
 */
export const toOpenSeaProxyUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('/api/media-proxy?')) return url;
  if (typeof window === 'undefined') return url;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!DEAD_OPENSEA_CDN_HOSTS.has(host)) return url;
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
};

/**
 * Same-origin fetch for any OpenSea CDN still (including live raw2.seadn.io).
 * Third-party thumb proxies (wsrv) are often blocked; the browser can also
 * fail hotlink checks. Our media-proxy uses a server User-Agent.
 */
export const toOpenSeaCdnProxyUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('/api/media-proxy?')) return url;
  try {
    const source = unwrapMediaProxyUrl(url);
    const host = new URL(source).hostname.toLowerCase();
    if (!isOpenSeaCdnHost(host)) return url;
    return `/api/media-proxy?url=${encodeURIComponent(source)}`;
  } catch {
    return url;
  }
};

export const preferBrowserReachableMediaUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith('/api/media-proxy?') || url.includes('/api/media-proxy?')) return url;
  return toOpenSeaProxyUrl(url);
};

/** Candidate srcs for Farcaster/NFT profile images that often 500 via /_next/image. */
export function profileImageSrcChain(url?: string | null): string[] {
  if (!url || typeof url !== 'string') return ['/default-avatar.png'];
  if (url.startsWith('/')) return [url];

  const chain: string[] = [];
  const push = (next: string) => {
    if (next && !chain.includes(next)) chain.push(next);
  };

  try {
    const parsed = new URL(unwrapMediaProxyUrl(url));
    const host = parsed.hostname.toLowerCase();
    parsed.search = '';
    const noQuery = parsed.toString();

    if (host === 'i.seadn.io') {
      parsed.hostname = 'i2.seadn.io';
      push(parsed.toString());
      push(`/api/media-proxy?url=${encodeURIComponent(parsed.toString())}`);
    } else if (host === 'openseauserdata.com' || host === 'www.openseauserdata.com') {
      const file = parsed.pathname.match(/\/files\/([a-f0-9]+\.[a-z0-9]+)/i);
      if (file) push(`https://i2.seadn.io/gcs/files/${file[1]}`);
      push(toOpenSeaProxyUrl(url));
    }

    push(noQuery);
    if (url !== noQuery) push(url);
  } catch {
    push(url);
  }

  push('/default-avatar.png');
  return chain;
}
