import type { NFT } from '../types/user';
import { Alchemy, Network } from 'alchemy-sdk';
import { createHash } from 'crypto';
import { rewriteLegacyOpenSeaMediaUrl } from '../utils/openSeaMedia';
import {
  hasPlayableAudio,
  isPlayableMediaNFT,
  getNftPlaybackPlan,
} from '../utils/isMediaNFT';

const PINATA_IPFS = 'https://gateway.pinata.cloud/ipfs/';

/** Server-safe URL rewrite — do not import processMediaUrl (client module). */
function processMediaUrlServer(
  url: string,
  _fallback: string = '',
  _mediaType: 'image' | 'audio' | 'metadata' = 'image'
): string {
  if (!url || typeof url !== 'string') return '';
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

type AlchemyImageFields = {
  cachedUrl?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  pngUrl?: string;
  contentType?: string;
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

export const getNFTMetadata = async (contract: string, tokenId: string, network: 'base' | 'ethereum' = 'ethereum'): Promise<NFT> => {
  try {
    const client = network === 'base' ? baseAlchemy : ethAlchemy;
    
    // Handle different tokenId formats - try multiple formats like the OpenGraph API does
    const tokenIdFormats = [];
    
    // If tokenId contains hex characters, try converting to decimal
    if (/[a-fA-F]/.test(tokenId)) {
      const hexWithPrefix = tokenId.startsWith('0x') ? tokenId : `0x${tokenId}`;
      try {
        const decimalValue = BigInt(hexWithPrefix).toString();
        tokenIdFormats.push(decimalValue);
      } catch (e) {
        console.log('Failed to convert hex to decimal:', e);
      }
      
      // Also try with 0x prefix if not already present
      if (!tokenId.startsWith('0x')) {
        tokenIdFormats.push(`0x${tokenId}`);
      }
    } else {
      // For non-hex tokenIds, try as-is and with/without 0x prefix
      tokenIdFormats.push(
        tokenId,
        tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId,
      );
    }
    
    let metadata;
    let lastError;
    
    // Try each tokenId format until one works
    for (const testTokenId of tokenIdFormats) {
      try {
        metadata = await client.nft.getNftMetadata(contract, testTokenId);
        console.log(`✅ Successfully fetched metadata with tokenId format: ${testTokenId}`);
        break;
      } catch (error) {
        console.log(`❌ Failed with tokenId format ${testTokenId}:`, (error as Error).message);
        lastError = error;
      }
    }
    
    if (!metadata) {
      throw lastError || new Error('Failed to fetch metadata with any tokenId format');
    }

    const rawMeta = metadata.raw.metadata || {};
    const alchemyImage = metadata as {
      image?: AlchemyImageFields;
      animation?: AlchemyImageFields;
    };
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
          alchemyImage.animation?.cachedUrl,
          alchemyImage.animation?.originalUrl,
          rawMeta.animation_url,
          rawMeta.image,
          alchemyImage.image?.cachedUrl,
        ],
      });
    const alchemyImageCached = alchemyVisualCover;
    const alchemyAnimCached = alchemyImage.animation?.cachedUrl || '';
    const alchemyAnimOriginal = alchemyImage.animation?.originalUrl || '';
    const alchemyAnimType = (alchemyImage.animation?.contentType || '').toLowerCase();

    const alchemyAnimation = alchemyAnimCached || alchemyAnimOriginal || alchemyImageAsAudio || '';
    const mergedMeta = {
      ...rawMeta,
      // Prefer Alchemy CDN for playback; keep original IPFS as secondary via image fields.
      animation_url:
        alchemyAnimCached ||
        rawMeta.animation_url ||
        alchemyAnimOriginal ||
        alchemyImageAsAudio ||
        '',
      // Never stick audio bytes in metadata.image — covers must be visual.
      image: alchemyImageCached || (looksLikeVisualCoverUrl(rawMeta.image) ? rawMeta.image : '') || '',
      image_url:
        (looksLikeVisualCoverUrl(rawMeta.image_url) ? rawMeta.image_url : '') ||
        alchemyImageCached ||
        '',
    };
    const plan = getNftPlaybackPlan({
      metadata: mergedMeta,
      // Hint video when Alchemy already classified the animation as mp4/webm
      isVideo: alchemyAnimType.startsWith('video/') || undefined,
      videoUrl: alchemyAnimType.startsWith('video/') ? alchemyAnimCached || alchemyAnimation : undefined,
    });
    const soundRaw = plan.audioUrl || plan.videoUrl || alchemyAnimation || '';
    const audioUrl = processMediaUrlServer(
      rewriteLegacyOpenSeaMediaUrl(soundRaw, contract, network),
      '',
      'audio'
    );
    const videoUrl =
      alchemyAnimType.startsWith('video/') && alchemyAnimCached
        ? alchemyAnimCached
        : plan.videoUrl
          ? processMediaUrlServer(rewriteLegacyOpenSeaMediaUrl(plan.videoUrl, contract, network), '', 'audio')
          : '';
    const imageFromFiles = (rawMeta.properties?.files || []).find(
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
          (looksLikeVisualCoverUrl(rawMeta.image) ? rawMeta.image : '') ||
          (looksLikeVisualCoverUrl(rawMeta.image_url) ? rawMeta.image_url : '') ||
          rawMeta.properties?.image ||
          rawMeta.properties?.visual?.url ||
          imageFromFiles?.uri ||
          imageFromFiles?.url ||
          alchemyAnimCached ||
          rawMeta.animation_url ||
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
    const isAlchemyVideo = alchemyAnimType.startsWith('video/');
    const resolvedVideo =
      videoUrl || (isAlchemyVideo ? alchemyAnimCached : '') || undefined;
    const playbackMode = isAlchemyVideo ? 'video-with-audio' : plan.mode;

    const nft: NFT = {
      contract: contractAddress,
      tokenId: formattedTokenId,
      name: rawMeta.name || `NFT #${formattedTokenId}`,
      description: metadata.description || rawMeta.description || '',
      image: imageUrl || '',
      audio: resolvedVideo || audioUrl || '',
      videoUrl: resolvedVideo,
      playbackMode,
      hasValidAudio:
        Boolean(resolvedVideo || audioUrl) ||
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
        animation_url: mergedMeta.animation_url || resolvedVideo || plan.videoUrl || '',
        audio: mergedMeta.audio || (plan.mode === 'video-plus-audio' ? plan.audioUrl : mergedMeta.audio) || undefined,
        mimeType: alchemyAnimType || mergedMeta.mimeType,
        mime_type: alchemyAnimType || mergedMeta.mime_type,
      }
    };

    if (nft.hasValidAudio || nft.isVideo) {
      nft.mediaKey = ownedNftMediaKey(nft.contract, nft.tokenId);
    }

    return nft;
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
};

