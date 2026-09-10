/**
 * Shared IPFS filename heuristics — must stay server-safe (no "use client").
 * `nft-gallery-1mov` is a file; guessing image.png / treating the path as a
 * directory CID breaks cover + playback. Real `.mp4` / `.png` URLs are unchanged.
 */

const IMAGE_FILE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|apng)(?:\?|#|$)/i;
const VIDEO_FILE_EXT_RE = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i;
/** Require a non-letter before the suffix so `removemov` does not match. */
const EXTENSIONLESS_VIDEO_NAME_RE = /[^a-zA-Z](mp4|webm|mov|m4v)$/i;
const EXTENSIONLESS_AUDIO_NAME_RE = /[^a-zA-Z](mp3|wav|m4a|ogg|flac|aac)$/i;

export const lastPathSegment = (value: string): string => {
  const trimmed = value.split(/[?#]/)[0]?.replace(/\/+$/, '') || '';
  const slash = trimmed.lastIndexOf('/');
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
};

const trimMediaUrl = (url: string): string =>
  url.replace(/^[\s\x00-\x1f\x7f]+|[\s\x00-\x1f\x7f]+$/g, '');

/** Filename-only: extensionless `1mov` / `-mp4` / `_webm`. */
export const ipfsFilenameLooksLikeMedia = (
  filename: string,
  kind: 'video' | 'audio' | 'any' = 'any'
): boolean => {
  const last = lastPathSegment(filename);
  if (!last || /\.[a-z0-9]{2,5}$/i.test(last)) return false;
  if ((kind === 'video' || kind === 'any') && EXTENSIONLESS_VIDEO_NAME_RE.test(last)) {
    return true;
  }
  if ((kind === 'audio' || kind === 'any') && EXTENSIONLESS_AUDIO_NAME_RE.test(last)) {
    return true;
  }
  return false;
};

const extractIpfsPathForHint = (url: string): string | null => {
  const cleaned = trimMediaUrl(url);
  if (!cleaned) return null;
  if (cleaned.startsWith('ipfs://')) {
    return cleaned.replace(/^ipfs:\/\//, '').replace(/^\/+/, '') || null;
  }
  const pathMatch = cleaned.match(/\/ipfs\/([^?#]+)/i);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]).replace(/^\/+/, '') || null;
    } catch {
      return pathMatch[1].replace(/^\/+/, '') || null;
    }
  }
  return null;
};

const AUDIO_FILE_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|#|$)/i;

/**
 * IPFS `CID/file` with no real extension that is clearly a media file.
 * Bare CIDs / Alchemy hashes / Arweave tx ids are never classified as video
 * here — cover/display retrieval must keep treating those as stills.
 */
export const urlLooksLikeExtensionlessVideo = (url?: string | null): boolean => {
  if (!url) return false;
  // Safari type hints (`#.mov`) must not make this look like a real `.mov` still.
  const cleaned = trimMediaUrl(url).replace(/#\.[a-z0-9]{2,4}$/i, '');
  if (!cleaned || IMAGE_FILE_EXT_RE.test(cleaned) || VIDEO_FILE_EXT_RE.test(cleaned)) {
    return false;
  }
  const ipfsPath = extractIpfsPathForHint(cleaned);
  if (!ipfsPath) return false;
  const parts = ipfsPath.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length < 2) return false;
  return ipfsFilenameLooksLikeMedia(parts[parts.length - 1], 'video');
};

/**
 * Single-file IPFS CID with no filename (Relic in Spring). Not a `CID/file`
 * path, not a trailing-slash directory, not Alchemy/Arweave.
 */
const isBareIpfsFileCid = (url: string): boolean => {
  const cleaned = trimMediaUrl(url).replace(/#\.[a-z0-9]{2,4}$/i, '');
  if (!cleaned || IMAGE_FILE_EXT_RE.test(cleaned) || VIDEO_FILE_EXT_RE.test(cleaned) || AUDIO_FILE_EXT_RE.test(cleaned)) {
    return false;
  }
  if (/\/ipfs\/[^/?#]+\/(?:\?|#|$)/i.test(cleaned) || /ipfs:\/\/[^/?#]+\/(?:\?|#|$)/i.test(cleaned)) {
    return false;
  }
  const ipfsPath = extractIpfsPathForHint(cleaned);
  if (!ipfsPath) return false;
  const parts = ipfsPath.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length !== 1) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(parts[0]);
};

/**
 * Cover/display: only `CID/1mov`-style names get a fragment hint.
 * Pass `assumeVideo` only from <video> playback attach — never from NFTImage.
 */
export const withBrowserVideoHint = (
  url: string,
  opts?: { assumeVideo?: boolean }
): string => {
  if (!url || /#\.[a-z0-9]{2,4}$/i.test(url) || VIDEO_FILE_EXT_RE.test(url)) return url;
  if (urlLooksLikeExtensionlessVideo(url)) {
    const last = lastPathSegment(extractIpfsPathForHint(url) || url);
    const match = last.match(/[^a-zA-Z](mp4|webm|mov|m4v)$/i);
    if (!match) return url;
    return `${url.replace(/#.*$/, '')}#.${match[1].toLowerCase()}`;
  }
  // Playback-only: WebKit will not sniff `video/mp4` on a bare CID.
  // The fragment is not sent to the gateway; still/cover URLs never pass this.
  if (opts?.assumeVideo && isBareIpfsFileCid(url)) {
    return `${url.replace(/#.*$/, '')}#.mp4`;
  }
  return url;
};
