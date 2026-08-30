import type { NFT } from '../types/user';
import { pickImageCandidates, sanitizeMediaUrl, looksLikeStillImageUrl } from './media';
import {
  alchemyCoverIsPlaybackVideo,
  getCardThumbUrl,
  getVideoCoverStillUrl,
  isLikelyTokenVideoCoverUrl,
  isVideoMediaUrl,
  parseAlchemyCdnRef,
} from './imageOptimizer';

/**
 * TEMP IMAGE / COVER DEBUG — remove after card-thumb issues are fixed.
 *
 * Off for now. Force on: window.__PODPLAYR_IMAGE_DEBUG = true
 * Filter DevTools console by: IMAGE DEBUG
 */
export const IMAGE_DEBUG_ENABLED = false;

const PREFIX = '[IMAGE DEBUG — REMOVE]';

declare global {
  interface Window {
    __PODPLAYR_IMAGE_DEBUG?: boolean;
  }
}

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__PODPLAYR_IMAGE_DEBUG === true) return true;
  if (window.__PODPLAYR_IMAGE_DEBUG === false) return false;
  return IMAGE_DEBUG_ENABLED;
}

function shortUrl(url?: string | null, max = 120): string {
  if (!url) return '';
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

function classifyUrl(url?: string | null): string {
  if (!url) return 'empty';
  if (url.includes('default-nft.png')) return 'fallback-png';
  if (/thumbnailv2/i.test(url)) return 'alchemy-thumbnailv2';
  if (/alchemyapi\/video\/fetch/i.test(url)) return 'alchemy-video-fetch';
  if (/alchemyapi\/image\/(?:fetch|upload)/i.test(url)) return 'alchemy-image-transform';
  if (/nft2?-cdn\.alchemy\.com/i.test(url)) return 'alchemy-cdn';
  if (/wsrv\.nl|images\.weserv\.nl/i.test(url)) return 'wsrv';
  if (/i2c\.seadn|openseauserdata/i.test(url)) return 'opensea-still';
  if (/raw2?\.seadn/i.test(url)) return 'seadn-raw';
  if (/\/ipfs\/|ipfs:\/\//i.test(url)) return 'ipfs';
  if (/ar:\/\/|arweave\.net/i.test(url)) return 'arweave';
  if (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(url)) return 'video-file';
  if (/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(url)) return 'image-file';
  return 'other';
}

export function imageDebug(event: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  console.log(PREFIX, event, data ?? '');
}

/** Dump cover fields + candidates when an NFT card is clicked / inspected. */
export function logNftCoverDebug(
  nft: NFT,
  reason: 'click' | 'mount' | 'error' | 'resolve' = 'click'
): void {
  if (!isEnabled()) return;

  const candidates = pickImageCandidates(nft);
  const coverHash = parseAlchemyCdnRef(nft.image || nft.metadata?.image || '');
  const playHashes = [
    nft.audio,
    nft.videoUrl,
    nft.animationUrl,
    nft.metadata?.animation_url,
  ]
    .map((u) => parseAlchemyCdnRef(u || ''))
    .filter(Boolean);

  const size = 360;
  const alchemyPeer = [
    nft.audio,
    nft.metadata?.animation_url,
    nft.animationUrl,
    nft.videoUrl,
    nft.image,
    nft.metadata?.image,
  ].find((u) => !!u && /nft2?-cdn\.alchemy\.com/i.test(String(u))) as string | undefined;

  const coverIsPlaybackVideo = alchemyCoverIsPlaybackVideo(nft);
  const primary = sanitizeMediaUrl(nft.image || nft.metadata?.image || '') || '';
  const plannedThumb = coverIsPlaybackVideo
    ? getVideoCoverStillUrl(alchemyPeer || primary, size, { assumeVideo: true }) ||
      getCardThumbUrl(primary, size, { preferVideoStill: true })
    : getCardThumbUrl(primary, size);

  const summary = {
    reason,
    name: nft.name,
    contract: nft.contract,
    tokenId: nft.tokenId,
    network: nft.network,
    coverIsPlaybackVideo,
    primaryKind: classifyUrl(primary),
    plannedThumbKind: classifyUrl(plannedThumb),
    primary: shortUrl(primary),
    plannedThumb: shortUrl(plannedThumb),
    alchemyPeer: shortUrl(alchemyPeer),
    coverHash: coverHash ? `${coverHash.network}/${coverHash.hash}` : null,
    playHashes: playHashes.map((p) => (p ? `${p.network}/${p.hash}` : null)),
    collectionImage: shortUrl(nft.collection?.image),
    candidates: candidates.slice(0, 8).map((u) => ({
      kind: classifyUrl(u),
      still: looksLikeStillImageUrl(u),
      video: isVideoMediaUrl(u) || isLikelyTokenVideoCoverUrl(u),
      url: shortUrl(u),
    })),
  };

  const label = `${PREFIX} cover:${reason} ${nft.name || 'untitled'} ${nft.contract?.slice(0, 10)}…#${nft.tokenId}`;
  console.log(label, summary);
  console.groupCollapsed(`${label} details`);
  console.log('urls', {
    image: nft.image,
    metaImage: nft.metadata?.image,
    metaImageUrl: nft.metadata?.image_url,
    audio: nft.audio,
    videoUrl: nft.videoUrl,
    animationUrl: nft.animationUrl,
    metaAnimation: nft.metadata?.animation_url,
    collection: nft.collection?.image,
  });
  console.log('planned', {
    coverIsPlaybackVideo,
    alchemyPeer,
    primary,
    plannedThumb,
  });
  console.log('candidates (full)', candidates);
  console.groupEnd();
}

export function imageDebugUrlKind(url?: string | null): string {
  return classifyUrl(url);
}