const isAlchemyCdnUrl = (url?: string | null): boolean =>
  !!url && /nft-cdn\.alchemy\.com|nft2-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);

/** True when cover/playback still depend on fragile public IPFS gateways
 *  or video-as-image URLs that need Alchemy's static thumbnail cache. */
export const nftNeedsChainMediaEnrich = (nft: NFT | null | undefined): boolean => {
  if (!nft?.contract || !nft?.tokenId) return false;

  // Solid visual cover already — nothing to enrich for the card thumb.
  // Exception: Alchemy CDN alone is not enough when we also have a SeaDN /
  // Nifty Island animation — those CDN hashes are often the audio file.
  const cover = nft.image || '';
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
    if (!(isAlchemyCdnUrl(cover) && hasTokenVideoCover)) {
      return false;
    }
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
    AUDIO_OR_VIDEO_EXT_RE.test(cover);

  if (coverFragile) return true;

  return candidates.some(
    (u) =>
      u.startsWith('ipfs://') ||
      /\/ipfs\//i.test(u) ||
      /\.ipfs\./i.test(u) ||
      /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u) ||
      /seadn\.io|openseauserdata\.com/i.test(u)
  );
};

/**
 * Refresh media via server Alchemy (`/api/nft`) so unreplicated IPFS CIDs can
 * fall back to Alchemy's cached CDN (image + animation). Safe in mini-apps.
 */
