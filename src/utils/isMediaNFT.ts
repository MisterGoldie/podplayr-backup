import type { NFT, NFTFile, NFTMetadata } from '../types/user';

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

/** Filter helper for profile/Demo grids. */
export const filterPlayableMediaNFTs = <T extends MediaCandidate | NFT>(nfts: T[]): T[] => {
  if (!nfts?.length) return [];
  return nfts.filter((nft) => isPlayableMediaNFT(nft));
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
