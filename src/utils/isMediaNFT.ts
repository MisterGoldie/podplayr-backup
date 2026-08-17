import type { NFT, NFTFile, NFTMetadata } from '../types/user';
import {
  buildArweaveMediaFallbackUrls,
  buildIpfsFallbackUrls,
  isIpfsCorsHostileUrl,
  extractIPFSPath,
  processMediaUrl,
} from './media';
import { isNftMediaDead } from './deadNftRegistry';

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i;
const MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)(?:\?|#|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?|#|$)/i;
const MODEL_EXT_RE = /\.(glb|gltf|fbx|obj|vrm|usdz|stl)(?:\?|#|$)/i;

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

/** 3D / scene files (Remx .glb, etc.) — not <audio> or <video>. */
export const urlLooksLike3dModel = (url?: string | null): boolean => {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    MODEL_EXT_RE.test(lower) ||
    lower.includes('model/gltf') ||
    /(?:^|\/)model\//.test(lower)
  );
};

/** Stills / animated GIFs — covers, not playback sources. */
export const urlLooksLikeImage = (url?: string | null): boolean => {
  if (!url) return false;
  return IMAGE_EXT_RE.test(url);
};

const mimeLooksLike3d = (mime: string): boolean =>
  mime.startsWith('model/') || mime.includes('gltf');

/** Image, HTML, JSON, etc. — never feed these to <audio>/<video>. */
const mimeLooksLikeNonMedia = (mime: string): boolean => {
  if (!mime) return false;
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return false;
  if (mime.startsWith('image/') || mime.startsWith('text/')) return true;
  if (mime.includes('html') || mime.includes('javascript')) return true;
  if (mime.startsWith('application/json') || mime.startsWith('application/xml')) return true;
  return mimeLooksLike3d(mime);
};

const emptyPlaybackPlan = (): NftPlaybackPlan => ({
  mode: 'audio-only',
  audioUrl: null,
  videoUrl: null,
  muteVideo: true,
});

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
  if (filesHaveMedia(candidate.metadata?.properties?.files).audio) return true;
  return Boolean(pickAudioUrl(candidate) || pickVideoUrl(candidate));
};

/** True when the NFT has a video layer (animation_url that isn't a sound file). */
export const hasPlayableVideo = (candidate: MediaCandidate | NFT): boolean =>
  Boolean(pickVideoUrl(candidate));

/**
 * Keep NFTs that are playable audio or video.
 * Video = animation_url (not a sound file). Audio-only = sound URL, no video animation.
 */