export const enrichNftMediaFromChain = async (nft: NFT): Promise<NFT> => {
  // Callers decide when enrich is needed. Never replace playback URLs — only
  // improve card cover (image / collection.image).
  if (!nft?.contract || !nft?.tokenId) return nft;
  try {
    const network = nft.network === 'base' ? 'base' : 'ethereum';
    const res = await fetch(
      `/api/nft?contract=${encodeURIComponent(nft.contract)}&tokenId=${encodeURIComponent(
        nft.tokenId
      )}&network=${network}`
    );
    if (!res.ok) return nft;
    const data = (await res.json()) as NFT;
    if (!data || typeof data !== 'object') return nft;

    const existingAnim =
      nft.metadata?.animation_url || nft.animationUrl || nft.videoUrl || nft.audio || '';
    const incomingAnim =
      data.metadata?.animation_url || data.videoUrl || data.audio || '';

    // Keep whatever the client already uses for playback unless enrich adds a
    // clearly better same-kind URL. Never swap Arweave audio for a cover video.
    const keepPlaybackAnim = existingAnim || incomingAnim || '';

    // Cover only: prefer a real still from Alchemy; token video cover only when
    // there is no usable still (Nifty Island / Food). Never prefer collection
    // OpenSea art over an Alchemy CDN still that already looks like an image.
    const alchemyStill =
      (data.image && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(data.image)
        ? data.image
        : '') ||
      (data.metadata?.image &&
      /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(data.metadata.image)
        ? data.metadata.image
        : '');
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
    const currentFragile =
      !nft.image ||
      /\/ipfs\//i.test(nft.image) ||
      nft.image.startsWith('ipfs://');
    const currentIsTokenVideo =
      !!nft.image &&
      (/\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(nft.image) ||
        /niftyisland\.com/i.test(nft.image) ||
        (/raw2?\.seadn\.io/i.test(nft.image) &&
          !/\.(png|jpe?g|gif|webp|svg)(?:\?|#|$)/i.test(nft.image)));

    let resolvedImage = nft.image || '';
    if (currentIsTokenVideo) {
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

    return {
      ...nft,
      name: data.name || nft.name,
      image: resolvedImage,
      // Preserve playback fields from the live NFT object.
      audio: nft.audio || data.audio || '',
      videoUrl: nft.videoUrl || data.videoUrl || '',
      animationUrl: nft.animationUrl || data.animationUrl || '',
      playbackMode: nft.playbackMode || data.playbackMode,
      isVideo: nft.isVideo ?? data.isVideo,
      hasValidAudio: nft.hasValidAudio ?? data.hasValidAudio,
      collection: {
        ...nft.collection,
        name: data.collection?.name || nft.collection?.name,
        image: data.collection?.image || nft.collection?.image,
      },
      metadata: {
        ...nft.metadata,
        image: resolvedImage || nft.metadata?.image,
        image_url: nft.metadata?.image_url || data.metadata?.image_url || resolvedImage,
        // Never let enrich replace a working playback URL with cover media.
        animation_url: keepPlaybackAnim,
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
    console.log('\n🔍 Fetching NFTs for address:', address);
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) throw new Error('Alchemy API key not found');

    console.log('🌐 Starting parallel fetch from ETH and BASE networks...');
    
    // Fetch from both networks
    const [ethResponse, baseResponse] = await Promise.all([
      fetchAlchemyWithRetry(
        `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`
      ),
      fetchAlchemyWithRetry(
        `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`
      )
    ]);

    // Check responses
    console.log('📡 Network Response Status:', {
      ethereum: ethResponse.status,
      base: baseResponse.status
    });

    if (!ethResponse.ok || !baseResponse.ok) {
      const errorText = await ((!ethResponse.ok ? ethResponse : baseResponse).text());
      throw new Error(`Alchemy API error: ${errorText}`);
    }

    const [ethData, baseData] = await Promise.all([
      ethResponse.json(),
      baseResponse.json()
    ]);

    console.log('📦 ETH Network NFTs:', {
      count: ethData.ownedNfts?.length || 0,
      sampleNFT: ethData.ownedNfts?.[0]?.contract?.address
    });
    console.log('📦 BASE Network NFTs:', {
      count: baseData.ownedNfts?.length || 0,
      sampleNFT: baseData.ownedNfts?.[0]?.contract?.address
    });

    const ownedNfts = [...(ethData.ownedNfts || []), ...(baseData.ownedNfts || [])];
    console.log(`✨ Combined NFTs for ${address}:`, {
      total: ownedNfts.length,
      fromEth: ethData.ownedNfts?.length || 0,
      fromBase: baseData.ownedNfts?.length || 0
    });

    interface AlchemyNFT {
      contract: {
        address: string;
        name?: string;
        openSea?: {
          imageUrl?: string;
        };
      };
      contractMetadata?: {
        name?: string;
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
      animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string };
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
          nft.animation?.cachedUrl ||
          meta.animation_url ||
          nft.animation?.originalUrl ||
          fromMedia?.gateway ||
          fromMedia?.raw ||
          '';
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
            animationFromAlchemy,
            durableMedia,
            meta.animation_url,
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
            meta.animation_url ||
            audioFromImage ||
            '',
          image: visualCover || '',
        };
        const contractAddress = nft.contract.address.toLowerCase();
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
        const isVideo = plan.mode !== 'audio-only';

        const processedNFT: NFT = {
          contract: contractAddress,
          tokenId,
          name: meta.name || `NFT #${tokenId}`,
          description: meta.description || '',
          image: imageUrl || '',
          animationUrl: rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
          audio: audioUrl || '',
          videoUrl: videoUrl || undefined,
          playbackMode: plan.mode,
          hasValidAudio: hasAudio,
          isVideo,
          isAnimation: false,
          network,
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
            animation_url: rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
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
    console.log('🚀 === START NFT FETCH FOR FID:', fid, '===');

    // Get user profile from Neynar for verified addresses
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    console.log('📡 Fetching user profile from Neynar...');
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
    console.log('👤 Raw Neynar Profile Data:', JSON.stringify(profileData, null, 2));
    
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
      const isValid = addr && addr.startsWith('0x') && addr.length === 42;
      if (!isValid) {
        console.log('⚠️ Invalid address found:', addr);
      }
      return isValid;
    });

    if (allAddresses.length === 0) {
      throw new Error('No valid addresses found for this user');
    }

    console.log('📋 Valid addresses found:', allAddresses);

    // Process addresses sequentially
    const allNFTs: NFT[] = [];
    
    for (let i = 0; i < allAddresses.length; i++) {
      const address = allAddresses[i];
      console.log(`\n🔄 Processing address ${i + 1}/${allAddresses.length}:`, address);
      
      try {
        const nfts = await fetchOwnedNftsFromAlchemy(address);
        console.log(`✨ NFTs found for address ${address}:`, {
          total: nfts.length,
          audio: nfts.filter(nft => nft.hasValidAudio).length,
          video: nfts.filter(nft => nft.isVideo).length,
          animation: nfts.filter(nft => nft.isAnimation).length
        });
        allNFTs.push(...nfts);
        
        if (i < allAddresses.length - 1) {
          console.log('⏳ Waiting 2 seconds before next address...');
          await delay(2000);
        }
      } catch (error) {
        console.error(`❌ Error processing address ${address}:`, error);
      }
    }

    console.log('\n📊 Final NFT Collection Summary:', {
      totalNFTs: allNFTs.length,
      byType: {
        audio: allNFTs.filter(nft => nft.hasValidAudio).length,
        video: allNFTs.filter(nft => nft.isVideo).length,
        animation: allNFTs.filter(nft => nft.isAnimation).length
      }
    });
    return allNFTs;

  } catch (error) {
    console.error('❌ NFT fetch error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error
    });
    throw error;
  } finally {
    console.log('🏁 === END NFT FETCH ===');
  }
};
