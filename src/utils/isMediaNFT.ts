import type { NFT, NFTFile, NFTMetadata } from '../types/user';
import {
  buildArweaveMediaFallbackUrls,
  buildIpfsFallbackUrls,
  isIpfsCorsHostileUrl,
  extractIPFSPath,
  parseArweaveMediaPath,
  processMediaUrl,
  arweaveGatewayApexHost,
  arweaveSandboxId,
} from './media';
import { isBareIpfsFileCid, isExtensionlessArweaveTx, urlLooksLikeExtensionlessVideo } from './ipfsExtensionlessMedia';
import { isNftMediaDead } from './deadNftRegistry';
import { isBlockedNftContract, isPhishingSpamNft, isUnsafePlaybackUrl, urlLooksLikeInteractivePage } from './nftSafety';
import { isMuxPlaybackUrl, isPollutedPlaybackUrl, isWeakPlaybackUrl } from '../lib/mediaCdn';

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

  return urls.filter(
    (url): url is string =>
      typeof url === 'string' && url.length > 0 && !isUnsafePlaybackUrl(url)
  );
};

const getMimeType = (candidate: MediaCandidate): string => {
  const meta = candidate.metadata;
  const format = String(meta?.animation_details?.format || '').toLowerCase();
  // OpenSea/Alchemy often stamp video/mp4 on GLB animations (Smiling Hound).
  if (format === 'glb' || format === 'gltf' || format === 'gltf-binary') {
    return 'model/gltf-binary';
  }
  if (format === 'vrm') return 'model/gltf-binary';
  if (format === 'usdz' || format === 'fbx' || format === 'obj' || format === 'stl') {
    return `model/${format}`;
  }
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
    /\.m3u8(?:\?|#|$)/i.test(lower) ||
    /stream\.mux\.com/i.test(lower) ||
    lower.includes('video/') ||
    /^ar:\/\/[^/]+\/[^/]+\.(mp4|webm|mov|m4v)$/i.test(url) ||
    urlLooksLikeExtensionlessVideo(url)
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

export { urlLooksLikeInteractivePage } from './nftSafety';

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
    if (isBlockedNftContract((candidate as NFT).contract)) return false;
    if (isPhishingSpamNft(candidate as NFT)) return false;
    const mime = getMimeType(candidate);
    if (mimeLooksLike3d(mime) || mimeLooksLikeNonMedia(mime)) return false;
    const urls = collectUrls(candidate);
    if (
      urls.length > 0 &&
      urls.every(
        (url) =>
          urlLooksLike3dModel(url) || urlLooksLikeImage(url) || urlLooksLikeInteractivePage(url)
      )
    ) {
      return false;
    }
    const plan = getNftPlaybackPlan(candidate);
    const playUrl = plan.audioUrl || plan.videoUrl;
    return (
      Boolean(playUrl) &&
      !isUnsafePlaybackUrl(playUrl) &&
      !urlLooksLike3dModel(playUrl) &&
      !urlLooksLikeImage(playUrl) &&
      !urlLooksLikeInteractivePage(playUrl)
    );
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
        !isUnsafePlaybackUrl(url) &&
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
    if (typeof url === 'string' && url.length > 0 && !isUnsafePlaybackUrl(url) && pred(url)) return url;
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
  return url && url.length > 0 && !isUnsafePlaybackUrl(url) ? url : null;
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
    !isUnsafePlaybackUrl(dedicatedVideo) &&
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
  if (
    animation &&
    !isPollutedPlaybackUrl(animation) &&
    (urlLooksLikeVideo(animation) || mime.startsWith('video/'))
  ) {
    return animation;
  }

  const stored = (candidate as NFT).videoUrl;
  if (
    stored &&
    !urlLooksLikeAudio(stored) &&
    !isPollutedPlaybackUrl(stored) &&
    (urlLooksLikeVideo(stored) || mime.startsWith('video/') || getCachedMediaMime(stored).startsWith('video/'))
  ) {
    return stored;
  }

  // Rodeo / OpenSea often put the mp4 on image / display_image_url and leave
  // animation_url empty. That's still the video, not a cover. Do not use
  // urlLooksLikeVideo() here — Cloudinary `video/fetch` stills contain
  // "video/" in the path and are PNG frames, not playback.
  const imageVideo = [
    meta?.display_image_url,
    meta?.image_url,
    meta?.image,
    (candidate as NFT).image,
  ].find((u) => {
    if (typeof u !== 'string' || !u || isPollutedPlaybackUrl(u) || urlLooksLikeAudio(u)) {
      return false;
    }
    if (/\/video\/fetch\//i.test(u)) return false;
    return VIDEO_EXT_RE.test(u);
  });
  if (imageVideo) return imageVideo;

  // Bare IPFS CID + isVideo (Relic in Spring). No .mp4 in the path, so the
  // URL checks above miss it; iOS then mounts <audio> and refuses the file.
  const typedNft = candidate as NFT;
  const typedIsVideo =
    typedNft.isVideo || typedNft.playbackMode === 'video-with-audio';
  if (typedIsVideo) {
    const stored =
      (candidate as NFT).videoUrl ||
      animation ||
      (candidate as NFT).audio ||
      '';
    if (
      stored &&
      !urlLooksLikeAudio(stored) &&
      !urlLooksLikeImage(stored) &&
      !urlLooksLike3dModel(stored) &&
      (urlLooksLikeVideo(stored) ||
        isBareIpfsFileCid(stored) ||
        isExtensionlessArweaveTx(stored))
    ) {
      return stored;
    }
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
      !urlLooksLikeVideo(url) &&
      !urlLooksLike3dModel(url) &&
      !urlLooksLikeImage(url) &&
      !urlLooksLikeInteractivePage(url) &&
      !isPollutedPlaybackUrl(url)
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
  if (isUnsafePlaybackUrl(videoUrl) || urlLooksLikeInteractivePage(videoUrl)) videoUrl = null;
  if (isUnsafePlaybackUrl(audioUrl) || urlLooksLikeInteractivePage(audioUrl)) audioUrl = null;
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
  // Do not trust a stale audio/* stamp on an extensionless Arweave/IPFS file that
  // the probe already classified as video (Brain Dead, Relic in Spring).
  if (
    mime.startsWith('audio/') &&
    !typed.isVideo &&
    typed.playbackMode !== 'video-with-audio' &&
    !isBareIpfsFileCid(audioUrl || animation || typed.audio || '') &&
    !isExtensionlessArweaveTx(audioUrl || animation || typed.audio || '')
  ) {
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

  // Stored isVideo from a previous correct classify. Bare IPFS CIDs have no
  // .mp4 suffix — still the video file (Relic in Spring).
  if (
    !videoUrl &&
    (typed.isVideo || typed.playbackMode === 'video-with-audio') &&
    !mime.startsWith('audio/')
  ) {
    const stored = typed.videoUrl || typed.audio || audioUrl;
    if (
      stored &&
      !urlLooksLikeAudio(stored) &&
      !urlLooksLikeImage(stored) &&
      (urlLooksLikeVideo(stored) ||
        mime.startsWith('video/') ||
        isBareIpfsFileCid(stored) ||
        isExtensionlessArweaveTx(stored))
    ) {
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
/**
 * URLs that produced real playback bytes. Stronger evidence than mimeSourceCache,
 * which only records what answered a HEAD/Range probe — `/raw/` and arweave.net
 * both win probes and then throw NotSupportedError on a real media element.
 */
const playedSourceCache = new Map<string, string>();
const deadGatewayHosts = new Map<string, Set<string>>();
const MIME_CACHE_KEY = 'podplayr_media_mime';
const DEAD_GATEWAY_CACHE_KEY = 'podplayr_dead_gateways';
/** Cap the dead-gateway blob so a heavy browsing session can't blow the quota. */
const DEAD_GATEWAY_MAX_ASSETS = 400;
let mimeCacheLoaded = false;
let mimePersistTimer: ReturnType<typeof setTimeout> | null = null;
let deadGatewayCacheLoaded = false;
let deadGatewayPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Compare URLs without the `#.wav` / `#.mp4` sniffing hint we append. */
const stripUrlHint = (url: string): string => url.split('#')[0];

const loadMimeCache = (): void => {
  if (mimeCacheLoaded || typeof window === 'undefined') return;
  mimeCacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(MIME_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<
      string,
      string | { mime?: string; url?: string; played?: string }
    >;
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value) continue;
      if (typeof value === 'string') {
        mimeProbeCache.set(key, value);
      } else {
        if (value.mime) mimeProbeCache.set(key, value.mime);
        if (value.url) mimeSourceCache.set(key, value.url);
        if (value.played) playedSourceCache.set(key, value.played);
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
      const obj: Record<string, { mime: string; url?: string; played?: string }> = {};
      mimeProbeCache.forEach((mime, key) => {
        obj[key] = {
          mime,
          url: mimeSourceCache.get(key),
          played: playedSourceCache.get(key),
        };
      });
      // A proven winner outlives its MIME entry — keep it even with no mime key.
      playedSourceCache.forEach((played, key) => {
        if (!obj[key]) obj[key] = { mime: '', played };
      });
      window.localStorage.setItem(MIME_CACHE_KEY, JSON.stringify(obj));
    } catch {
      // ignore quota / private mode
    }
  }, 200);
};

const loadDeadGatewayCache = (): void => {
  if (deadGatewayCacheLoaded || typeof window === 'undefined') return;
  deadGatewayCacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(DEAD_GATEWAY_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [id, hosts] of Object.entries(parsed)) {
      if (!id || !Array.isArray(hosts) || !hosts.length) continue;
      deadGatewayHosts.set(id, new Set(hosts.filter((h) => typeof h === 'string')));
    }
  } catch {
    // ignore quota / private mode
  }
};

const persistDeadGatewayCache = (): void => {
  if (typeof window === 'undefined') return;
  if (deadGatewayPersistTimer) clearTimeout(deadGatewayPersistTimer);
  deadGatewayPersistTimer = setTimeout(() => {
    try {
      const obj: Record<string, string[]> = {};
      Array.from(deadGatewayHosts.entries())
        .slice(-DEAD_GATEWAY_MAX_ASSETS)
        .forEach(([id, hosts]) => {
          if (hosts.size) obj[id] = Array.from(hosts);
        });
      window.localStorage.setItem(DEAD_GATEWAY_CACHE_KEY, JSON.stringify(obj));
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

/**
 * Record the URL that actually produced audible/visible bytes. Kept until it
 * fails again, so a repeat play skips the gateways we already proved dead.
 */
export const rememberPlayedMediaUrl = (assetUrl: string, playedUrl: string): void => {
  if (!assetUrl || !playedUrl) return;
  if (playedUrl.startsWith('blob:') || playedUrl.startsWith('data:')) return;
  loadMimeCache();
  const id = mediaAssetId(assetUrl);
  if (playedSourceCache.get(id) === playedUrl) return;
  playedSourceCache.set(id, playedUrl);
  // Playing beats a stale 404 — a host that just worked is not dead.
  try {
    loadDeadGatewayCache();
    const dead = deadGatewayHosts.get(id);
    if (dead?.size) {
      const host = new URL(playedUrl).hostname.toLowerCase();
      // Both deletes must run — `||` would short-circuit past the apex.
      const clearedHost = dead.delete(host);
      const clearedApex = dead.delete(arweaveGatewayApexHost(playedUrl));
      if (clearedHost || clearedApex) persistDeadGatewayCache();
    }
  } catch {
    // ignore
  }
  persistMimeCache();
};

export const getPlayedMediaUrl = (assetUrl?: string | null): string => {
  loadMimeCache();
  if (!assetUrl) return '';
  return playedSourceCache.get(mediaAssetId(assetUrl)) || '';
};

/** Self-heal: a remembered winner that stops working loses its promotion. */
export const forgetPlayedMediaUrl = (assetUrl: string, failedUrl?: string | null): void => {
  if (!assetUrl) return;
  loadMimeCache();
  const id = mediaAssetId(assetUrl);
  const stored = playedSourceCache.get(id);
  if (!stored) return;
  if (failedUrl && stripUrlHint(stored) !== stripUrlHint(failedUrl)) return;
  playedSourceCache.delete(id);
  persistMimeCache();
};

export const rememberDeadGateway = (assetUrl: string, gatewayUrl: string): void => {
  try {
    loadDeadGatewayCache();
    const host = new URL(gatewayUrl).hostname.toLowerCase();
    const id = mediaAssetId(assetUrl);
    if (!deadGatewayHosts.has(id)) deadGatewayHosts.set(id, new Set());
    const dead = deadGatewayHosts.get(id)!;
    dead.add(host);
    // Sandbox 404s (`{id}.turbo-gateway.com`) must also skip the apex hop.
    // Do not mark arweave.net — its sandbox/raw still serve the WAV.
    const apex = arweaveGatewayApexHost(gatewayUrl);
    if (apex === 'turbo-gateway.com' || apex === 'permagate.io') {
      dead.add(apex);
    }
    if (
      arweaveSandboxId(gatewayUrl) &&
      (apex === 'turbo-gateway.com' || apex === 'permagate.io')
    ) {
      dead.add('turbo-gateway.com');
      dead.add('permagate.io');
    }
    persistDeadGatewayCache();
  } catch {
    // ignore
  }
};

const isArweaveNetPlaybackHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'arweave.net' || host === 'www.arweave.net';
  } catch {
    return false;
  }
};

/**
 * Hoist a URL we have actually heard play. Applied last, after the `/raw/` and
 * arweave.net demotions below, which would otherwise bury a proven winner at
 * the back of the list and re-walk the dead gateways in front of it.
 */
const promotePlayedUrl = (assetUrl: string, urls: string[]): string[] => {
  const played = getPlayedMediaUrl(assetUrl);
  if (!played) return urls;
  const dead = deadGatewayHosts.get(mediaAssetId(assetUrl));
  if (dead?.size) {
    try {
      const host = new URL(played).hostname.toLowerCase();
      if (dead.has(host) || dead.has(arweaveGatewayApexHost(played))) return urls;
    } catch {
      return urls;
    }
  }
  const key = stripUrlHint(played);
  return [played, ...urls.filter((u) => stripUrlHint(u) !== key)];
};

export const filterLivePlaybackUrls = (assetUrl: string, urls: string[]): string[] => {
  loadDeadGatewayCache();
  const dead = deadGatewayHosts.get(mediaAssetId(assetUrl));
  const source = getCachedMediaSourceUrl(assetUrl);
  // Never promote polluted Mux / broken Alchemy HLS from mime-source memory.
  // Never promote Arweave /raw/ — it wins probes and then fails as a media src.
  // arweave.net 302s extensionless txs to HTML; turbo/permagate serve the mp4.
  const sourcePath = extractIPFSPath(source);
  const sourceIsBareCid =
    !!sourcePath && sourcePath.split('/').filter(Boolean).length === 1;
  const hasIpfsFilePath = urls.some((u) => {
    const p = extractIPFSPath(u);
    return !!p && p.split('/').filter(Boolean).length > 1;
  });
  // Never promote a bare folder CID over CID/video.mp4 (Immutable Spirit).
  const safeSource =
    source &&
    !isPollutedPlaybackUrl(source) &&
    !isIpfsCorsHostileUrl(source) &&
    !/\/raw\//i.test(source) &&
    !isArweaveNetPlaybackHost(source) &&
    !(hasIpfsFilePath && sourceIsBareCid)
      ? source
      : '';
  const ordered = safeSource
    ? [safeSource, ...urls.filter((u) => u !== safeSource)]
    : urls;
  const notPolluted = ordered.filter((u) => !isPollutedPlaybackUrl(u));
  // fetch/HEAD CORS ≠ <video src>. Pinata / 4everland first.
  // w3s / dweb / nftstorage / ipfs.io CORP 403 on <video> — only keep them
  // when they are the only candidates.
  const preferred = notPolluted.filter((u) => !isIpfsCorsHostileUrl(u));
  const fallbacks = preferred.length
    ? []
    : notPolluted.filter((u) => isIpfsCorsHostileUrl(u));
  const finalPool = (preferred.length || fallbacks.length)
    ? [...preferred, ...fallbacks]
    : ordered;
  if (!dead?.size) return promotePlayedUrl(assetUrl, finalPool);
  const live = finalPool.filter((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (dead.has(host)) return false;
      const apex = arweaveGatewayApexHost(u);
      if (
        (apex === 'turbo-gateway.com' || apex === 'permagate.io') &&
        dead.has(apex)
      ) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  });
  const ranked = live.length ? live : finalPool;
  // /raw/ answers HEAD/Range but <video>/<audio> often throw NotSupportedError.
  const pathUrls = ranked.filter((u) => !/\/raw\//i.test(u));
  const rawUrls = ranked.filter((u) => /\/raw\//i.test(u));
  const paths = pathUrls.length ? pathUrls : ranked;
  const prefer = paths.filter((u) => !isArweaveNetPlaybackHost(u));
  const arweaveNet = paths.filter(isArweaveNetPlaybackHost);
  const restRaw = pathUrls.length ? rawUrls : [];
  return promotePlayedUrl(assetUrl, [...prefer, ...arweaveNet, ...restRaw]);
};

/** True when URL has no clear audio/video extension (Arweave/IPFS CIDs). */
export const mediaUrlNeedsMimeProbe = (url?: string | null): boolean => {
  if (!url) return false;
  if (
    urlLooksLikeAudio(url) ||
    urlLooksLikeVideo(url) ||
    urlLooksLike3dModel(url) ||
    urlLooksLikeImage(url) ||
    urlLooksLikeInteractivePage(url)
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
  const cachedMime = mimeProbeCache.get(cacheKey);
  // Stale generic audio/mpeg on an extensionless CID is how Dumpster Fire
  // got stuck. Specific types (wav/flac) from a live HEAD are trusted.
  const cachedAudioUntrusted =
    !!cachedMime &&
    cachedMime.startsWith('audio/') &&
    mediaUrlNeedsMimeProbe(url) &&
    !urlLooksLikeAudio(url) &&
    !/^audio\/(wav|x-wav|wave|flac|ogg|aac|mp4|m4a)(?:;|$)/i.test(cachedMime);
  if (cachedMime && !cachedAudioUntrusted) {
    return cachedMime;
  }

  const candidates = new Set<string>();
  if (/arweave|ar:\/\/|turbo-gateway|permagate|irys|ar-io|g8way/i.test(url)) {
    if (url.startsWith('http')) candidates.add(url);
    const primary = processMediaUrl(url, '', 'audio');
    if (primary) candidates.add(primary);
    const { fileTxId } = parseArweaveMediaPath(url);
    // Path gateways 302 HTML; arweave.net/raw answers Content-Type (FORCE WAV).
    // Probe-only — playback still tries turbo → permagate → arweave.net first.
    if (fileTxId) {
      candidates.add(`https://arweave.net/raw/${fileTxId}`);
    }
    buildArweaveMediaFallbackUrls(url).slice(0, 4).forEach((u) => candidates.add(u));
  } else if (url.startsWith('ipfs://') || extractIPFSPath(url)) {
    // Dedicated collection Pinata first, then public fallbacks.
    if (url.startsWith('http')) candidates.add(url);
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
    // Redirect pages and opaque bytes are not a media type. Caching html is how
    // arweave.net 302s turned videos into "audio-only".
    if (
      !mime ||
      mime === 'text/html' ||
      mime.includes('text/html') ||
      mime === 'application/octet-stream' ||
      mime === 'binary/octet-stream' ||
      mime === 'application/x-www-form-urlencoded'
    ) {
      return '';
    }
    mimeProbeCache.set(cacheKey, mime);
    if (!mimeLooksLikeNonMedia(mime)) {
      mimeSourceCache.set(cacheKey, sourceUrl);
    }
    persistMimeCache();
    return mime;
  };

  const timedFetch = (u: string, init: RequestInit) => {
    const ctrl = new AbortController();
    // Pinata/IPFS HEADs on a cold CID routinely take 2–5s; 1.5s was aborting
    // the probe, marking the gateway dead, and leaving video CIDs audio-only.
    const t = setTimeout(() => ctrl.abort(), 8000);
    return fetch(u, { ...init, signal: ctrl.signal, mode: 'cors' }).finally(() =>
      clearTimeout(t)
    );
  };

  const rankedProbeList = filterLivePlaybackUrls(url, Array.from(candidates)).filter(
    (u) => !isIpfsCorsHostileUrl(u)
  );
  const arweaveRawMimeProbe = rankedProbeList.filter((u) =>
    /arweave\.net\/raw\//i.test(u)
  );
  const probeList = [
    ...arweaveRawMimeProbe,
    ...rankedProbeList.filter((u) => !arweaveRawMimeProbe.includes(u)),
  ];

  for (const probeUrl of probeList) {
    try {
      const head = await timedFetch(probeUrl, { method: 'HEAD' });
      const headCt = head.headers.get('content-type');
      if (head.status === 401 || head.status === 402 || head.status === 403) {
        // Paid / auth gateways (turbo /raw 402) — try the next hop, do not
        // poison the host (turbo path still serves the file).
        continue;
      }
      if (head.status === 404 || head.status === 410 || head.status >= 500) {
        const originParts = (extractIPFSPath(url) || '').split('/').filter(Boolean);
        const probeParts = (extractIPFSPath(probeUrl) || '').split('/').filter(Boolean);
        const guessedFilename = probeParts.length > originParts.length;
        // /video.mp4 404 means the guess was wrong, not that Pinata is dead.
        if (!guessedFilename) rememberDeadGateway(url, probeUrl);
        continue;
      }
      if (head.ok && headCt) {
        const mime = store(headCt, probeUrl);
        if (mime) return mime;
      }
    } catch (err) {
      // Timeouts are transient — do not poison a working gateway (Pinata)
      // just because the first HEAD was slow.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        rememberDeadGateway(url, probeUrl);
      }
      continue;
    }

    try {
      const get = await timedFetch(probeUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      const getCt = get.headers.get('content-type');
      if (get.status === 401 || get.status === 402 || get.status === 403) {
        continue;
      }
      if (get.status === 404 || get.status === 410 || get.status >= 500) {
        rememberDeadGateway(url, probeUrl);
        continue;
      }
      if (getCt) {
        const mime = store(getCt, probeUrl);
        if (mime) return mime;
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        rememberDeadGateway(url, probeUrl);
      }
    }
  }

  return '';
};

const isCdnPlaybackHop = (url?: string | null) =>
  !!url && (isMuxPlaybackUrl(url) || isWeakPlaybackUrl(url));

/** Stamp resolved plan fields onto the NFT. Never copy audio onto animation_url for audio-only. */
export const applyPlaybackPlanToNft = (nft: NFT, plan: NftPlaybackPlan, mime?: string): void => {
  nft.playbackMode = plan.mode;
  nft.isVideo = plan.mode !== 'audio-only';
  if (plan.mode === 'audio-only') {
    nft.videoUrl = undefined;
  } else if (plan.videoUrl && !isCdnPlaybackHop(plan.videoUrl)) {
    nft.videoUrl = plan.videoUrl;
  }
  if (plan.audioUrl && !isCdnPlaybackHop(plan.audioUrl)) {
    nft.audio = plan.audioUrl;
    nft.hasValidAudio = true;
  } else if (!plan.audioUrl && !plan.videoUrl) {
    nft.audio = '';
    nft.hasValidAudio = false;
    nft.isVideo = false;
  }
  if (!nft.metadata) {
    nft.metadata = { image: nft.image };
  }
  if (plan.videoUrl && plan.mode !== 'audio-only' && !isCdnPlaybackHop(plan.videoUrl)) {
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
  const knownUntrusted =
    !!known &&
    !!candidate &&
    mediaUrlNeedsMimeProbe(candidate) &&
    (known.includes('html') ||
      known === 'application/octet-stream' ||
      known === 'binary/octet-stream' ||
      (known.startsWith('audio/') && !urlLooksLikeAudio(candidate)));
  if (
    !knownUntrusted &&
    (mimeLooksLike3d(known) ||
      mimeLooksLikeNonMedia(known) ||
      urlLooksLike3dModel(candidate) ||
      urlLooksLikeImage(candidate))
  ) {
    const plan = emptyPlan();
    if (typed.contract) applyPlaybackPlanToNft(typed, plan, known || undefined);
    return plan;
  }
  // Library/Firebase often stamps mimeType: audio/* on extensionless IPFS
  // CIDs that are actually video/mp4 (Dumpster Fire). Only trust an audio
  // mime when the URL itself looks like audio — otherwise fall through to
  // a live probe.
  if (known.startsWith('audio/') && !knownUntrusted && (!candidate || !mediaUrlNeedsMimeProbe(candidate))) {
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
  if (mimeLooksLikeNonMedia(mime) && mime) {
    // Gateway 302 HTML is untrusted (Arweave). A 200 from a project host is real HTML.
    if (mime.includes('html') && !urlLooksLikeInteractivePage(candidate)) {
      // fall through
    } else {
      const plan = emptyPlan();
      if (typed.contract) applyPlaybackPlanToNft(typed, plan, mime);
      return plan;
    }
  }

  // Probe missed (CORS, 302 HTML, /raw/ octet-stream). <audio> cannot play
  // mp4; <video> can still play audio. Default the unknown CID to video.
  if (candidate && mediaUrlNeedsMimeProbe(candidate) && !urlLooksLikeInteractivePage(candidate)) {
    return videoPlan(candidate);
  }

  return sync;
};