export const isPlayableMediaNFT = (candidate: MediaCandidate | NFT): boolean => {
  try {
    const mime = getMimeType(candidate);
    if (mimeLooksLike3d(mime) || mimeLooksLikeNonMedia(mime)) return false;
    const urls = collectUrls(candidate);
    if (urls.length > 0 && urls.every((url) => urlLooksLike3dModel(url) || urlLooksLikeImage(url))) {
      return false;
    }
    const plan = getNftPlaybackPlan(candidate);
    const playUrl = plan.audioUrl || plan.videoUrl;
    return Boolean(playUrl) && !urlLooksLike3dModel(playUrl) && !urlLooksLikeImage(playUrl);
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
  const candidates = [
    metadata.animation_url,
    metadata.audio,
    metadata.audio_url,
    metadata.properties?.audio,
    metadata.properties?.audio_url,
    metadata.properties?.audio_file,
    metadata.properties?.soundContent?.url,
    metadata.properties?.video,
    metadata.properties?.animation_url,
  ];
  return (
    candidates.find(
      (url): url is string =>
        typeof url === 'string' &&
        url.length > 0 &&
        !urlLooksLikeImage(url) &&
        !urlLooksLike3dModel(url)
    ) || ''
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
  /** Sound source — dedicated audio file, or the video file's audio track. */
  audioUrl: string | null;
  /** Visual <video> source. Null means audio-only (poster in the player). */
  videoUrl: string | null;
  /** True when video is a companion to a separate Audio element. */
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

/** Raw animation_url from metadata only — never backfilled from audio. */
export const pickAnimationUrl = (candidate: MediaCandidate | NFT): string | null => {
  const meta = (candidate as NFT).metadata ?? (candidate as MediaCandidate).metadata ?? null;
  const typed = candidate as NFT & MediaCandidate;
  const url =
    (typeof meta?.animation_url === 'string' && meta.animation_url) ||
    (typeof meta?.properties?.animation_url === 'string' && meta.properties.animation_url) ||
    (typeof typed.animationUrl === 'string' && typed.animationUrl) ||
    null;
  return url && url.length > 0 ? url : null;
};

/** Distinct video asset from metadata (never collapses into audio). */
export const pickVideoUrl = (candidate: MediaCandidate | NFT): string | null => {
  const meta = (candidate as NFT).metadata ?? (candidate as MediaCandidate).metadata ?? null;

  const fromFiles = meta?.properties?.files?.find((f) => {
    const u = (f?.uri || f?.url || '').toLowerCase();
    const t = (f?.type || f?.mimeType || '').toLowerCase();
    return VIDEO_EXT_RE.test(u) || t.includes('video/');
  });
  if (fromFiles?.uri || fromFiles?.url) return (fromFiles.uri || fromFiles.url)!;

  const dedicatedVideo = meta?.properties?.video;
  if (
    dedicatedVideo &&
    !urlLooksLikeAudio(dedicatedVideo) &&
    !urlLooksLike3dModel(dedicatedVideo)
  ) {
    return dedicatedVideo;
  }

  // animation_url is often the SOUND file on audio NFTs (Late #7: ar:// same CID).
  // Only treat it as video when the URL or Content-Type is actually video.
  const animation = pickAnimationUrl(candidate);
  const mime =
    getMimeType(candidate) ||
    getCachedMediaMime(animation) ||
    getCachedMediaMime((candidate as NFT).videoUrl);
  if (animation && (urlLooksLikeVideo(animation) || mime.startsWith('video/'))) {
    return animation;
  }

  const stored = (candidate as NFT).videoUrl;
  if (
    stored &&
    !urlLooksLikeAudio(stored) &&
    (urlLooksLikeVideo(stored) || mime.startsWith('video/') || getCachedMediaMime(stored).startsWith('video/'))
  ) {
    return stored;
  }

  return null;
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
    (url) =>
      !urlLooksLikeVideo(url) && !urlLooksLike3dModel(url) && !urlLooksLikeImage(url)
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
  const animation = pickAnimationUrl(nft);
  const mime =
    getMimeType(nft) ||
    getCachedMediaMime(audioUrl || animation || videoUrl || typed.audio || '');

  if (
    mimeLooksLikeNonMedia(mime) ||
    urlLooksLikeImage(audioUrl) ||
    (urlLooksLikeImage(animation) &&
      !urlLooksLikeAudio(animation || '') &&
      !urlLooksLikeVideo(animation || ''))
  ) {
    const hasRealMedia =
      (audioUrl && !urlLooksLikeImage(audioUrl) && !urlLooksLike3dModel(audioUrl)) ||
      (videoUrl && !urlLooksLikeImage(videoUrl) && !urlLooksLike3dModel(videoUrl));
    if (!hasRealMedia) return emptyPlaybackPlan();
  }

  if (mimeLooksLike3d(mime) || urlLooksLike3dModel(audioUrl) || urlLooksLike3dModel(animation) || urlLooksLike3dModel(videoUrl)) {
    const hasRealMedia =
      (audioUrl && !urlLooksLike3dModel(audioUrl)) ||
      (videoUrl && !urlLooksLike3dModel(videoUrl));
    if (!hasRealMedia) {
      return {
        mode: 'audio-only',
        audioUrl: null,
        videoUrl: null,
        muteVideo: true,
      };
    }
  }

  // Confirmed audio file — even if metadata stuffed it into animation_url (Late #7).
  if (mime.startsWith('audio/')) {
    return {
      mode: 'audio-only',
      audioUrl: audioUrl || animation || pickRawMediaUrl(meta) || null,
      videoUrl: null,
      muteVideo: true,
    };
  }

  // Same CID on audio and animation is only video when Content-Type is video.
  if (
    !videoUrl &&
    animation &&
    audioUrl &&
    mediaAssetId(animation) === mediaAssetId(audioUrl) &&
    (urlLooksLikeVideo(animation) || mime.startsWith('video/'))
  ) {
    videoUrl = animation;
  }

  if (!videoUrl && typed.videoUrl && !urlLooksLikeAudio(typed.videoUrl)) {
    if (urlLooksLikeVideo(typed.videoUrl) || mime.startsWith('video/')) {
      videoUrl = typed.videoUrl;
    }
  }

  // Stored isVideo from a previous correct classify — still require video evidence.
  if (!videoUrl && typed.isVideo && !mime.startsWith('audio/')) {
    const stored = typed.videoUrl || typed.audio || audioUrl;
    if (stored && (urlLooksLikeVideo(stored) || mime.startsWith('video/'))) {
      videoUrl = stored;
    }
  }

  // Firebase often stuffed the video CID into audioUrl. Only promote when
  // Content-Type is already known to be video (stored mediaMime or probe cache).
  if (
    !videoUrl &&
    audioUrl &&
    !urlLooksLikeAudio(audioUrl) &&
    mime.startsWith('video/')
  ) {
    videoUrl = audioUrl;
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
      muteVideo: false,
    };
  }

  const rawFallback = pickRawMediaUrl(meta);
  const fallback =
    (audioUrl && !urlLooksLike3dModel(audioUrl) && !urlLooksLikeImage(audioUrl) ? audioUrl : null) ||
    (rawFallback && !urlLooksLike3dModel(rawFallback) && !urlLooksLikeImage(rawFallback)
      ? rawFallback
      : null);

  return {
    mode: 'audio-only',
    audioUrl: fallback,
    videoUrl: null,
    muteVideo: true,
  };
};

const mimeProbeCache = new Map<string, string>();
const mimeSourceCache = new Map<string, string>();
const deadGatewayHosts = new Map<string, Set<string>>();
const MIME_CACHE_KEY = 'podplayr_media_mime';
let mimeCacheLoaded = false;
let mimePersistTimer: ReturnType<typeof setTimeout> | null = null;

const loadMimeCache = (): void => {
  if (mimeCacheLoaded || typeof window === 'undefined') return;
  mimeCacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(MIME_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string | { mime?: string; url?: string }>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value) continue;
      if (typeof value === 'string') {
        mimeProbeCache.set(key, value);
      } else {
        if (value.mime) mimeProbeCache.set(key, value.mime);
        if (value.url) mimeSourceCache.set(key, value.url);
      }
    }
  } catch {
    // ignore quota / private mode
  }
};

