import type { NFT, NFTFile, NFTMetadata } from '../types/user';
import {
  buildArweaveMediaFallbackUrls,
  buildIpfsFallbackUrls,
  extractIPFSPath,
  processMediaUrl,
} from './media';
import { isNftMediaDead } from './deadNftRegistry';

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i;
const MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)(?:\?|#|$)/i;

export type MediaCandidate = {
  audio?: string | null;
  animationUrl?: string | null;
  hasValidAudio?: boolean;
  isVideo?: boolean;
  isAnimation?: boolean;
  metadata?: NFTMetadata | null;
};

const collectUrls = (candidate: MediaCandidate): string[] => {
  const meta = candidate.metadata;
  const urls = [
    candidate.audio,
    candidate.animationUrl,
    meta?.animation_url,
    meta?.audio,
    meta?.audio_url,
    meta?.properties?.audio,
    meta?.properties?.audio_url,
    meta?.properties?.audio_file,
    meta?.properties?.soundContent?.url,
    meta?.properties?.video,
    meta?.properties?.animation_url,
  ];

  return urls.filter((url): url is string => typeof url === 'string' && url.length > 0);
};

const getMimeType = (candidate: MediaCandidate): string => {
  const meta = candidate.metadata;
  return (
    meta?.mimeType ||
    meta?.mime_type ||
    meta?.properties?.mimeType ||
    meta?.content?.mime ||
    ''
  ).toLowerCase();
};

const urlLooksLikeAudio = (url: string): boolean => {
  const lower = url.toLowerCase();
  return (
    AUDIO_EXT_RE.test(lower) ||
    lower.includes('audio/') ||
    // PODs-style ar://manifest/<txid>.mp3
    /^ar:\/\/[^/]+\/[^/]+\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(url)
  );
};

const urlLooksLikeVideo = (url: string): boolean => {
  const lower = url.toLowerCase();
  return (
    VIDEO_EXT_RE.test(lower) ||
    lower.includes('video/') ||
    /^ar:\/\/[^/]+\/[^/]+\.(mp4|webm|mov|m4v)$/i.test(url)
  );
};

const filesHaveMedia = (files?: NFTFile[] | null): { audio: boolean; video: boolean } => {
  if (!files?.length) return { audio: false, video: false };

  let audio = false;
  let video = false;

  for (const file of files) {
    if (!file) continue;
    const fileUrl = (file.uri || file.url || '').toLowerCase();
    const fileType = (file.type || file.mimeType || '').toLowerCase();

    if (
      AUDIO_EXT_RE.test(fileUrl) ||
      fileType.includes('audio/')
    ) {
      audio = true;
    }
    if (
      VIDEO_EXT_RE.test(fileUrl) ||
      fileType.includes('video/')
    ) {
      video = true;
    }
  }

  return { audio, video };
};

/** True when the NFT has playable audio (not merely any animation_url / IPFS). */
export const hasPlayableAudio = (candidate: MediaCandidate | NFT): boolean => {
  const mime = getMimeType(candidate);
  if (mime.startsWith('audio/')) return true;

  if (collectUrls(candidate).some(urlLooksLikeAudio)) return true;

  return filesHaveMedia(candidate.metadata?.properties?.files).audio;
};

/** True when the NFT has playable video. */
export const hasPlayableVideo = (candidate: MediaCandidate | NFT): boolean => {
  const mime = getMimeType(candidate);
  if (mime.startsWith('video/')) return true;

  if (collectUrls(candidate).some(urlLooksLikeVideo)) return true;

  return filesHaveMedia(candidate.metadata?.properties?.files).video;
};

/**
 * Keep NFTs that are playable audio or video.
 * Rejects bare `includes('ipfs')`, name keywords, and "any animation_url = audio".
 */
export const isPlayableMediaNFT = (candidate: MediaCandidate | NFT): boolean => {
  try {
    return hasPlayableAudio(candidate) || hasPlayableVideo(candidate);
  } catch {
    return false;
  }
};

/** Filter helper for profile/Demo grids. Also drops NFTs whose media is confirmed dead (see deadNftRegistry). */
export const filterPlayableMediaNFTs = <T extends MediaCandidate | NFT>(nfts: T[]): T[] => {
  if (!nfts?.length) return [];
  return nfts.filter((nft) => isPlayableMediaNFT(nft) && !isNftMediaDead(nft as NFT));
};

/** Pick the best raw media URL from metadata before processMediaUrl. */
export const pickRawMediaUrl = (metadata?: NFTMetadata | null): string => {
  if (!metadata) return '';
  return (
    metadata.animation_url ||
    metadata.audio ||
    metadata.audio_url ||
    metadata.properties?.audio ||
    metadata.properties?.audio_url ||
    metadata.properties?.audio_file ||
    metadata.properties?.soundContent?.url ||
    metadata.properties?.video ||
    metadata.properties?.animation_url ||
    ''
  );
};

export const mediaUrlHasAudioExt = (url?: string | null): boolean =>
  !!url && urlLooksLikeAudio(url);

export const mediaUrlHasVideoExt = (url?: string | null): boolean =>
  !!url && urlLooksLikeVideo(url);

export const mediaUrlHasMediaExt = (url?: string | null): boolean =>
  !!url && MEDIA_EXT_RE.test(url);

/** How media was authored — drives player routing. */
export type NftPlaybackMode = 'audio-only' | 'video-with-audio' | 'video-plus-audio';

export type NftPlaybackPlan = {
  mode: NftPlaybackMode;
  /** Raw URL for the sound source (Audio element). */
  audioUrl: string | null;
  /** Raw URL for visual <video> (null → show image). */
  videoUrl: string | null;
  /** Always true when video is a companion to a separate Audio element. */
  muteVideo: boolean;
};

const firstUrl = (
  urls: Array<string | null | undefined>,
  pred: (url: string) => boolean
): string | null => {
  for (const url of urls) {
    if (typeof url === 'string' && url.length > 0 && pred(url)) return url;
  }
  return null;
};

/** Stable id so gateway variants of the same CID/tx count as one asset. */
export const mediaAssetId = (url: string): string => {
  if (!url) return '';
  const cleaned = url.trim();
  const ipfs = cleaned.match(/(?:ipfs\/|ipfs:\/\/)(.+)$/i);
  if (ipfs?.[1]) {
    return `ipfs:${decodeURIComponent(ipfs[1]).replace(/\/+$/, '').toLowerCase()}`;
  }
  const ar = cleaned.match(
    /(?:ar:\/\/|arweave\.net\/(?:raw\/)?|turbo-gateway\.com\/(?:raw\/)?|permagate\.io\/(?:raw\/)?)([a-zA-Z0-9_-]{20,})/i
  );
  if (ar?.[1]) return `ar:${ar[1].replace(MEDIA_EXT_RE, '')}`;
  try {
    const u = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return cleaned.toLowerCase().replace(/\/+$/, '');
  }
};

/** Distinct video asset from metadata (never collapses into audio). */
export const pickVideoUrl = (candidate: MediaCandidate | NFT): string | null => {
  const meta = (candidate as NFT).metadata ?? (candidate as MediaCandidate).metadata ?? null;
  const mime = getMimeType(candidate);

  const fromFiles = meta?.properties?.files?.find((f) => {
    const u = (f?.uri || f?.url || '').toLowerCase();
    const t = (f?.type || f?.mimeType || '').toLowerCase();
    return VIDEO_EXT_RE.test(u) || t.includes('video/');
  });
  if (fromFiles?.uri || fromFiles?.url) return (fromFiles.uri || fromFiles.url)!;

  if (mime.startsWith('video/')) {
    return (
      firstUrl(
        [
          meta?.animation_url,
          meta?.properties?.video,
          meta?.properties?.animation_url,
          meta?.properties?.visual?.url,
          (candidate as MediaCandidate).animationUrl,
        ],
        () => true
      ) || meta?.animation_url || null
    );
  }

  return firstUrl(
    [
      meta?.properties?.video,
      meta?.animation_url,
      meta?.properties?.animation_url,
      meta?.properties?.visual?.url,
      (candidate as MediaCandidate).animationUrl,
    ],
    urlLooksLikeVideo
  );
};

/**
 * Distinct audio/sound asset. Prefers dedicated audio fields over animation_url
 * so dual media (mp4 + mp3) keeps both URLs.
 */
export const pickAudioUrl = (candidate: MediaCandidate | NFT): string | null => {
  const meta = (candidate as NFT).metadata ?? (candidate as MediaCandidate).metadata ?? null;
  const nftAudio = (candidate as NFT).audio ?? (candidate as MediaCandidate).audio ?? null;
  const mime = getMimeType(candidate);

  const dedicated = firstUrl(
    [
      nftAudio,
      meta?.audio,
      meta?.audio_url,
      meta?.properties?.audio,
      meta?.properties?.audio_url,
      meta?.properties?.audio_file,
      meta?.properties?.soundContent?.url,
    ],
    (url) => !urlLooksLikeVideo(url)
  );
  if (dedicated) return dedicated;

  const fromFiles = meta?.properties?.files?.find((f) => {
    const u = (f?.uri || f?.url || '').toLowerCase();
    const t = (f?.type || f?.mimeType || '').toLowerCase();
    return AUDIO_EXT_RE.test(u) || t.includes('audio/');
  });
  if (fromFiles?.uri || fromFiles?.url) return (fromFiles.uri || fromFiles.url)!;

  if (mime.startsWith('audio/')) {
    return meta?.animation_url || dedicated;
  }

  // animation_url that is clearly audio
  return firstUrl([meta?.animation_url, (candidate as MediaCandidate).animationUrl], urlLooksLikeAudio);
};

/**
 * Classify playback layout without collapsing video+audio into one URL.
 *
 * - audio-only: sound file, no video layer
 * - video-with-audio: one video file (picture+sound, or video-only unknown)
 * - video-plus-audio: distinct video URL + distinct audio URL
 */
export const getNftPlaybackPlan = (nft: MediaCandidate | NFT): NftPlaybackPlan => {
  const meta = (nft as NFT).metadata ?? (nft as MediaCandidate).metadata ?? null;
  const typed = nft as NFT;

  let videoUrl = pickVideoUrl(nft);
  let audioUrl = pickAudioUrl(nft);

  // Prefer explicitly stored videoUrl from ingest
  if (!videoUrl && typed.videoUrl) {
    videoUrl = typed.videoUrl;
  }

  // Extensionless animation_url (common on IPFS/Arweave CIDs): if already flagged as
  // video, or animation isn't clearly audio, treat animation_url as the video layer.
  const animation = meta?.animation_url || (nft as MediaCandidate).animationUrl || null;
  if (!videoUrl && animation && !urlLooksLikeAudio(animation)) {
    if (
      typed.isVideo ||
      typed.playbackMode === 'video-with-audio' ||
      typed.playbackMode === 'video-plus-audio' ||
      getMimeType(nft).startsWith('video/') ||
      urlLooksLikeVideo(animation)
    ) {
      videoUrl = animation;
    }
  }

  // Dual: distinct assets
  if (videoUrl && audioUrl && mediaAssetId(videoUrl) !== mediaAssetId(audioUrl)) {
    return {
      mode: 'video-plus-audio',
      audioUrl,
      videoUrl,
      muteVideo: true,
    };
  }

  if (videoUrl) {
    return {
      mode: 'video-with-audio',
      audioUrl:
        audioUrl && mediaAssetId(audioUrl) === mediaAssetId(videoUrl)
          ? audioUrl
          : videoUrl,
      videoUrl,
      muteVideo: true,
    };
  }

  const fallback =
    audioUrl ||
    pickRawMediaUrl(meta) ||
    null;

  return {
    mode: 'audio-only',
    audioUrl: fallback,
    videoUrl: null,
    muteVideo: true,
  };
};

const mimeProbeCache = new Map<string, string>();

/** True when URL has no clear audio/video extension (Arweave/IPFS CIDs). */
export const mediaUrlNeedsMimeProbe = (url?: string | null): boolean => {
  if (!url) return false;
  if (urlLooksLikeAudio(url) || urlLooksLikeVideo(url)) return false;
  return true;
};

/**
 * HEAD (or Range GET) Content-Type for extensionless media.
 * Music Mondays-style: audioUrl is actually video/mp4 with no .mp4 suffix.
 * Tries turbo/permagate/arweave gateways when the primary URL fails.
 */
export const probeMediaContentType = async (url: string): Promise<string> => {
  const cacheKey = mediaAssetId(url);
  if (mimeProbeCache.has(cacheKey)) {
    return mimeProbeCache.get(cacheKey)!;
  }

  const candidates = new Set<string>();
  const primary = processMediaUrl(url, '', 'audio');
  if (primary) candidates.add(primary);
  candidates.add(url);
  if (/arweave|ar:\/\/|turbo-gateway|permagate|irys|ar-io|g8way/i.test(url)) {
    buildArweaveMediaFallbackUrls(url).slice(0, 4).forEach((u) => candidates.add(u));
  } else if (url.startsWith('ipfs://') || extractIPFSPath(url)) {
    buildIpfsFallbackUrls(url).slice(0, 3).forEach((u) => candidates.add(u));
  }

  const store = (ct: string) => {
    const mime = ct.split(';')[0].trim().toLowerCase();
    if (mime && !mime.includes('text/html')) {
      mimeProbeCache.set(cacheKey, mime);
      return mime;
    }
    return '';
  };

  const timedFetch = (u: string, init: RequestInit) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    return fetch(u, { ...init, signal: ctrl.signal, mode: 'cors' }).finally(() =>
      clearTimeout(t)
    );
  };

  for (const probeUrl of candidates) {
    try {
      const head = await timedFetch(probeUrl, { method: 'HEAD' });
      const headCt = head.headers.get('content-type');
      if (head.ok && headCt) {
        const mime = store(headCt);
        if (mime) return mime;
      }
    } catch {
      // try Range GET
    }

    try {
      const get = await timedFetch(probeUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      const getCt = get.headers.get('content-type');
      if (getCt) {
        const mime = store(getCt);
        if (mime) return mime;
      }
    } catch {
      // next candidate
    }
  }

  return '';
};

/** Stamp resolved plan fields onto the NFT for Firebase + MaximizedPlayer. */
export const applyPlaybackPlanToNft = (nft: NFT, plan: NftPlaybackPlan, mime?: string): void => {
  nft.playbackMode = plan.mode;
  nft.isVideo = plan.mode !== 'audio-only';
  if (plan.videoUrl) nft.videoUrl = plan.videoUrl;
  if (plan.audioUrl) nft.audio = plan.audioUrl;
  if (!nft.metadata) {
    nft.metadata = { image: nft.image };
  }
  if (plan.videoUrl) {
    nft.metadata.animation_url = plan.videoUrl;
  } else if (plan.audioUrl && !nft.metadata.animation_url) {
    nft.metadata.animation_url = plan.audioUrl;
  }
  if (mime) {
    nft.metadata.mimeType = mime;
  }
};

/**
 * Async plan: probes Content-Type when sync heuristics miss video stuffed as audioUrl
 * (common for Arweave tx ids with a static image poster).
 */
export const resolveNftPlaybackPlan = async (
  nft: MediaCandidate | NFT
): Promise<NftPlaybackPlan> => {
  const sync = getNftPlaybackPlan(nft);
  if (sync.videoUrl) return sync;

  const typed = nft as NFT;
  const candidate =
    sync.audioUrl ||
    typed.audio ||
    typed.metadata?.animation_url ||
    (nft as MediaCandidate).animationUrl ||
    null;

  if (!mediaUrlNeedsMimeProbe(candidate)) return sync;

  const mime = await probeMediaContentType(candidate!);
  if (mime.startsWith('video/')) {
    const plan: NftPlaybackPlan = {
      mode: 'video-with-audio',
      audioUrl: candidate,
      videoUrl: candidate,
      muteVideo: true,
    };
    if (typed.contract) {
      applyPlaybackPlanToNft(typed, plan, mime);
    }
    return plan;
  }

  if (mime.startsWith('audio/') && typed.metadata) {
    typed.metadata.mimeType = mime;
  }

  return sync;
};

