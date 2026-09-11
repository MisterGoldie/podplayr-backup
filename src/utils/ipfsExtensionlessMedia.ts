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

/** Async Art / Token Jukebox store a raw CID in animation_url with no ipfs://. */
const BARE_IPFS_CID_RE =
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafkrei[a-z0-9]+|bafy[a-z0-9]+)(\/[^?#]*)?$/i;

export const coerceIpfsUrl = (url: string): string => {
  const trimmed = trimMediaUrl(url);
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return BARE_IPFS_CID_RE.test(trimmed) ? `ipfs://${trimmed}` : trimmed;
};

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
  try {
    const parsed = new URL(cleaned);
    const sub = parsed.hostname.match(
      /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]+|[a-z0-9]{46})\.ipfs\./i
    );
    if (sub?.[1]) {
      const subpath = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      return subpath ? `${sub[1]}/${subpath}` : sub[1];
    }
  } catch {
    // ignore
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
export const isBareIpfsFileCid = (url: string): boolean => {
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

/** Qm / bafkrei file CID — safe to sniff as mp4. `bafybei` is UnixFS (file or folder). */
export const isBareIpfsRawFileCid = (url: string): boolean => {
  if (!isBareIpfsFileCid(url)) return false;
  const cid = (extractIpfsPathForHint(url) || '').split('/').filter(Boolean)[0] || '';
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/i.test(cid) || /^bafkrei/i.test(cid);
};

/**
 * Cover/display: only `CID/1mov`-style names get a fragment hint.
 * Pass `assumeVideo` only from <video> playback attach — never from NFTImage.
 */
const hintExtFromMime = (mime?: string): string => {
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  if (type.includes('quicktime') || type === 'video/mov') return 'mov';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4') || type === 'video/m4v') return 'mp4';
  return '';
};

const hintAudioExtFromMime = (mime?: string): string => {
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  if (type.includes('wav')) return 'wav';
  if (type.includes('m4a') || type === 'audio/mp4' || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('flac')) return 'flac';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return '';
};

const allowPublicIpfsAudioHint = (url: string): boolean =>
  /gateway\.pinata\.cloud/i.test(url) ||
  /ipfs\.4everland\.io/i.test(url) ||
  /nft2?-cdn\.alchemy\.com/i.test(url);

export const withBrowserVideoHint = (
  url: string,
  opts?: { assumeVideo?: boolean; assumeAudio?: boolean; mime?: string }
): string => {
  if (!url || /#\.[a-z0-9]{2,4}$/i.test(url) || VIDEO_FILE_EXT_RE.test(url)) return url;
  if (urlLooksLikeExtensionlessVideo(url)) {
    const last = lastPathSegment(extractIpfsPathForHint(url) || url);
    const match = last.match(/[^a-zA-Z](mp4|webm|mov|m4v)$/i);
    if (!match) return url;
    return `${url.replace(/#.*$/, '')}#.${match[1].toLowerCase()}`;
  }
  if (opts?.assumeAudio && !opts.assumeVideo && !AUDIO_FILE_EXT_RE.test(url)) {
    const audioExt = hintAudioExtFromMime(opts.mime) || 'mp3';
    // Dedicated `*.mypinata.cloud` wav (Hot Coffee) already plays — don't
    // stamp filename=audio.mp3 on a private gateway.
    if (isBareIpfsRawFileCid(url) && allowPublicIpfsAudioHint(url)) {
      const base = url.replace(/#.*$/, '');
      const withName = /[?&]filename=/i.test(base)
        ? base
        : `${base}${base.includes('?') ? '&' : '?'}filename=audio.${audioExt}`;
      return `${withName}#.${audioExt}`;
    }
    if (/nft2?-cdn\.alchemy\.com/i.test(url)) {
      return `${url.replace(/#.*$/, '')}#.${audioExt}`;
    }
    return url;
  }
  if (!opts?.assumeVideo) return url;

  const mimeExt = hintExtFromMime(opts.mime);
  // Playback-only: WebKit will not sniff mp4 on a bare Qm / bafkrei CID.
  // Never filename-hint UnixFS `bafybei` — that forced video/mp4 on ProRes.
  if (isBareIpfsRawFileCid(url)) {
    const ext = mimeExt || 'mp4';
    const base = url.replace(/#.*$/, '');
    const withName = /[?&]filename=/i.test(base)
      ? base
      : `${base}${base.includes('?') ? '&' : '?'}filename=video.${ext}`;
    return `${withName}#.${ext}`;
  }
  // Extensionless Arweave tx (Brain Dead) — same WebKit sniffing hole as a bare CID.
  if (isExtensionlessArweaveTx(url)) {
    return `${url.replace(/#.*$/, '')}#.${mimeExt || 'mp4'}`;
  }
  // Alchemy `_animation` / Cloudinary f_mp4 have no file extension.
  if (mimeExt && (/nft2?-cdn\.alchemy\.com/i.test(url) || /res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(url))) {
    return `${url.replace(/#.*$/, '')}#.${mimeExt}`;
  }
  return url;
};

/** Arweave/permagate/turbo tx with no filename extension. */
export const isExtensionlessArweaveTx = (url?: string | null): boolean => {
  if (!url) return false;
  const cleaned = trimMediaUrl(url).replace(/#\.[a-z0-9]{2,4}$/i, '');
  if (!cleaned || IMAGE_FILE_EXT_RE.test(cleaned) || VIDEO_FILE_EXT_RE.test(cleaned) || AUDIO_FILE_EXT_RE.test(cleaned)) {
    return false;
  }
  if (!/arweave\.net|permagate\.io|turbo-gateway\.com|ar:\/\//i.test(cleaned)) {
    return false;
  }
  const path = cleaned.split(/[?#]/)[0] || '';
  const last = lastPathSegment(path.replace(/\/raw\//i, '/'));
  return !!last && !/\.[a-z0-9]{2,5}$/i.test(last);
};