const persistMimeCache = (): void => {
  if (typeof window === 'undefined') return;
  if (mimePersistTimer) clearTimeout(mimePersistTimer);
  mimePersistTimer = setTimeout(() => {
    try {
      const obj: Record<string, { mime: string; url?: string }> = {};
      mimeProbeCache.forEach((mime, key) => {
        obj[key] = { mime, url: mimeSourceCache.get(key) };
      });
      window.localStorage.setItem(MIME_CACHE_KEY, JSON.stringify(obj));
    } catch {
      // ignore quota / private mode
    }
  }, 200);
};

export const rememberMediaMime = (url: string, mime: string): void => {
  if (!url || !mime) return;
  const clean = mime.split(';')[0].trim().toLowerCase();
  if (!clean) return;
  loadMimeCache();
  mimeProbeCache.set(mediaAssetId(url), clean);
  persistMimeCache();
};

export const getCachedMediaMime = (url?: string | null): string => {
  loadMimeCache();
  if (!url) return '';
  return mimeProbeCache.get(mediaAssetId(url)) || '';
};

export const getCachedMediaSourceUrl = (url?: string | null): string => {
  loadMimeCache();
  if (!url) return '';
  return mimeSourceCache.get(mediaAssetId(url)) || '';
};

export const rememberDeadGateway = (assetUrl: string, gatewayUrl: string): void => {
  try {
    const host = new URL(gatewayUrl).hostname;
    const id = mediaAssetId(assetUrl);
    if (!deadGatewayHosts.has(id)) deadGatewayHosts.set(id, new Set());
    deadGatewayHosts.get(id)!.add(host);
  } catch {
    // ignore
  }
};

