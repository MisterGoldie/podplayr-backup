import type { NFT, NFTMetadata } from '../types/user';
import { Alchemy, Network } from 'alchemy-sdk';
import { createHash } from 'crypto';
import { rewriteLegacyOpenSeaMediaUrl, nftHasSeaDnVideoAnimation, isFragileSeaDnPosterUrl } from '../utils/openSeaMedia';
import {
  hasPlayableAudio,
  isPlayableMediaNFT,
  getNftPlaybackPlan,
} from '../utils/isMediaNFT';
import { isBlockedNftContract, isDangerousResourceUrl, isPhishingSpamNft } from '../utils/nftSafety';
import { isPollutedPlaybackUrl, isMezzanineMuxUrl, isWeakPlaybackUrl } from './mediaCdn';
import { isCuratedFeaturedCover } from '../data/featuredNfts';
import { getOpenSeaNftMedia } from './opensea';
import { getCachedNftCover, setCachedNftCover } from './nftCoverCache';
import { getCachedNftResponse, setCachedNftResponse } from './nftResponseCache';
import { getCachedAnimationProbe, setCachedAnimationProbe } from './nftAnimationProbeCache';

const PINATA_IPFS = 'https://gateway.pinata.cloud/ipfs/';

/** Server-safe URL rewrite — do not import processMediaUrl (client module). */
function processMediaUrlServer(
  url: string,
  _fallback: string = '',
  _mediaType: 'image' | 'audio' | 'metadata' = 'image'
): string {
  if (!url || typeof url !== 'string') return '';
  url = url.replace(/^[\s\x00-\x1f\x7f]+|[\s\x00-\x1f\x7f]+$/g, '');
  if (!url || isDangerousResourceUrl(url)) return '';
  if (url.startsWith('ipfs://')) {
    return `${PINATA_IPFS}${url.slice(7).replace(/^ipfs\//, '')}`;
  }
  if (url.startsWith('ar://')) {
    return `https://arweave.net/${url.slice(5)}`;
  }
  return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
}

/** Server-safe URL rewrite. `processMediaUrl` lives in a client module and throws in API routes. */
function normalizeOwnedNftUrl(url: string): string {
  return processMediaUrlServer(url);
}

function ownedNftMediaKey(contract: string, tokenId: string): string {
  const normalizedTokenId = tokenId?.toString().replace(/^0x+/, '0x') || '';
  return createHash('sha256')
    .update(`${contract}-${normalizedTokenId}`)
    .digest('hex')
    .substring(0, 32);
}