export const filterLivePlaybackUrls = (assetUrl: string, urls: string[]): string[] => {
  const dead = deadGatewayHosts.get(mediaAssetId(assetUrl));
  const source = getCachedMediaSourceUrl(assetUrl);
  const ordered = source
    ? [source, ...urls.filter((u) => u !== source)]
    : urls;
  if (!dead?.size) return ordered;
  const live = ordered.filter((u) => {
    try {
      return !dead.has(new URL(u).hostname);
    } catch {
      return true;
    }
  });
  return live.length ? live : ordered;
};

/** True when URL has no clear audio/video extension (Arweave/IPFS CIDs). */
export const mediaUrlNeedsMimeProbe = (url?: string | null): boolean => {
  if (!url) return false;
  if (
    urlLooksLikeAudio(url) ||
    urlLooksLikeVideo(url) ||
    urlLooksLike3dModel(url) ||
    urlLooksLikeImage(url)
  ) {
    return false;
  }
  return true;
};

/**
 * HEAD (or Range GET) Content-Type for extensionless media.
 * Music Mondays-style: audioUrl is actually video/mp4 with no .mp4 suffix.
 * Tries turbo/permagate/arweave gateways when the primary URL fails.
 */
export const probeMediaContentType = async (url: string): Promise<string> => {
  loadMimeCache();
  const cacheKey = mediaAssetId(url);
  if (mimeProbeCache.has(cacheKey)) {
    return mimeProbeCache.get(cacheKey)!;
  }

  const candidates = new Set<string>();
  if (/arweave|ar:\/\/|turbo-gateway|permagate|irys|ar-io|g8way/i.test(url)) {
    if (url.startsWith('http')) candidates.add(url);
    const primary = processMediaUrl(url, '', 'audio');
    if (primary) candidates.add(primary);
    buildArweaveMediaFallbackUrls(url).slice(0, 4).forEach((u) => candidates.add(u));
  } else if (url.startsWith('ipfs://') || extractIPFSPath(url)) {
    // Prefer Pinata / ipfs.io. Skip w3s / nft.storage / dweb — they CORS-fail
    // from the mini-app / tunnel origin and stall NFT card hydration.
    buildIpfsFallbackUrls(url, { kind: 'media' })
      .filter((u) => !isIpfsCorsHostileUrl(u))
      .slice(0, 4)
      .forEach((u) => candidates.add(u));
  } else {
    const primary = processMediaUrl(url, '', 'audio');
    if (primary) candidates.add(primary);
    if (!isIpfsCorsHostileUrl(url)) candidates.add(url);
  }

  const store = (ct: string, sourceUrl: string) => {
    const mime = ct.split(';')[0].trim().toLowerCase();
    if (!mime) return '';
    mimeProbeCache.set(cacheKey, mime);
    if (!mimeLooksLikeNonMedia(mime)) {
      mimeSourceCache.set(cacheKey, sourceUrl);
    }
    persistMimeCache();
    return mime;
  };

  const timedFetch = (u: string, init: RequestInit) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    return fetch(u, { ...init, signal: ctrl.signal, mode: 'cors' }).finally(() =>
      clearTimeout(t)
    );
  };

  const probeList = filterLivePlaybackUrls(url, Array.from(candidates)).filter(
    (u) => !isIpfsCorsHostileUrl(u)
  );

  for (const probeUrl of probeList) {
    try {
      const head = await timedFetch(probeUrl, { method: 'HEAD' });
      const headCt = head.headers.get('content-type');
      if (head.status === 404 || head.status === 410 || head.status >= 500) {
        rememberDeadGateway(url, probeUrl);
        continue;
      }
      if (head.ok && headCt) {
        const mime = store(headCt, probeUrl);
        if (mime) return mime;
      }
    } catch {
      // CORS / network — do not keep hammering this host for this CID
      rememberDeadGateway(url, probeUrl);
      continue;
    }

    try {
      const get = await timedFetch(probeUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      const getCt = get.headers.get('content-type');
      if (get.status === 404 || get.status === 410 || get.status >= 500) {
        rememberDeadGateway(url, probeUrl);
        continue;
      }
      if (getCt) {
        const mime = store(getCt, probeUrl);
        if (mime) return mime;
      }
    } catch {
      rememberDeadGateway(url, probeUrl);
    }
  }

  return '';
};

/** Stamp resolved plan fields onto the NFT. Never copy audio onto animation_url for audio-only. */
export const applyPlaybackPlanToNft = (nft: NFT, plan: NftPlaybackPlan, mime?: string): void => {
  nft.playbackMode = plan.mode;
  nft.isVideo = plan.mode !== 'audio-only';
  nft.videoUrl = plan.mode === 'audio-only' ? undefined : plan.videoUrl || undefined;
  if (plan.audioUrl) {
    nft.audio = plan.audioUrl;
    nft.hasValidAudio = true;
  } else if (!plan.videoUrl) {
    nft.audio = '';
    nft.hasValidAudio = false;
    nft.isVideo = false;
  }
  if (!nft.metadata) {
    nft.metadata = { image: nft.image };
  }
  if (plan.videoUrl && plan.mode !== 'audio-only') {
    nft.metadata.animation_url = nft.metadata.animation_url || plan.videoUrl;
  }
  if (mime) {
    nft.metadata.mimeType = mime;
  }
};

type StoredPlaybackFields = {
  animationUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  isVideo?: boolean;
  playbackMode?: string;
  metadata?: { animation_url?: string } | null;
};

/**
 * Rebuild animation_url from a Firebase play/like/top-played doc.
 * Old docs often only stored audioUrl. Top-played never stored animationUrl,
 * so that list may treat a bare audioUrl as the animation (those rows are videos).
 * Likes/library must NOT do that — Late #7 is audio-only with no animation_url.
 */
export const restoreStoredAnimationUrl = (
  data: StoredPlaybackFields,
  opts?: { legacyAudioIsAnimation?: boolean }
): string => {
  const stored =
    (typeof data.metadata?.animation_url === 'string' && data.metadata.animation_url) ||
    data.animationUrl ||
    data.videoUrl ||
    '';
  if (stored) return stored;
  if (
    data.isVideo ||
    data.playbackMode === 'video-with-audio' ||
    data.playbackMode === 'video-plus-audio'
  ) {
    return data.audioUrl || '';
  }
  if (opts?.legacyAudioIsAnimation) {
    return data.audioUrl || '';
  }
  return '';
};

export const hydrateNftPlayback = (nft: NFT): NFT => {
  const plan = getNftPlaybackPlan(nft);
  applyPlaybackPlanToNft(nft, plan);
  const mime = getMimeType(nft);
  const url = plan.videoUrl || plan.audioUrl || nft.audio;
  if (mime && url) rememberMediaMime(url, mime);
  return nft;
};

const PROBE_CONCURRENCY = 6;

/**
 * HEAD every Firebase/list NFT still classified audio-only whose CID has no
 * .mp3/.mp4 suffix. video/mp4 → video-with-audio. audio/* stays audio-only.
 */