const AUDIO_OR_VIDEO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)(?:\?|#|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i;

/**
 * Alchemy's own async mirror-upload for huge animations (podcast-length
 * video, 500MB+) can still be in flight when its metadata API responds —
 * `animation.size`/`contentType` come back null in that window, so
 * isBrokenAlchemyAnimationCache() below (which only catches broken caches
 * when Alchemy *does* report a small size) can't see it. cachedUrl then
 * serves a tiny stub like {"keyName":...,"partialUpload":true,"bytes":...}
 * mislabeled `Content-Type: video/mp4`, which <video>/<audio> reject with
 * NotSupportedError. A cheap HEAD reveals the real Content-Length regardless
 * of what Alchemy's metadata claims. Only called when size is missing (real
 * animations almost always report one), and the result gets folded into the
 * Redis-cached NFT response, so this is at most one extra request ever per
 * token. Fails open (null) on any error/timeout so a probe hiccup never
 * breaks an animation that was already working.
 */
async function probeAlchemyCachedAnimationSize(url?: string): Promise<number | null> {
  if (!url || !/_animation(?:\?|#|$)/i.test(url)) return null;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    const len = Number(res.headers.get('content-length'));
    return Number.isFinite(len) && len >= 0 ? len : null;
  } catch {
    return null;
  }
}

/**
 * Alchemy's classification pipeline for a still-uploading animation leaves
 * contentType null in the same window it leaves size null — once the size
 * probe above confirms the cache is genuinely broken, that also means we
 * can't trust Alchemy's (missing) opinion on whether the token is video or
 * audio. Recover it directly from the real origin (IPFS/Arweave, rewritten
 * to an https gateway) instead, so a filmed session doesn't get silently
 * downgraded to audio-only just because Alchemy never finished mirroring it.
 * Fails open (null) on any error/timeout.
 */
async function probeOriginAnimationContentType(originalUrl?: string): Promise<string | null> {
  if (!originalUrl) return null;
  // originalUrl is often already an `https://ipfs.io/ipfs/<cid>` URL, not the
  // `ipfs://` scheme processMediaUrlServer rewrites — and ipfs.io is slow
  // enough to reliably blow the probe's timeout (confirmed: >15s to fail a
  // HEAD). Re-host on Pinata regardless of which gateway/scheme it arrived
  // in so the probe actually gets an answer within budget.
  const ipfsMatch = originalUrl.match(/\/ipfs\/([^?#]+)/i);
  const httpUrl = originalUrl.startsWith('ipfs://')
    ? `${PINATA_IPFS}${originalUrl.slice(7).replace(/^ipfs\//, '')}`
    : ipfsMatch
      ? `${PINATA_IPFS}${ipfsMatch[1]}`
      : originalUrl;
  if (!/^https?:\/\//i.test(httpUrl)) return null;
  try {
    // A HEAD against a huge, rarely-accessed pinned file still needs Pinata's
    // backend to touch the IPFS network before it can answer — observed
    // 1-4s+ even for a plain HEAD, notably slower than the tiny Alchemy stub
    // probe above, so this gets a longer budget.
    const res = await fetch(httpUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return type || null;
  } catch {
    return null;
  }
}

/**
 * Alchemy sometimes "caches" Arweave/IPFS videos as a tiny broken HLS playlist
 * (contentType application/x-mpegURL, partialUpload, ~128 bytes) OR as a
 * stream.mux.com URL that is NOT one of our PLAYBACK_OVERRIDES. Prefer the
 * real mp4 / ar:// origin instead — never emit orphan Mux from the mapper.
 */
function isBrokenAlchemyAnimationCache(
  animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string; size?: number } | null
): boolean {
  if (!animation?.cachedUrl) return false;
  const type = (animation.contentType || '').toLowerCase();
  if (type.includes('mpegurl') || type === 'application/x-mpegurl') return true;
  if (/\.m3u8(?:\?|#|$)/i.test(animation.cachedUrl)) return true;
  if (isPollutedPlaybackUrl(animation.cachedUrl)) return true;
  // Partial HLS stubs are tiny; real mp4 caches are much larger.
  if (
    typeof animation.size === 'number' &&
    animation.size > 0 &&
    animation.size < 2048 &&
    /_animation(?:\?|#|$)/i.test(animation.cachedUrl)
  ) {
    return true;
  }
  return false;
}

function isUsableOriginPlaybackUrl(url?: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u) return false;
  // Never play orphan stream.mux.com HLS (only PLAYBACK_OVERRIDES may).
  if (isPollutedPlaybackUrl(u)) return false;
  if (/\.m3u8(?:\?|#|$)/i.test(u) && !/stream\.mux\.com/i.test(u)) return false;
  return true;
}

export function isIpfsPlaybackUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return (
    url.startsWith('ipfs://') ||
    /\/ipfs\//i.test(url) ||
    /\.ipfs\./i.test(url)
  );
}

function isAlchemyCdnPlaybackUrl(url?: string | null): boolean {
  return !!url && /nft2?-cdn\.alchemy\.com/i.test(url);
}

/** Alchemy `_animation` caches are video/mp4 even when contentType is missing. */
function alchemyAnimationLooksLikeVideo(
  animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string; size?: number } | null
): boolean {
  const type = (animation?.contentType || '').toLowerCase();
  if (type.startsWith('video/')) return true;
  const cached = (animation?.cachedUrl || '').trim();
  if (!cached || isBrokenAlchemyAnimationCache(animation)) return false;
  if (/nft2?-cdn\.alchemy\.com\/[^?\s]+_animation(?:\?|#|$)/i.test(cached)) return true;
  if (typeof animation?.size === 'number' && animation.size > 2048 && /_animation/i.test(cached)) {
    return true;
  }
  return false;
}

/** Best playback URL from Alchemy animation fields + on-chain metadata. */
function pickAlchemyAnimationPlaybackUrl(
  animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string; size?: number } | null,
  metaAnimationUrl?: string | null,
  extraOrigins: Array<string | null | undefined> = []
): string {
  const origins = [
    metaAnimationUrl,
    animation?.originalUrl,
    ...extraOrigins,
  ]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(isUsableOriginPlaybackUrl);

  // Prefer durable on-chain Arweave when present.
  const arOrigin = origins.find(
    (u) => u.startsWith('ar://') || /arweave\.net\//i.test(u)
  );
  if (arOrigin) return arOrigin;

  const cached = (animation?.cachedUrl || '').trim();
  const type = (animation?.contentType || '').toLowerCase();
  const cachedIsVideo = alchemyAnimationLooksLikeVideo(animation);

  // Real Alchemy CDN video bytes beat IPFS gateways (CORS/429 in mini-apps) and
  // signed mezzanine URLs (signatures expire → 403).
  if (
    !isBrokenAlchemyAnimationCache(animation) &&
    isUsableOriginPlaybackUrl(cached) &&
    cachedIsVideo &&
    !isWeakPlaybackUrl(cached)
  ) {
    return cached;
  }

  // Strong https only — skip IPFS; public gateways fail from browser origins.
  const httpsOrigin = origins.find(
    (u) =>
      /^https?:\/\//i.test(u) &&
      !isWeakPlaybackUrl(u) &&
      !isIpfsPlaybackUrl(u)
  );
  if (httpsOrigin) return httpsOrigin;

  if (isBrokenAlchemyAnimationCache(animation) || !isUsableOriginPlaybackUrl(cached)) {
    return '';
  }
  if (cachedIsVideo && !isWeakPlaybackUrl(cached)) {
    return cached;
  }
  return '';
}

type AlchemyImageFields = {
  cachedUrl?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  pngUrl?: string;
  contentType?: string;
  size?: number;
};

/** True when a URL is usable as a still/animated cover (not audio/video bytes). */
function looksLikeVisualCoverUrl(url?: string | null, contentType?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const type = (contentType || '').toLowerCase();
  if (type.startsWith('audio/') || type.startsWith('video/')) return false;
  if (AUDIO_OR_VIDEO_EXT_RE.test(url)) return false;
  if (type.startsWith('image/') || type.includes('svg')) return true;
  if (IMAGE_EXT_RE.test(url)) return true;
  // Alchemy CDN often omits extensions. Reject only when typed as audio/video
  // (handled above). Empty contentType is allowed — many Seasoning-style stills
  // are real images; broken audio hashes fail at <img> and fall back then.
  if (/nft2?-cdn\.alchemy\.com/i.test(url)) {
    return !type || type.startsWith('image/') || type.includes('svg');
  }
  if (/seadn\.io|openseauserdata\.com|i2c\.seadn|cloudinary\.com/i.test(url)) {
    return !type || type.startsWith('image/') || !type.includes('audio');
  }
  if (/\/ipfs\//i.test(url) || url.startsWith('ipfs://')) {
    return type.startsWith('image/') || IMAGE_EXT_RE.test(url);
  }
  return Boolean(type.startsWith('image/') || !type);
}

function pickDurableVideoCover(
  videoFallbacks?: Array<string | null | undefined> | null,
  skipUrl?: string
): string {
  for (const raw of videoFallbacks || []) {
    if (!raw || typeof raw !== 'string' || raw === skipUrl) continue;
    // Real video files / Nifty Island only — NOT OpenSea i2c collection stills.
    const isVideoExt = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(raw);
    const isNifty = /niftyisland\.com/i.test(raw);
    const isRawSeadnVideo =
      /raw2?\.seadn\.io/i.test(raw) &&
      (isVideoExt || !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(raw));
    if (!isVideoExt && !isNifty && !isRawSeadnVideo) continue;
    if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(raw)) continue;
    if (/\/ipfs\//i.test(raw) || raw.startsWith('ipfs://') || /\.ipfs\./i.test(raw)) continue;
    return raw;
  }
  return '';
}

/**
 * Pick a visual cover from Alchemy image fields. Food / audio NFTs often put the
 * MP3 on image.cachedUrl — prefer thumbnailUrl/pngUrl/collection art instead.
 * Never prefer unreplicated IPFS over OpenSea/Alchemy/collection CDNs.
 */
function pickAlchemyVisualCover(opts: {
  image?: AlchemyImageFields | null;
  media?: Array<{ gateway?: string; raw?: string; format?: string }> | null;
  metaImage?: string | null;
  metaImageUrl?: string | null;
  files?: Array<{ uri?: string; url?: string; type?: string; mimeType?: string }> | null;
  collectionImage?: string | null;
  /** Last-resort card cover when the token is video-only (Nifty Island, Food videos). */
  videoFallbacks?: Array<string | null | undefined> | null;
}): { cover: string; audioFromImage: string } {
  const img = opts.image;
  const type = (img?.contentType || '').toLowerCase();
  const isAudioOrVideoType = type.startsWith('audio/') || type.startsWith('video/');
  const audioFromImage = type.startsWith('audio/') ? img?.cachedUrl || '' : '';

  // Confirmed stills. Prefer thumbnail/png; include Alchemy cachedUrl only when
  // not typed as audio/video. Collection art is LAST so it never replaces
  // unique Alchemy token stills (Seasoning / Relic / etc.).
  //
  // IMPORTANT: never coerce thumbnailUrl to image/jpeg when contentType is
  // audio/video — Food/Conflicted Alchemy hashes are video/mp4 and that bug
  // made us treat the video CDN URL as a still (broken <img>).
  const confirmed: Array<{ url?: string; contentType?: string }> = [];
  if (!isAudioOrVideoType) {
    confirmed.push({
      url: img?.thumbnailUrl,
      contentType: img?.contentType?.startsWith('image/') ? img.contentType : 'image/jpeg',
    });
  }
  // pngUrl is usually a real still even when cachedUrl is video/audio.
  if (img?.pngUrl) {
    confirmed.push({ url: img.pngUrl, contentType: 'image/png' });
  }
  // cachedUrl / originalUrl as stills only when not audio/video contentType
  if (!isAudioOrVideoType) {
    confirmed.push({ url: img?.cachedUrl, contentType: img?.contentType || 'image/*' });
    confirmed.push({ url: img?.originalUrl, contentType: img?.contentType || 'image/*' });
  }

  for (const m of opts.media || []) {
    const format = (m.format || '').toLowerCase();
    if (format.includes('audio') || format.includes('mp3')) {
      continue;
    }
    if (format.includes('video') || format.includes('mp4') || format.includes('webm')) {
      continue;
    }
    confirmed.push({
      url: m.gateway || m.raw,
      contentType: format.includes('image') || format ? `image/${format}` : undefined,
    });
  }

  confirmed.push({ url: opts.metaImageUrl || undefined });
  confirmed.push({ url: opts.metaImage || undefined });

  for (const f of opts.files || []) {
    const u = f?.uri || f?.url;
    const t = (f?.type || f?.mimeType || '').toLowerCase();
    if (!u) continue;
    if (t.startsWith('image/') || IMAGE_EXT_RE.test(u)) {
      confirmed.push({ url: u, contentType: t || 'image/*' });
    }
  }

  // Collection last — shared OpenSea art must not beat token Alchemy stills.
  const collectionCandidate = opts.collectionImage
    ? [{ url: opts.collectionImage, contentType: 'image/*' }]
    : [];

  const durableConfirmed: string[] = [];
  const ipfsStills: string[] = [];
  for (const c of [...confirmed, ...collectionCandidate]) {
    if (!looksLikeVisualCoverUrl(c.url, c.contentType)) continue;
    const url = c.url as string;
    // Skip collection URLs until after token stills are collected.
    const isCollection = url === opts.collectionImage;
    if (isCollection) continue;
    if (/\/ipfs\//i.test(url) || url.startsWith('ipfs://') || /\.ipfs\./i.test(url)) {
      ipfsStills.push(url);
    } else {
      durableConfirmed.push(url);
    }
  }

  const videoCover = pickDurableVideoCover(
    opts.videoFallbacks,
    type.startsWith('audio/') ? img?.cachedUrl : undefined
  );
  // Unique per-token Alchemy CDN video works as a <video> card cover.
  const alchemyVideoCover =
    type.startsWith('video/') && img?.cachedUrl && /nft2?-cdn\.alchemy\.com/i.test(img.cachedUrl)
      ? img.cachedUrl
      : '';

  if (durableConfirmed.length > 0) {
    const first = durableConfirmed[0];
    const firstIsAlchemy = /nft2?-cdn\.alchemy\.com/i.test(first);
    // Only swap Alchemy → token video when Alchemy field is known audio/video.
    if (videoCover && firstIsAlchemy && isAudioOrVideoType) {
      return { cover: videoCover, audioFromImage };
    }
    return { cover: first, audioFromImage };
  }

  // Prefer unique Alchemy video CDN over shared SeaDN when that's the token media.
  if (alchemyVideoCover) {
    return { cover: alchemyVideoCover, audioFromImage };
  }

  if (videoCover) {
    return { cover: videoCover, audioFromImage };
  }

  // Collection art only when no token still / video.
  if (opts.collectionImage && looksLikeVisualCoverUrl(opts.collectionImage, 'image/*')) {
    const coll = opts.collectionImage;
    if (!/\/ipfs\//i.test(coll) && !coll.startsWith('ipfs://')) {
      return { cover: coll, audioFromImage };
    }
  }

  if (ipfsStills.length > 0) {
    return { cover: ipfsStills[0], audioFromImage };
  }

  return { cover: '', audioFromImage };
}

// Initialize Alchemy clients for both networks
const ethAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET
});

const baseAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET
});

/** Decode ABI-encoded string from eth_call result. */
function decodeEthCallString(result: string): string {
  const hex = result.startsWith('0x') ? result.slice(2) : result;
  if (hex.length < 128) return '';
  const len = parseInt(hex.slice(64, 128), 16);
  if (!Number.isFinite(len) || len <= 0 || len > 2048) return '';
  const dataHex = hex.slice(128, 128 + len * 2);
  if (dataHex.length < len * 2) return '';
  const bytes = Buffer.from(dataHex, 'hex');
  return bytes.toString('utf8').replace(/\0/g, '').trim();
}

/**
 * Read ERC-1155 `uri(uint256)` or ERC-721 `tokenURI(uint256)` when Alchemy's
 * animation cache has been rewritten to orphan Mux / broken HLS.
 */
async function readContractTokenMetadataUri(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum'
): Promise<string> {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (!key) return '';
  const rpc =
    network === 'base'
      ? `https://base-mainnet.g.alchemy.com/v2/${key}`
      : `https://eth-mainnet.g.alchemy.com/v2/${key}`;
  let idHex: string;
  try {
    idHex = BigInt(tokenId.startsWith('0x') ? tokenId : tokenId).toString(16).padStart(64, '0');
  } catch {
    return '';
  }
  // ERC-1155 uri(uint256) first — stay-in-tune journals are 1155.
  for (const selector of ['0x0e89341c', '0xc87b56dd'] as const) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: contract, data: `${selector}${idHex}` }, 'latest'],
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: string };
      if (!json.result || json.result === '0x') continue;
      const uri = decodeEthCallString(json.result);
      if (uri) return uri;
    } catch {
      // try next selector
    }
  }
  return '';
}