export const confirmAudioOnlyPlayback = async (nfts: NFT[]): Promise<boolean> => {
  if (!nfts?.length) return false;
  loadMimeCache();
  let changed = false;
  const pending: NFT[] = [];

  for (const nft of nfts) {
    const sync = getNftPlaybackPlan(nft);
    const url = sync.videoUrl || sync.audioUrl || nft.audio;
    if (urlLooksLike3dModel(url) || urlLooksLikeImage(url) || mimeLooksLike3d(getMimeType(nft))) {
      if (urlLooksLikeImage(url) || mimeLooksLikeNonMedia(getMimeType(nft))) {
        applyPlaybackPlanToNft(nft, emptyPlaybackPlan());
        changed = true;
      }
      continue;
    }
    const known = getMimeType(nft) || getCachedMediaMime(url);
    if (mimeLooksLikeNonMedia(known)) {
      applyPlaybackPlanToNft(nft, emptyPlaybackPlan(), known);
      changed = true;
      continue;
    }
    if (known.startsWith('audio/')) {
      if (sync.mode !== 'audio-only' || nft.isVideo || nft.videoUrl) {
        applyPlaybackPlanToNft(
          nft,
          { mode: 'audio-only', audioUrl: url || null, videoUrl: null, muteVideo: true },
          known
        );
        changed = true;
      }
      continue;
    }
    if (known.startsWith('video/')) {
      if (sync.videoUrl) {
        if (nft.playbackMode !== sync.mode || !nft.metadata?.animation_url) {
          applyPlaybackPlanToNft(nft, sync, known);
          changed = true;
        }
        continue;
      }
    }
    if (!mediaUrlNeedsMimeProbe(url)) continue;
    pending.push(nft);
  }

  if (!pending.length) return changed;

  let index = 0;
  const worker = async () => {
    while (index < pending.length) {
      const nft = pending[index++];
      const prevMode = nft.playbackMode;
      const prevAnim = nft.metadata?.animation_url;
      const prevAudio = nft.audio;
      await resolveNftPlaybackPlan(nft);
      if (
        nft.playbackMode !== prevMode ||
        nft.metadata?.animation_url !== prevAnim ||
        nft.audio !== prevAudio
      ) {
        changed = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, () => worker())
  );
  return changed;
};

/** Probe in the background and notify when any NFT flips to video. */
export const applyConfirmedPlayback = (
  nfts: NFT[],
  onChange: (nfts: NFT[]) => void
): void => {
  void confirmAudioOnlyPlayback(nfts).then((changed) => {
    if (changed) onChange(nfts.slice());
  });
};

/**
 * Async plan: probes Content-Type when sync heuristics miss video stuffed as audioUrl
 * (common for Arweave tx ids with a static image poster).
 */
export const resolveNftPlaybackPlan = async (
  nft: MediaCandidate | NFT
): Promise<NftPlaybackPlan> => {
  const typed = nft as NFT;
  const sync = getNftPlaybackPlan(nft);
  const candidate =
    sync.videoUrl ||
    sync.audioUrl ||
    typed.audio ||
    typed.metadata?.animation_url ||
    (nft as MediaCandidate).animationUrl ||
    null;

  const emptyPlan = emptyPlaybackPlan;

  const audioPlan = (): NftPlaybackPlan => ({
    mode: 'audio-only',
    audioUrl:
      (sync.audioUrl && !urlLooksLike3dModel(sync.audioUrl) && !urlLooksLikeImage(sync.audioUrl)
        ? sync.audioUrl
        : null) ||
      (candidate && !urlLooksLike3dModel(candidate) && !urlLooksLikeImage(candidate)
        ? candidate
        : null),
    videoUrl: null,
    muteVideo: true,
  });
  const videoPlan = (url: string, mime?: string): NftPlaybackPlan => {
    const plan: NftPlaybackPlan = {
      mode: 'video-with-audio',
      audioUrl: url,
      videoUrl: url,
      muteVideo: false,
    };
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, mime);
    return plan;
  };

  const known = getMimeType(nft) || getCachedMediaMime(candidate);
  if (
    mimeLooksLike3d(known) ||
    mimeLooksLikeNonMedia(known) ||
    urlLooksLike3dModel(candidate) ||
    urlLooksLikeImage(candidate)
  ) {
    const plan = emptyPlan();
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, known || undefined);
    return plan;
  }
  if (known.startsWith('audio/')) {
    const plan = audioPlan();
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, known);
    return plan;
  }
  if (known.startsWith('video/')) {
    return sync.videoUrl ? sync : videoPlan(candidate!, known);
  }

  if (!candidate || !mediaUrlNeedsMimeProbe(candidate)) return sync;

  const mime = await probeMediaContentType(candidate);
  if (mime.startsWith('video/')) return videoPlan(candidate, mime);
  if (mime.startsWith('audio/')) {
    const plan = audioPlan();
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, mime);
    return plan;
  }
  if (mimeLooksLikeNonMedia(mime)) {
    const plan = emptyPlan();
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, mime);
    return plan;
  }

  return sync;
};