async function fetchJsonMetadataFromUri(uri: string): Promise<Partial<NFTMetadata> | null> {
  const url = processMediaUrlServer(uri, '', 'metadata');
  if (!url || isDangerousResourceUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<NFTMetadata>;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** Alchemy only accepts a 20-byte address + uint256 token id. */
export function isOnChainNftIdentity(
  contract?: string | null,
  tokenId?: string | number | null
): boolean {
  const c = (contract || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(c)) return false;
  const t = String(tokenId ?? '').trim();
  if (!t || /0x0x/i.test(t)) return false;
  if (/^\d+$/.test(t)) return true;
  if (/^0x[0-9a-fA-F]+$/.test(t)) {
    try {
      BigInt(t);
      return true;
    } catch {
      return false;
    }
  }
  if (/^[0-9a-fA-F]+$/.test(t)) {
    try {
      BigInt(`0x${t}`);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function alchemyTokenIdCandidates(tokenId: string): string[] {
  const t = tokenId.trim();
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  if (/^\d+$/.test(t)) {
    push(t);
    return out;
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) {
    try {
      push(BigInt(t).toString());
    } catch {
      // skip
    }
    push(t);
    return out;
  }
  if (/^[0-9a-fA-F]+$/.test(t)) {
    try {
      push(BigInt(`0x${t}`).toString());
    } catch {
      // skip
    }
    push(`0x${t}`);
  }
  return out;
}

export const getNFTMetadata = async (contract: string, tokenId: string, network: 'base' | 'ethereum' = 'ethereum'): Promise<NFT> => {
  try {
    if (!isOnChainNftIdentity(contract, tokenId)) {
      throw new Error('Invalid NFT identity');
    }

    // The base Alchemy fetch + on-chain fallback below is the real cost
    // driver (2-9s per token) — skip it entirely on repeat requests for
    // tokens we've already durably resolved with no fragile playback fields.
    const cachedFullResponse = await getCachedNftResponse(contract, tokenId, network);
    if (cachedFullResponse) {
      console.log(`[podplayr:redis] full-nft cache HIT — skipping Alchemy/chain fetch entirely`, {
        contract,
        tokenId,
        network,
      });
      return cachedFullResponse;
    }

    const client = network === 'base' ? baseAlchemy : ethAlchemy;
    const tokenIdFormats = alchemyTokenIdCandidates(tokenId);
    if (tokenIdFormats.length === 0) {
      throw new Error('Invalid NFT identity');
    }
    
    let metadata;
    let lastError;
    
    // Try each tokenId format until one works
    for (const testTokenId of tokenIdFormats) {
      try {
        metadata = await client.nft.getNftMetadata(contract, testTokenId);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    
    if (!metadata) {
      throw lastError || new Error('Failed to fetch metadata with any tokenId format');
    }

    const rawMeta = (metadata.raw.metadata || {}) as NFTMetadata;
    const alchemyImage = metadata as {
      image?: AlchemyImageFields;
      animation?: AlchemyImageFields;
    };
    // See probeAlchemyCachedAnimationSize — stamping the real size here lets
    // every isBrokenAlchemyAnimationCache() check below (there are several)
    // correctly treat a still-uploading animation as broken for free. Tokens
    // stuck in this state keep IPFS/Pinata playback, which makes the overall
    // response too fragile for setCachedNftResponse below to durably cache
    // (see nftNeedsChainMediaEnrich) — so this verdict gets its own small,
    // independent cache to avoid re-probing on every single play/enrich call.
    if (alchemyImage.animation && typeof alchemyImage.animation.size !== 'number') {
      const cacheableUrl = alchemyImage.animation.cachedUrl;
      const cachedVerdict = cacheableUrl ? await getCachedAnimationProbe(cacheableUrl) : null;
      if (cachedVerdict) {
        alchemyImage.animation.size = cachedVerdict.size;
        if (cachedVerdict.contentType) {
          alchemyImage.animation.contentType = cachedVerdict.contentType;
        }
      } else {
        const realSize = await probeAlchemyCachedAnimationSize(alchemyImage.animation.cachedUrl);
        if (realSize !== null) {
          alchemyImage.animation.size = realSize;
        }
        // Confirmed broken + Alchemy never classified it either (contentType
        // null) — recover the real type from the origin so this doesn't fall
        // back to audio-only just because Alchemy's pipeline stalled.
        if (realSize !== null && realSize < 2048 && !alchemyImage.animation.contentType) {
          const realType = await probeOriginAnimationContentType(alchemyImage.animation.originalUrl);
          if (realType) {
            alchemyImage.animation.contentType = realType;
          }
        }
        if (realSize !== null && cacheableUrl) {
          await setCachedAnimationProbe(cacheableUrl, {
            size: realSize,
            contentType: alchemyImage.animation.contentType || null,
          });
        }
      }
    }
    const collectionOpenSeaImage =
      metadata.contract?.openSeaMetadata?.imageUrl || '';
    const { cover: alchemyVisualCover, audioFromImage: alchemyImageAsAudio } =
      pickAlchemyVisualCover({
        image: alchemyImage.image,
        metaImage: rawMeta.image,
        metaImageUrl: rawMeta.image_url,
        files: rawMeta.properties?.files,
        collectionImage: collectionOpenSeaImage,
        videoFallbacks: [
          alchemyImage.animation?.originalUrl,
          rawMeta.animation_url,
          // Only use cachedUrl when it isn't a broken HLS stub.
          isBrokenAlchemyAnimationCache(alchemyImage.animation)
            ? undefined
            : alchemyImage.animation?.cachedUrl,
          rawMeta.image,
          alchemyImage.image?.cachedUrl,
        ],
      });
    const alchemyImageCached = alchemyVisualCover;
    const brokenAnimCache = isBrokenAlchemyAnimationCache(alchemyImage.animation);
    const alchemyAnimCached = brokenAnimCache
      ? ''
      : alchemyImage.animation?.cachedUrl || '';
    const alchemyAnimOriginal = alchemyImage.animation?.originalUrl || '';
    const alchemyAnimTypeRaw = (alchemyImage.animation?.contentType || '').toLowerCase();
    // Broken HLS stubs report x-mpegURL — treat Arweave/mp4 origins as video/mp4.
    const contentMime = String(
      rawMeta.content?.mime ||
        rawMeta.mimeType ||
        rawMeta.mime_type ||
        ''
    ).toLowerCase();
    const alchemyAnimType = brokenAnimCache
      ? (
          contentMime.startsWith('video/') ||
          /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(alchemyAnimOriginal) ||
          /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(rawMeta.animation_url || '') ||
          (rawMeta.animation_url || '').startsWith('ar://') ||
          (rawMeta.content?.uri || '').startsWith('ar://')
            ? 'video/mp4'
            : contentMime
        )
      : alchemyAnimTypeRaw;

    const contentUri = rawMeta.content?.uri || '';
    const fileVideo =
      (rawMeta.properties?.files || []).find((f) => {
        const t = (f?.type || f?.mimeType || '').toLowerCase();
        const u = f?.uri || f?.url || '';
        return t.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u);
      });
    const fileVideoUri = fileVideo?.uri || fileVideo?.url || '';

    const imageVideoType = (alchemyImage.image?.contentType || '').toLowerCase();
    const videoFromImage =
      imageVideoType.startsWith('video/')
        ? [
            alchemyImage.image?.originalUrl,
            rawMeta.display_image_url,
            rawMeta.image_url,
            alchemyImage.image?.cachedUrl,
          ].find((u) => u && isUsableOriginPlaybackUrl(u) && !isWeakPlaybackUrl(u)) || ''
        : '';
    let alchemyAnimation =
      pickAlchemyAnimationPlaybackUrl(alchemyImage.animation, rawMeta.animation_url, [
        contentUri,
        fileVideoUri,
        rawMeta.properties?.video,
        rawMeta.properties?.animation_url,
        // Only the video-typed image origin — never a JPEG display_image_url.
        videoFromImage,
      ]) ||
      (isUsableOriginPlaybackUrl(alchemyImageAsAudio) ? alchemyImageAsAudio : '') ||
      videoFromImage ||
      '';

    // Prefer on-chain Arweave when Alchemy only has Mux mezzanine / empty.
    // stay-in-tune journals are ERC-1155; uri(tokenId) → Arweave JSON.
    let effectiveMeta: NFTMetadata = rawMeta;
    const needsChainOrigin =
      !alchemyAnimation ||
      isMezzanineMuxUrl(alchemyAnimation) ||
      isPollutedPlaybackUrl(alchemyAnimation);
    if (needsChainOrigin) {
      const tokenMetaUri = await readContractTokenMetadataUri(
        contract,
        metadata.tokenId?.toString?.() || tokenId,
        network
      );
      const chainMeta = tokenMetaUri ? await fetchJsonMetadataFromUri(tokenMetaUri) : null;
      if (chainMeta) {
        const chainPlayback =
          pickAlchemyAnimationPlaybackUrl(null, chainMeta.animation_url, [
            chainMeta.content?.uri,
            chainMeta.properties?.video,
            chainMeta.properties?.animation_url,
          ]) || '';
        // Upgrade only when chain publishes a durable origin (ar://), not expired mezzanine.
        if (
          chainPlayback &&
          !isWeakPlaybackUrl(chainPlayback) &&
          (chainPlayback.startsWith('ar://') ||
            /arweave\.net\//i.test(chainPlayback) ||
            !alchemyAnimation ||
            isPollutedPlaybackUrl(alchemyAnimation))
        ) {
          effectiveMeta = { ...rawMeta, ...chainMeta };
          alchemyAnimation = chainPlayback;
        } else if (chainMeta) {
          effectiveMeta = { ...rawMeta, ...chainMeta };
        }
      }
    }

    const recoveredMime = String(
      effectiveMeta.content?.mime ||
        effectiveMeta.mimeType ||
        effectiveMeta.mime_type ||
        contentMime ||
        ''
    ).toLowerCase();
    const resolvedAnimType =
      alchemyAnimationLooksLikeVideo(alchemyImage.animation) ||
      imageVideoType.startsWith('video/') ||
      (alchemyAnimation &&
        (alchemyAnimation.startsWith('ar://') ||
          /arweave\.net\//i.test(alchemyAnimation) ||
          recoveredMime.startsWith('video/')))
        ? recoveredMime.startsWith('video/')
          ? recoveredMime
          : imageVideoType.startsWith('video/')
            ? imageVideoType
            : 'video/mp4'
        : alchemyAnimType;

    const mergedMeta: NFTMetadata = {
      ...effectiveMeta,
      // Prefer durable playback origin; keep raw on-chain URL for profile classification.
      animation_url:
        alchemyAnimation ||
        contentUri ||
        effectiveMeta.animation_url ||
        '',
      // Never stick audio bytes in metadata.image — covers must be visual.
      image:
        alchemyImageCached ||
        (looksLikeVisualCoverUrl(effectiveMeta.image) ? effectiveMeta.image : '') ||
        '',
      image_url:
        (looksLikeVisualCoverUrl(effectiveMeta.image_url) ? effectiveMeta.image_url : '') ||
        alchemyImageCached ||
        '',
    };
    const plan = getNftPlaybackPlan({
      metadata: mergedMeta,
      // Hint video when Alchemy already classified the animation as mp4/webm
      isVideo:
        resolvedAnimType.startsWith('video/') || recoveredMime.startsWith('video/')
          ? true
          : undefined,
      videoUrl:
        resolvedAnimType.startsWith('video/') || recoveredMime.startsWith('video/')
          ? alchemyAnimCached || alchemyAnimation || contentUri
          : undefined,
    });
    const soundRaw = [plan.audioUrl, plan.videoUrl, alchemyAnimation].find(isUsableOriginPlaybackUrl) || '';
    const audioUrl = processMediaUrlServer(
      rewriteLegacyOpenSeaMediaUrl(soundRaw, contract, network),
      '',
      'audio'
    );
    const videoRaw =
      (resolvedAnimType.startsWith('video/') && alchemyAnimCached
        ? alchemyAnimCached
        : '') ||
      (plan.videoUrl && isUsableOriginPlaybackUrl(plan.videoUrl) ? plan.videoUrl : '') ||
      (resolvedAnimType.startsWith('video/') && alchemyAnimation ? alchemyAnimation : '');
    const videoUrl = videoRaw
      ? processMediaUrlServer(rewriteLegacyOpenSeaMediaUrl(videoRaw, contract, network), '', 'audio')
      : '';
    const imageFromFiles = (effectiveMeta.properties?.files || []).find(
      (f: { uri?: string; url?: string; type?: string; mimeType?: string }) => {
        const u = (f?.uri || f?.url || '').toLowerCase();
        const t = (f?.type || f?.mimeType || '').toLowerCase();
        return t.startsWith('image/') || IMAGE_EXT_RE.test(u);
      }
    );
    const imageUrl = processMediaUrlServer(
      rewriteLegacyOpenSeaMediaUrl(
        alchemyImageCached ||
          collectionOpenSeaImage ||
          (looksLikeVisualCoverUrl(effectiveMeta.image) ? effectiveMeta.image : '') ||
          (looksLikeVisualCoverUrl(effectiveMeta.image_url) ? effectiveMeta.image_url : '') ||
          effectiveMeta.properties?.image ||
          effectiveMeta.properties?.visual?.url ||
          imageFromFiles?.uri ||
          imageFromFiles?.url ||
          '',
        contract,
        network
      ),
      '',
      'image'
    );

    // Ensure contract address is lowercase
    const contractAddress = metadata.contract.address.toLowerCase();
    const formattedTokenId = metadata.tokenId.toString().replace(/^0x/, '');

    // Alchemy CDN URLs often lack .mp4 — trust Alchemy contentType over URL sniffing.
    // Never use broken HLS / orphan Mux as the video source.
    const isAlchemyVideo =
      resolvedAnimType.startsWith('video/') ||
      recoveredMime.startsWith('video/') ||
      plan.mode !== 'audio-only';
    const resolvedVideoCandidate =
      videoUrl ||
      (isAlchemyVideo ? alchemyAnimCached || processMediaUrlServer(alchemyAnimation, '', 'audio') : '') ||
      '';
    const resolvedVideo = isUsableOriginPlaybackUrl(resolvedVideoCandidate) &&
      !isWeakPlaybackUrl(resolvedVideoCandidate)
      ? resolvedVideoCandidate
      : isUsableOriginPlaybackUrl(audioUrl) && !isWeakPlaybackUrl(audioUrl)
        ? audioUrl
        : undefined;
    const playbackMode = isAlchemyVideo ? 'video-with-audio' : plan.mode;

    const nft: NFT = {
      contract: contractAddress,
      tokenId: formattedTokenId,
      name: effectiveMeta.name || rawMeta.name || `NFT #${formattedTokenId}`,
      description: metadata.description || effectiveMeta.description || rawMeta.description || '',
      image: imageUrl || '',
      audio: resolvedVideo || (isUsableOriginPlaybackUrl(audioUrl) ? audioUrl : '') || '',
      videoUrl: resolvedVideo,
      playbackMode,
      hasValidAudio:
        Boolean(resolvedVideo || (isUsableOriginPlaybackUrl(audioUrl) && audioUrl)) ||
        hasPlayableAudio({ audio: audioUrl, metadata: mergedMeta }),
      isVideo: isAlchemyVideo || plan.mode !== 'audio-only',
      network,
      collection: {
        name: metadata.contract?.name || '',
        image: metadata.contract?.openSeaMetadata?.imageUrl || ''
      },
      metadata: {
        ...mergedMeta,
        // Prefer Alchemy CDN first so pickImageCandidates / playback recover
        // when public IPFS CIDs are unreplicated.
        // Prefer durable cover; don't re-inject unreplicated IPFS over OpenSea/collection.
        image: alchemyImageCached || imageUrl || '',
        image_url: alchemyImageCached || imageUrl || '',
        // Prefer the already-resolved/rewritten playback fields — falling
        // back to mergedMeta.animation_url first (as this used to) can leak
        // a raw ipfs://ar:// scheme into metadata even when audio/videoUrl
        // above already resolved to a proper https gateway URL, which then
        // confuses client-side enrich (it treats metadata.animation_url as
        // the most-authoritative source and can regress a working https
        // URL back to an unfetchable raw scheme).
        animation_url:
          resolvedVideo ||
          (isUsableOriginPlaybackUrl(audioUrl) ? audioUrl : '') ||
          (isUsableOriginPlaybackUrl(plan.videoUrl) ? plan.videoUrl : '') ||
          (isUsableOriginPlaybackUrl(mergedMeta.animation_url)
            ? processMediaUrlServer(
                rewriteLegacyOpenSeaMediaUrl(mergedMeta.animation_url, contract, network),
                '',
                'audio'
              )
            : '') ||
          '',
        audio: mergedMeta.audio || (plan.mode === 'video-plus-audio' ? plan.audioUrl : mergedMeta.audio) || undefined,
        mimeType: resolvedAnimType || mergedMeta.mimeType,
        mime_type: resolvedAnimType || mergedMeta.mime_type,
      }
    };

    if (nft.hasValidAudio || nft.isVideo) {
      nft.mediaKey = ownedNftMediaKey(nft.contract, nft.tokenId);
    }

    // Video tokens (e.g. Rodeo's AI-art mints) can resolve their "image" to a
    // raw video file — or an Alchemy/Cloudinary `video/fetch` frame-extraction
    // URL — that our own pipeline would otherwise pay to derive live. OpenSea
    // already renders + permanently caches a still for anything it indexes.
    // This must key off the resolved image URL itself, NOT `isAlchemyVideo`
    // (the audio/playback classifier) — a token can be "audio-only" for
    // playback purposes while its cover still needs frame extraction, as with
    // Rodeo's "Born again" (isVideo: false, image: still a video/fetch URL).
    //
    // Extensionless Alchemy CDN hashes (nft2-cdn.alchemy.com/base-mainnet/<hash>)
    // give no clue from the URL alone — but Alchemy already told us the real
    // contentType for this exact field. Only trust it when `nft.image` is
    // literally that same raw hash (not a pngUrl/thumbnailUrl still Alchemy
    // separately vouched for), so genuine stills aren't second-guessed.
    const alchemyCoverIsAmbiguousVideoHash =
      (alchemyImage.image?.contentType || '').toLowerCase().startsWith('video/') &&
      !!nft.image &&
      (nft.image === alchemyImage.image?.cachedUrl ||
        nft.image === alchemyImage.image?.originalUrl) &&
      !AUDIO_OR_VIDEO_EXT_RE.test(nft.image);
    const imageNeedsVideoFrameExtraction =
      !nft.image ||
      AUDIO_OR_VIDEO_EXT_RE.test(nft.image) ||
      /\/video\/fetch\//i.test(nft.image) ||
      alchemyCoverIsAmbiguousVideoHash;
    const openSeaLogTag = `[podplayr:opensea] ${nft.name || 'untitled'} ${contractAddress}#${formattedTokenId}`;
    if (imageNeedsVideoFrameExtraction) {
      // `getNFTMetadata` runs with `no-store` on every enrich request (playback
      // fields must stay fresh), which meant the OpenSea lookup below was
      // getting redone from scratch on every single card mount, for every
      // user, forever. Check the durable cover cache first — once we've
      // decided on a good still for a token, skip straight to it.
      const cachedCover = await getCachedNftCover(contractAddress, formattedTokenId, network);
      if (cachedCover) {
        console.log(`${openSeaLogTag} durable cache HIT — reusing previously resolved cover`, {
          cover: cachedCover,
        });
        nft.image = cachedCover;
        if (nft.metadata) {
          nft.metadata.image = cachedCover;
          nft.metadata.image_url = cachedCover;
        }
      } else {
        console.log(`${openSeaLogTag} attempting fallback — current image needs video frame extraction`, {
          currentImage: nft.image,
        });
        const openSeaMedia = await getOpenSeaNftMedia(contractAddress, formattedTokenId, network);
        // OpenSea's `image_url`/`display_image_url` on the Get-NFT endpoint can
        // itself just be a mirrored raw video (their own docs: "nearly
        // equivalent to the metadata read on-chain") — an <img>/<Image> tag
        // can't render that, so only accept it if it's actually a still.
        const openSeaImageIsAlsoVideo =
          !!openSeaMedia?.imageUrl && AUDIO_OR_VIDEO_EXT_RE.test(openSeaMedia.imageUrl);
        if (openSeaMedia?.imageUrl && !openSeaImageIsAlsoVideo) {
          console.log(`${openSeaLogTag} fallback SUCCEEDED`, {
            from: nft.image,
            to: openSeaMedia.imageUrl,
          });
          nft.image = openSeaMedia.imageUrl;
          if (nft.metadata) {
            nft.metadata.image = openSeaMedia.imageUrl;
            nft.metadata.image_url = openSeaMedia.imageUrl;
          }
        } else if (openSeaImageIsAlsoVideo) {
          console.log(`${openSeaLogTag} fallback REJECTED — OpenSea also only has a raw video, no still`, {
            openSeaUrl: openSeaMedia?.imageUrl,
          });
        } else {
          console.log(`${openSeaLogTag} fallback SKIPPED — no OpenSea image (missing key, not indexed, or error)`);
        }

        // Whatever we landed on (OpenSea still, or the pre-existing Alchemy
        // video/fetch still) is durable — remember it so the next request for
        // this exact token skips the OpenSea round-trip entirely.
        if (nft.image && !AUDIO_OR_VIDEO_EXT_RE.test(nft.image)) {
          await setCachedNftCover(contractAddress, formattedTokenId, network, nft.image);
        }
      }
    }

    // Tell the client this cover needs a <video>-style still fetch instead of
    // guessing a plain image transform first and eating a 400 from Cloudinary.
    nft.coverIsVideo =
      !!nft.image &&
      (AUDIO_OR_VIDEO_EXT_RE.test(nft.image) ||
        /\/video\/fetch\//i.test(nft.image) ||
        alchemyCoverIsAmbiguousVideoHash);

    // Only durably cache the *whole* response when nothing about it still
    // depends on fragile playback fields (Mux mezzanine, polluted HLS, public
    // IPFS gateways) — those genuinely need to stay fresh on every request.
    if (!nftNeedsChainMediaEnrich(nft)) {
      await setCachedNftResponse(contract, tokenId, network, nft);
    } else {
      console.log('[podplayr:redis] full-nft NOT cached — still depends on fragile playback fields', {
        contract,
        tokenId,
      });
    }

    return nft;
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
};

const isAlchemyCdnUrl = (url?: string | null): boolean =>
  !!url && /nft-cdn\.alchemy\.com|nft2-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);

/** Profile caches often keep dead arweave.net links — refresh via /api/nft for Alchemy stills. */
const isArweaveMediaUrl = (url?: string | null): boolean => {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('ar://')) return true;
  return /arweave\.(net|dev)|turbo-gateway\.com|permagate\.io|gateway\.irys\.xyz|ar-io\.dev|g8way\.io/i.test(
    url
  );
};

/** True when cover/playback still depend on fragile public IPFS gateways
 *  or video-as-image URLs that need Alchemy's static thumbnail cache. */
export const nftNeedsChainMediaEnrich = (nft: NFT | null | undefined): boolean => {
  if (!nft || !isOnChainNftIdentity(nft.contract, nft.tokenId)) return false;

  const playbackFields = [
    nft.audio,
    nft.videoUrl,
    nft.animationUrl,
    nft.metadata?.animation_url,
  ].filter(Boolean) as string[];

  // Cover was derived from a video file (Rodeo image=mp4) but playback never
  // got a videoUrl — don't lock that broken audio-only shape in Redis.
  if (nft.coverIsVideo && !nft.isVideo && !nft.videoUrl) return true;

  // Polluted Mux / broken Alchemy HLS / signed mezzanine → always re-fetch origin.
  if (playbackFields.some((u) => isWeakPlaybackUrl(u))) return true;

  // Good Alchemy cover but Pinata/IPFS playback (Relic / Daniel Arsham, etc.).
  if (playbackFields.some((u) => isIpfsPlaybackUrl(u))) return true;

  // Curated Featured stills already have Arweave + Mux. Do not re-fetch Alchemy
  // for placeholder hex tokenIds — that returns the collection OpenSea PNG.
  if (isCuratedFeaturedCover(nft)) return false;

  // Solid visual cover already — nothing to enrich for the card thumb.
  // Exception: Alchemy CDN alone is not enough when we also have a SeaDN /
  // Nifty Island animation — those CDN hashes are often the audio file.
  const cover = (nft.image || '').replace(/^[\s\x00-\x1f\x7f]+|[\s\x00-\x1f\x7f]+$/g, '');
  const anim =
    nft.metadata?.animation_url || nft.animationUrl || nft.videoUrl || '';
  const hasTokenVideoCover =
    !!anim &&
    (AUDIO_OR_VIDEO_EXT_RE.test(anim) ||
      /seadn\.io|i2c\.seadn|niftyisland\.com/i.test(anim)) &&
    !/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(anim);

  if (
    cover &&
    !AUDIO_OR_VIDEO_EXT_RE.test(cover) &&
    (isAlchemyCdnUrl(cover) ||
      /seadn\.io|openseauserdata\.com|i2c\.seadn|res\.cloudinary\.com/i.test(cover))
  ) {
    // Alchemy CDN "cover" + real token video → still enrich / prefer video.
    if (isAlchemyCdnUrl(cover) && hasTokenVideoCover) {
      return true;
    }
    // Dead raw2 jpg poster + SeaDN mp4 animation (Deep Space).
    if (isFragileSeaDnPosterUrl(cover) && hasTokenVideoCover) {
      return true;
    }
    return false;
  }

  const candidates = [
    nft.image,
    nft.audio,
    nft.videoUrl,
    nft.metadata?.image,
    nft.metadata?.animation_url,
  ].filter(Boolean) as string[];

  // Need enrich when cover is missing/fragile, even if playback already uses Alchemy CDN.
  const coverFragile =
    !cover ||
    cover.startsWith('ipfs://') ||
    /\/ipfs\//i.test(cover) ||
    /\.ipfs\./i.test(cover) ||
    AUDIO_OR_VIDEO_EXT_RE.test(cover) ||
    isArweaveMediaUrl(cover);

  if (coverFragile) return true;

  return candidates.some(
    (u) =>
      u.startsWith('ipfs://') ||
      /\/ipfs\//i.test(u) ||
      /\.ipfs\./i.test(u) ||
      isArweaveMediaUrl(u) ||
      /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) ||
      /seadn\.io|openseauserdata\.com/i.test(u)
  );
};

/** Best playback URL from a fresh `/api/nft` response — Alchemy CDN first. */
function pickBestApiPlaybackUrl(data: NFT): string {
  const candidates = [data.audio, data.videoUrl, data.metadata?.animation_url, data.animationUrl].filter(
    (u): u is string => typeof u === 'string' && !!u.trim()
  );
  return (
    candidates.find(isAlchemyCdnPlaybackUrl) ||
    candidates.find(
      (u) => !isIpfsPlaybackUrl(u) && !isWeakPlaybackUrl(u) && !isPollutedPlaybackUrl(u)
    ) ||
    ''
  );
}

/**
 * Refresh media via server Alchemy (`/api/nft`) so unreplicated IPFS CIDs can
 * fall back to Alchemy's cached CDN (image + animation). Safe in mini-apps.
 */
export const enrichNftMediaFromChain = async (nft: NFT): Promise<NFT> => {
  // Callers decide when enrich is needed. Cover-only by default; also replace
  // weak playback (orphan Mux / mezzanine 403s / broken HLS) with Arweave origin.
  if (!isOnChainNftIdentity(nft.contract, nft.tokenId)) return nft;
  try {
    const network = nft.network === 'base' ? 'base' : 'ethereum';
    const res = await fetch(
      `/api/nft?contract=${encodeURIComponent(nft.contract)}&tokenId=${encodeURIComponent(
        nft.tokenId
      )}&network=${network}&playback=1`,
      { cache: 'no-store' }
    );
    if (!res.ok) return nft;
    const data = (await res.json()) as NFT;
    if (!data || typeof data !== 'object' || !data.contract || !data.tokenId) return nft;

    const apiPlayback = pickBestApiPlaybackUrl(data);
    const hasIpfsPlayback = [
      nft.audio,
      nft.videoUrl,
      nft.animationUrl,
      nft.metadata?.animation_url,
    ].some(isIpfsPlaybackUrl);

    // Pinata/IPFS in profile metadata but Alchemy CDN on /api/nft — swap immediately.
    // (Browser may cache older /api/nft JSON without CDN fields for up to 1h.)
    if (apiPlayback && isAlchemyCdnPlaybackUrl(apiPlayback) && hasIpfsPlayback) {
      const cover =
        nft.image ||
        data.image ||
        data.metadata?.image ||
        data.metadata?.image_url ||
        '';
      return {
        ...nft,
        name: data.name || nft.name,
        image: cover,
        audio: apiPlayback,
        videoUrl: apiPlayback,
        animationUrl: apiPlayback,
        playbackMode: data.playbackMode || 'video-with-audio',
        isVideo: data.isVideo ?? true,
        hasValidAudio: data.hasValidAudio ?? true,
        collection: {
          ...nft.collection,
          name: data.collection?.name || nft.collection?.name || '',
          image: data.collection?.image || nft.collection?.image,
        },
        metadata: {
          ...nft.metadata,
          ...data.metadata,
          image: cover || nft.metadata?.image,
          image_url: data.metadata?.image_url || cover || nft.metadata?.image_url,
          animation_url: apiPlayback,
          mimeType:
            data.metadata?.mimeType || data.metadata?.mime_type || nft.metadata?.mimeType || 'video/mp4',
          mime_type:
            data.metadata?.mime_type || data.metadata?.mimeType || nft.metadata?.mime_type || 'video/mp4',
        },
      };
    }

    const existingAnim =
      nft.metadata?.animation_url || nft.animationUrl || nft.videoUrl || nft.audio || '';
    const incomingAnim = apiPlayback || data.metadata?.animation_url || data.videoUrl || data.audio || '';

    const existingWeak =
      isWeakPlaybackUrl(existingAnim) ||
      !existingAnim ||
      isIpfsPlaybackUrl(existingAnim);
    const incomingStrong =
      !!incomingAnim &&
      !isWeakPlaybackUrl(incomingAnim) &&
      !isPollutedPlaybackUrl(incomingAnim);
    const incomingOk =
      !!incomingAnim &&
      !isPollutedPlaybackUrl(incomingAnim) &&
      !isWeakPlaybackUrl(incomingAnim);

    // Prefer durable ar:// / https origins over signed mezzanine / orphan Mux.
    const keepPlaybackAnim =
      isAlchemyCdnPlaybackUrl(incomingAnim) && isIpfsPlaybackUrl(existingAnim)
        ? incomingAnim
        : existingWeak && incomingStrong
          ? incomingAnim
          : existingAnim && !isWeakPlaybackUrl(existingAnim) && !isIpfsPlaybackUrl(existingAnim)
            ? existingAnim
            : incomingStrong
              ? incomingAnim
              : incomingOk
                ? incomingAnim
                : [incomingAnim, existingAnim].find(
                    (u) => u && !isPollutedPlaybackUrl(u)
                  ) || '';

    const replacePlayback =
      Boolean(keepPlaybackAnim) &&
      keepPlaybackAnim !== existingAnim &&
      (existingWeak ||
        (isAlchemyCdnPlaybackUrl(keepPlaybackAnim) && isIpfsPlaybackUrl(existingAnim)));

    // Cover only: prefer a real still from Alchemy; token video cover only when
    // there is no usable still (Nifty Island / Food). Never prefer collection
    // OpenSea art over an Alchemy CDN still that already looks like an image.
    const alchemyStill =
      (data.image &&
      /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(data.image)
        ? data.image
        : '') ||
      (data.metadata?.image &&
      /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(data.metadata.image)
        ? data.metadata.image
        : '') ||
      ([data.image, data.metadata?.image, data.metadata?.image_url].find(
        (u) =>
          !!u &&
          /i2c\.seadn\.io|raw2?\.seadn\.io/i.test(u) &&
          IMAGE_EXT_RE.test(u)
      ) ?? '');
    const tokenVideoCover = [data.image, data.metadata?.animation_url, data.videoUrl]
      .find(
        (u) =>
          !!u &&
          (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) || /niftyisland\.com/i.test(u)) &&
          !/\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i.test(u)
      );
    const seadnTokenVideo = [data.image, data.metadata?.animation_url, data.videoUrl].find(
      (u) =>
        !!u &&
        /raw2?\.seadn\.io/i.test(u) &&
        (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) || !/\.(png|jpe?g|gif|webp)(?:\?|#|$)/i.test(u))
    );
    const image = (nft.image || '').replace(/^[\s\x00-\x1f\x7f]+|[\s\x00-\x1f\x7f]+$/g, '');
    const currentFragile =
      !image ||
      /\/ipfs\//i.test(image) ||
      image.startsWith('ipfs://') ||
      isArweaveMediaUrl(image) ||
      (isFragileSeaDnPosterUrl(image) && nftHasSeaDnVideoAnimation(nft));
    const currentIsTokenVideo =
      !!nft.image &&
      (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(nft.image) ||
        /niftyisland\.com/i.test(nft.image) ||
        (/raw2?\.seadn\.io/i.test(nft.image) &&
          !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(nft.image)));

    let resolvedImage = nft.image || '';
    if (isCuratedFeaturedCover(nft)) {
      resolvedImage = nft.image as string;
    } else if (currentIsTokenVideo) {
      // Keep Nifty / token video covers — don't replace with Alchemy still.
      resolvedImage = nft.image as string;
    } else if (
      alchemyStill &&
      /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(nft.image || '')
    ) {
      // Already on Alchemy — keep the in-memory cover. Swapping to a different
      // CDN hash (image vs animation) yanks working thumbnailv2 → video/fetch
      // thrash on cards (Neybors).
      resolvedImage = nft.image as string;
    } else if (alchemyStill && currentFragile) {
      resolvedImage = alchemyStill;
    } else if (currentFragile && (tokenVideoCover || seadnTokenVideo)) {
      resolvedImage = tokenVideoCover || seadnTokenVideo || resolvedImage;
    } else if (currentFragile && data.image) {
      resolvedImage = data.image;
    } else if (currentFragile && data.collection?.image) {
      resolvedImage = data.collection.image;
    } else if (!resolvedImage && alchemyStill) {
      resolvedImage = alchemyStill;
    }

    const pickPlaybackField = (existing?: string, incoming?: string) => {
      if (replacePlayback && keepPlaybackAnim) return keepPlaybackAnim;
      if (isAlchemyCdnPlaybackUrl(apiPlayback) && isIpfsPlaybackUrl(existing)) {
        return apiPlayback;
      }
      if (isAlchemyCdnPlaybackUrl(incoming) && isIpfsPlaybackUrl(existing)) {
        return incoming as string;
      }
      // Prefer durable origin over signed mezzanine even when not replacePlayback.
      if (existing && isWeakPlaybackUrl(existing) && incoming && !isWeakPlaybackUrl(incoming)) {
        return incoming;
      }
      if (
        existing &&
        !isWeakPlaybackUrl(existing) &&
        !isIpfsPlaybackUrl(existing)
      ) {
        return existing;
      }
      if (incoming && !isPollutedPlaybackUrl(incoming)) return incoming;
      if (apiPlayback && !isPollutedPlaybackUrl(apiPlayback)) return apiPlayback;
      if (existing && !isPollutedPlaybackUrl(existing)) return existing;
      // Never fall through to orphan Mux / broken HLS.
      return '';
    };

    const upgradedPlayback = replacePlayback || Boolean(
      apiPlayback &&
        isAlchemyCdnPlaybackUrl(apiPlayback) &&
        [nft.audio, nft.videoUrl, nft.metadata?.animation_url].some(isIpfsPlaybackUrl)
    );

    return {
      ...nft,
      name: data.name || nft.name,
      image: resolvedImage,
      audio: pickPlaybackField(nft.audio, data.audio),
      videoUrl: pickPlaybackField(nft.videoUrl, data.videoUrl) || undefined,
      animationUrl: pickPlaybackField(nft.animationUrl, data.animationUrl) || undefined,
      playbackMode: upgradedPlayback
        ? data.playbackMode || nft.playbackMode
        : nft.playbackMode || data.playbackMode,
      isVideo: upgradedPlayback
        ? (data.isVideo ?? nft.isVideo)
        : (nft.isVideo ?? data.isVideo),
      hasValidAudio: upgradedPlayback
        ? (data.hasValidAudio ?? nft.hasValidAudio)
        : (nft.hasValidAudio ?? data.hasValidAudio),
      collection: {
        ...nft.collection,
        name: data.collection?.name || nft.collection?.name || '',
        image: data.collection?.image || nft.collection?.image,
      },
      metadata: {
        ...nft.metadata,
        ...data.metadata,
        image: resolvedImage || nft.metadata?.image,
        image_url: nft.metadata?.image_url || data.metadata?.image_url || resolvedImage,
        animation_url: keepPlaybackAnim,
        mimeType:
          replacePlayback
            ? data.metadata?.mimeType || data.metadata?.mime_type || nft.metadata?.mimeType
            : nft.metadata?.mimeType || data.metadata?.mimeType,
        mime_type:
          replacePlayback
            ? data.metadata?.mime_type || data.metadata?.mimeType || nft.metadata?.mime_type
            : nft.metadata?.mime_type || data.metadata?.mime_type,
      },
    };
  } catch (error) {
    console.warn('enrichNftMediaFromChain failed', nft.contract, nft.tokenId, error);
    return nft;
  }
};

/**
 * Direct Alchemy fetch. Use from server/API routes only — Farcaster/Base
 * mini-app webviews often block client calls to alchemy.com, which made
 * profile grids empty on mobile while desktop browsers still worked.
 */
const alchemyFetchDelay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Alchemy occasionally 429s under burst load (e.g. multiple addresses fetched in parallel). Retry transient failures before giving up. */
async function fetchAlchemyWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Alchemy HTTP ${res.status}`);
        if (attempt < maxRetries) {
          const waitMs = Math.pow(2, attempt) * 500;
          console.warn(`⏳ Alchemy ${res.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await alchemyFetchDelay(waitMs);
          continue;
        }
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const waitMs = Math.pow(2, attempt) * 500;
        console.warn(`⏳ Alchemy fetch threw, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries}):`, error);
        await alchemyFetchDelay(waitMs);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Alchemy fetch failed after retries');
}

export const fetchOwnedNftsFromAlchemy = async (address: string): Promise<NFT[]> => {
  try {
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) throw new Error('Alchemy API key not found');

    
    // Fetch from both networks
    // Do not pass excludeFilters[]=SPAM. Alchemy's spam heuristics false-positive
    // independent music contracts (low marketplace volume, custom ERC, gift mints).
    const ownedQuery = `owner=${address}&withMetadata=true&pageSize=100`;
    const [ethResponse, baseResponse] = await Promise.all([
      fetchAlchemyWithRetry(
        `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?${ownedQuery}`
      ),
      fetchAlchemyWithRetry(
        `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?${ownedQuery}`
      ),
    ]);

    // Check responses

    if (!ethResponse.ok || !baseResponse.ok) {
      const errorText = await ((!ethResponse.ok ? ethResponse : baseResponse).text());
      throw new Error(`Alchemy API error: ${errorText}`);
    }

    const [ethData, baseData] = await Promise.all([
      ethResponse.json(),
      baseResponse.json()
    ]);


    const ownedNfts = [...(ethData.ownedNfts || []), ...(baseData.ownedNfts || [])];

    interface AlchemyNFT {
      spamInfo?: { isSpam?: boolean | string; classifications?: string[] };
      contract: {
        address: string;
        name?: string;
        isSpam?: boolean | string;
        spamClassifications?: string[];
        openSea?: {
          imageUrl?: string;
        };
      };
      contractMetadata?: {
        name?: string;
        spamClassifications?: string[];
        openSea?: {
          imageUrl?: string;
        };
      };
      id?: {
        tokenId: string;
      };
      tokenId?: string;
      title?: string;
      description?: string;
      media?: Array<{ gateway?: string; raw?: string; format?: string }>;
      image?: AlchemyImageFields;
      animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string; size?: number };
      metadata?: {
        name?: string;
        description?: string;
        image?: string;
        image_url?: string;
        animation_url?: string;
        audio?: string;
        audio_url?: string;
        mimeType?: string;
        mime_type?: string;
        properties?: {
          audio?: string;
          audio_url?: string;
          audio_file?: string;
          image?: string;
          visual?: { url?: string };
          soundContent?: { url?: string };
          mimeType?: string;
          files?: any[];
          video?: string;
          animation_url?: string;
        };
        content?: {
          mime?: string;
        };
      };
    }

    const mapAlchemyNft = (nft: AlchemyNFT, network: 'ethereum' | 'base'): NFT | null => {
        const contractAddress = nft.contract.address.toLowerCase();
        if (isBlockedNftContract(contractAddress)) return null;
        const meta = nft.metadata || {};
        const fromMedia = (nft.media || []).find((m) => {
          const format = (m.format || '').toLowerCase();
          return format.includes('mp4') || format.includes('webm') || format.includes('video');
        });
        // Any non-IPFS media gateway (OpenSea often puts token video/still here).
        const durableMedia = (nft.media || [])
          .map((m) => m.gateway || m.raw || '')
          .find(
            (u) =>
              u &&
              !/\/ipfs\//i.test(u) &&
              !u.startsWith('ipfs://') &&
              /seadn\.io|openseauserdata|i2c\.seadn|niftyisland|nft2?-cdn\.alchemy|cloudinary/i.test(u)
          );
        const animationFromAlchemy =
          pickAlchemyAnimationPlaybackUrl(nft.animation, meta.animation_url, [
            (meta as NFTMetadata).content?.uri,
            meta.properties?.video,
            meta.properties?.animation_url,
            fromMedia?.gateway,
            fromMedia?.raw,
          ]) || '';
        const collectionImage =
          nft.contract.openSea?.imageUrl ||
          nft.contractMetadata?.openSea?.imageUrl ||
          '';
        const { cover: visualCover, audioFromImage } = pickAlchemyVisualCover({
          image: nft.image,
          media: nft.media,
          metaImage: meta.image,
          metaImageUrl: meta.image_url,
          files: meta.properties?.files,
          collectionImage,
          videoFallbacks: [
            // Prefer original/meta mp4 — never feed broken HLS stubs into cover/video fallbacks.
            nft.animation?.originalUrl,
            meta.animation_url,
            (meta as NFTMetadata).content?.uri,
            animationFromAlchemy,
            durableMedia,
            meta.image,
            fromMedia?.gateway,
            fromMedia?.raw,
            nft.image?.cachedUrl,
          ],
        });
        const mergedMeta = {
          ...meta,
          animation_url:
            animationFromAlchemy ||
            (typeof (meta as NFTMetadata).content?.uri === 'string'
              ? (meta as NFTMetadata).content!.uri
              : '') ||
            (typeof meta.animation_url === 'string' ? meta.animation_url : '') ||
            (isUsableOriginPlaybackUrl(meta.animation_url) ? meta.animation_url : '') ||
            (isUsableOriginPlaybackUrl(audioFromImage) ? audioFromImage : '') ||
            '',
          image: visualCover || '',
        };
        const rewrite = (url: string) =>
          rewriteLegacyOpenSeaMediaUrl(normalizeOwnedNftUrl(url), contractAddress, network);

        const plan = getNftPlaybackPlan({
          metadata: mergedMeta,
          // When Alchemy stuffed audio into image.*, treat it as playback.
          audio: audioFromImage || undefined,
        });
        const soundRaw = plan.audioUrl || plan.videoUrl || audioFromImage || '';
        const audioUrl = rewrite(soundRaw);
        const videoUrl = plan.videoUrl ? rewrite(plan.videoUrl) : '';

        // Prefer Alchemy CDN / OpenSea stills / video covers — never leave image empty
        // when we have playable media (empty image → default-nft.png flash on refresh).
        const imageUrl = rewrite(
          visualCover ||
            durableMedia ||
            collectionImage ||
            animationFromAlchemy ||
            meta.image ||
            ''
        );

        const tokenId = nft.id?.tokenId?.toString()?.replace(/^0x/, '') || nft.tokenId?.toString()?.replace(/^0x/, '');
        if (!tokenId) {
          console.warn('Missing tokenId for NFT:', nft);
          return null;
        }

        const candidate = {
          audio: plan.audioUrl || audioUrl,
          animationUrl: plan.videoUrl || mergedMeta.animation_url,
          metadata: mergedMeta,
        };

        const hasAudio = Boolean(soundRaw) || hasPlayableAudio(candidate);
        const isVideo =
          plan.mode !== 'audio-only' ||
          alchemyAnimationLooksLikeVideo(nft.animation) ||
          /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(animationFromAlchemy || '');

        const playbackUrl = rewrite(
          animationFromAlchemy ||
            (isVideo && nft.animation?.cachedUrl && !isBrokenAlchemyAnimationCache(nft.animation)
              ? nft.animation.cachedUrl
              : '') ||
            soundRaw
        );

        const processedNFT: NFT = {
          contract: contractAddress,
          tokenId,
          name: meta.name || `NFT #${tokenId}`,
          description: meta.description || '',
          image: imageUrl || '',
          animationUrl: playbackUrl || rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
          audio: playbackUrl || audioUrl || '',
          videoUrl: isVideo ? playbackUrl || videoUrl || undefined : videoUrl || undefined,
          playbackMode: isVideo ? 'video-with-audio' : plan.mode,
          hasValidAudio: hasAudio,
          isVideo,
          isAnimation: false,
          network,
          // Keep Alchemy spam signals for client-side debug / future filtering.
          spamInfo: nft.spamInfo || undefined,
          isSpam: nft.spamInfo?.isSpam ?? nft.contract?.isSpam,
          spamClassifications:
            nft.spamInfo?.classifications ||
            nft.contract?.spamClassifications ||
            nft.contractMetadata?.spamClassifications ||
            undefined,
          contractIsSpam: nft.contract?.isSpam,
          contractSpamClassifications: nft.contract?.spamClassifications,
          collection: {
            image: collectionImage,
            name: nft.contract.name || ''
          },
          metadata: {
            ...mergedMeta,
            // Prefer visual cover; keep original meta image only when it's actually visual.
            image: rewrite(visualCover || '') || imageUrl || '',
            image_url:
              rewrite(meta.image_url || '') ||
              rewrite(visualCover || '') ||
              '',
            animation_url: playbackUrl || rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
            audio:
              mergedMeta.audio ||
              mergedMeta.audio_url ||
              audioFromImage ||
              (plan.mode === 'video-plus-audio' ? plan.audioUrl || undefined : mergedMeta.audio),
          }
        };

        if (hasAudio || isVideo) {
          processedNFT.mediaKey = ownedNftMediaKey(processedNFT.contract, processedNFT.tokenId);
        }

        return processedNFT;
    };

    const processedNFTs = [
      ...((ethData.ownedNfts || []) as AlchemyNFT[]).map((nft) => {
        try {
          return mapAlchemyNft(nft, 'ethereum');
        } catch (error) {
          console.warn('Skipped ETH NFT during map:', error);
          return null;
        }
      }),
      ...((baseData.ownedNfts || []) as AlchemyNFT[]).map((nft) => {
        try {
          return mapAlchemyNft(nft, 'base');
        } catch (error) {
          console.warn('Skipped Base NFT during map:', error);
          return null;
        }
      }),
    ].filter((nft): nft is NFT => !!nft && isPlayableMediaNFT(nft));

    return processedNFTs.map((nft) => ({
      ...nft,
      contract: nft.contract.toLowerCase(),
      tokenId: nft.tokenId.toString().replace(/^0x/, ''),
      image: nft.image || '',
      animationUrl: nft.videoUrl || nft.audio || nft.animationUrl || '',
      audio: nft.audio || '',
    }));
  } catch (error) {
    console.error(`Error fetching NFTs for address ${address}:`, error);
    return [];
  }
};

export const fetchUserNFTsFromAlchemy = async (address: string): Promise<NFT[]> => {
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/nfts/owned?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        console.error(`Owned NFT API error ${res.status}:`, await res.text());
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error(`Error fetching NFTs for address ${address}:`, error);
      return [];
    }
  }
  return fetchOwnedNftsFromAlchemy(address);
};

export const fetchUserNFTs = async (fid: number): Promise<NFT[]> => {
  try {

    // Get user profile from Neynar for verified addresses
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    const profileResponse = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      throw new Error(`Failed to fetch user profile: ${errorText}`);
    }

    const profileData = await profileResponse.json();
    
    let allAddresses: string[] = [];
    const user = profileData.users?.[0];

    const verifiedEth = user?.verified_addresses?.eth_addresses;
    if (Array.isArray(verifiedEth) && verifiedEth.length > 0) {
      allAddresses.push(...verifiedEth);
    }
    if (Array.isArray(user?.verifications)) {
      allAddresses.push(...user.verifications);
    }
    if (user?.custody_address) {
      allAddresses.push(user.custody_address);
    }

    allAddresses = [...new Set(allAddresses)].filter(addr => {
      return Boolean(addr && addr.startsWith('0x') && addr.length === 42);
    });

    if (allAddresses.length === 0) {
      throw new Error('No valid addresses found for this user');
    }


    // Process addresses sequentially
    const allNFTs: NFT[] = [];
    
    for (let i = 0; i < allAddresses.length; i++) {
      const address = allAddresses[i];
      
      try {
        const nfts = await fetchOwnedNftsFromAlchemy(address);
        allNFTs.push(...nfts);
        
        if (i < allAddresses.length - 1) {
          await alchemyFetchDelay(2000);
        }
      } catch (error) {
        console.error(`❌ Error processing address ${address}:`, error);
      }
    }

    return allNFTs;

  } catch (error) {
    console.error('❌ NFT fetch error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error
    });
    throw error;
  }
};
