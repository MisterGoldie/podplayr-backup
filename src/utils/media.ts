"use client";

import { useState } from 'react';
import { NFT as UserNFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';
import { getRememberedMediaUrl, forgetMediaUrl } from './gatewayMemory';
import { playbackSpeedLog, shortUrl } from './playDebug';
import {
  rewriteLegacyOpenSeaMediaUrl,
  unwrapMediaProxyUrl,
  isOpenSeaCdnHost,
  toOpenSeaProxyUrl,
  preferBrowserReachableMediaUrl,
} from './openSeaMedia';

export {
  rewriteLegacyOpenSeaMediaUrl,
  unwrapMediaProxyUrl,
  isOpenSeaCdnHost,
  toOpenSeaProxyUrl,
  preferBrowserReachableMediaUrl,
} from './openSeaMedia';

// List of reliable IPFS gateways in order of preference
// Helper function to clean IPFS URLs
export const getCleanIPFSUrl = (url: string): string => {
  if (!url) return url;
  if (typeof url !== 'string') return '';
  // Remove any duplicate 'ipfs' in the path
  return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
};

// Prefer gateways that currently resolve and serve NFT media reliably.
// cloudflare-ipfs.com is dead (ERR_NAME_NOT_RESOLVED).
// Pinata / ipfs.io: usable from the browser (img + CORS HEAD for mime probes).
// w3s.link / nftstorage.link / dweb.link: often CORS-block fetch or return 500 —
// keep only as last-resort fallbacks for <img>/<video>, never first for probes.
export const PRIMARY_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

const IMAGE_FILE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|apng)(?:\?|#|$)/i;
const VIDEO_FILE_EXT_RE = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i;

/** Common filenames inside IPFS directory CIDs (many mints point `image` at a folder). */
const COMMON_IPFS_IMAGE_NAMES = [
  'image.png',
  'image.jpg',
  'image.jpeg',
  'image.gif',
  'image.webp',
  'cover.png',
  'cover.jpg',
  'cover.jpeg',
  'cover.gif',
  'cover.webp',
  'thumbnail.png',
  'thumbnail.jpg',
  'thumb.png',
  'thumb.jpg',
  'media.png',
  'media.jpg',
  'media.gif',
  'nft.png',
  'nft.jpg',
  'nft.gif',
];

/** Common playable filenames when `animation_url` / `audio` points at a directory CID. */
const COMMON_IPFS_MEDIA_NAMES = [
  'audio.mp3',
  'audio.wav',
  'audio.m4a',
  'audio.ogg',
  'audio.aac',
  'audio.flac',
  'sound.mp3',
  'music.mp3',
  'track.mp3',
  'song.mp3',
  'animation.mp4',
  'video.mp4',
  'media.mp4',
  'animation.webm',
  'video.webm',
  'media.webm',
];

export type IpfsFallbackKind = 'image' | 'media';

const looksLikeAudioFileUrl = (url: string): boolean =>
  /\.(mp3|wav|ogg|m4a|flac|aac)(?:\?|#|$)/i.test(url);

const looksLikeVideoFileUrl = (url: string): boolean => VIDEO_FILE_EXT_RE.test(url);

const normalizeMediaUrlKey = (url: string): string => {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('ipfs://') ? toIpfsGatewayUrl(url.replace(/^ipfs:\/\//, '')) : url);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
};

/** True when CID is raw codec (single file) — never a UnixFS directory. */
const isRawIpfsCid = (cid: string): boolean => /^bafkrei/i.test(cid);

/**
 * Only probe common filenames when metadata clearly points at a directory.
 * - `bafkrei…` is always a single file (raw codec) — never probe.
 * - Trailing slash after CID (`…/Qm…/`) is the usual directory-wrap signal.
 * - Multi-segment paths without a file extension (CID/subdir) also probe.
 * Bare `Qm…` / `bafybei…` without a slash are left alone — many are single-file images.
 */
export const shouldProbeIpfsDirectory = (url: string, ipfsPath?: string | null): boolean => {
  const path = (ipfsPath || extractIPFSPath(url) || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!path) return false;
  const parts = path.split('/').filter(Boolean);
  const cid = parts[0] || '';
  if (!cid || isRawIpfsCid(cid)) return false;

  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    return !/\.[a-z0-9]{2,5}$/i.test(last);
  }

  // Trailing slash after the CID in the original URL
  if (/\/ipfs\/[^/?#]+\/(?:\?|#|$)/i.test(url) || /ipfs:\/\/[^/?#]+\/(?:\?|#|$)/i.test(url)) {
    return true;
  }
  // Subdomain gateway with trailing path slash: cid.ipfs.w3s.link/
  try {
    const u = new URL(url);
    if (/\.ipfs\./i.test(u.hostname) && (u.pathname === '/' || u.pathname === '')) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

/** @deprecated Prefer shouldProbeIpfsDirectory(url) — path-only checks mis-label raw CIDs. */
export const isBareIpfsDirectoryPath = (ipfsPath: string): boolean => {
  if (!ipfsPath) return false;
  const parts = ipfsPath.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (isRawIpfsCid(parts[0])) return false;
  if (parts.length === 1) return false; // ambiguous without URL trailing-slash signal
  const last = parts[parts.length - 1];
  return !/\.[a-z0-9]{2,5}$/i.test(last);
};

/**
 * Expand a bare IPFS directory CID into candidate file paths.
 * Gateway rotation alone cannot recover unreplicated CIDs; file probes can when
 * the mint stored media under a conventional name inside the directory.
 *
 * `kind: 'image'` → cover filenames. `kind: 'media'` → audio/video filenames
 * (playback must never probe image.png).
 */
export const expandIpfsDirectoryImagePaths = (
  ipfsPath: string,
  sourceUrl?: string,
  kind: IpfsFallbackKind = 'image'
): string[] => {
  const clean = ipfsPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return [];
  const probe =
    sourceUrl != null
      ? shouldProbeIpfsDirectory(sourceUrl, clean)
      : isBareIpfsDirectoryPath(clean);
  if (!probe) return [clean];
  const cid = clean.split('/')[0];
  const names = kind === 'media' ? COMMON_IPFS_MEDIA_NAMES : COMMON_IPFS_IMAGE_NAMES;
  // Bare CID first (some gateways resolve a single wrapped file), then names.
  return [clean, ...names.map((name) => `${cid}/${name}`)];
};

/**
 * Collect every plausible cover URL from NFT metadata — not just `image`.
 * Skips clear audio/video file URLs. Order = preference for display.
 */
export const pickImageCandidates = (nft: UserNFT | null | undefined): string[] => {
  if (!nft) return [];
  const meta = nft.metadata;
  const raw: string[] = [];

  const push = (url?: string | null, opts?: { allowVideo?: boolean }) => {
    if (!url || typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed) return;
    // Skip dedicated audio. Allow video covers (Nifty Island / SeaDN mp4).
    if (looksLikeAudioFileUrl(trimmed)) return;
    if (looksLikeVideoFileUrl(trimmed) && !opts?.allowVideo) return;
    raw.push(trimmed);
  };

  // Token image may be an mp4 cover — keep it.
  push(nft.image, { allowVideo: true });
  push(meta?.image, { allowVideo: true });
  push(meta?.image_url);
  push(meta?.properties?.image);
  push(meta?.properties?.visual?.url);
  // Animation URL as cover only when it's clearly video (not the audio track).
  const anim = meta?.animation_url || nft.animationUrl || nft.videoUrl;
  if (
    anim &&
    (looksLikeVideoFileUrl(anim) ||
      /niftyisland\.com/i.test(anim) ||
      (/raw2?\.seadn\.io/i.test(anim) && !looksLikeAudioFileUrl(anim)))
  ) {
    push(anim, { allowVideo: true });
  }

  for (const file of meta?.properties?.files || []) {
    if (!file) continue;
    const fileUrl = file.uri || file.url;
    const mime = (file.type || file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/') || (fileUrl && IMAGE_FILE_EXT_RE.test(fileUrl))) {
      push(fileUrl);
    }
  }

  // Collection image is a last-resort cover when token media is missing/broken.
  push(nft.collection?.image);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of raw) {
    const rewritten = rewriteLegacyOpenSeaMediaUrl(url, nft.contract, nft.network);
    const key = normalizeMediaUrlKey(rewritten) || rewritten.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rewritten);
    if (rewritten !== url) {
      const origKey = normalizeMediaUrlKey(url) || url.toLowerCase();
      if (!seen.has(origKey)) {
        seen.add(origKey);
        out.push(url);
      }
    }
  }
  // Prefer token Alchemy / Nifty video over shared OpenSea collection art (i2c).
  const coverScore = (url: string): number => {
    if (/niftyisland\.com/i.test(url) || looksLikeVideoFileUrl(url)) return 5;
    if (isAlchemyCdnMediaUrl(url)) return 4;
    if (/raw2?\.seadn\.io/i.test(url)) return 3;
    if (/i2c\.seadn|openseauserdata\.com/i.test(url)) return 1; // often collection-level
    if (/seadn\.io|res\.cloudinary\.com/i.test(url)) return 2;
    if (IMAGE_FILE_EXT_RE.test(url) && !/\/ipfs\//i.test(url) && !url.startsWith('ipfs://')) return 2;
    if (/\/ipfs\//i.test(url) || url.startsWith('ipfs://') || /\.ipfs\./i.test(url)) return 0;
    return 1;
  };
  out.sort((a, b) => coverScore(b) - coverScore(a));
  return out;
};

const isAlchemyCdnMediaUrl = (url?: string | null): boolean =>
  !!url && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);

/**
 * True only when the "image" field is clearly an audio file URL (e.g. .mp3).
 * Do NOT treat shared IPFS directory CIDs as blocked — remints often set
 * image === animation_url to a folder; blocking those forced default-nft.png.
 */
export const isAudioUrlUsedAsImage = (nft: UserNFT, imageUrl: string): boolean => {
  if (!imageUrl || !looksLikeAudioFileUrl(imageUrl)) return false;

  const imageKey = normalizeMediaUrlKey(imageUrl);
  const audioUrls = [
    nft?.audio,
    (nft?.metadata as { audio?: string } | undefined)?.audio,
    nft?.metadata?.animation_url,
  ].filter(Boolean) as string[];

  return audioUrls.some((audio) => normalizeMediaUrlKey(audio) === imageKey);
};

export const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.ipfs.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
];

/** Hosts that break browser fetch(CORS) MIME probes — skip for HEAD/Range GET. */
export const IPFS_CORS_HOSTILE =
  /(?:^|\.)(?:w3s\.link|nftstorage\.link|dweb\.link|gateway\.ipfs\.io)$/i;

export const isIpfsCorsHostileUrl = (url: string): boolean => {
  try {
    return IPFS_CORS_HOSTILE.test(new URL(url).hostname);
  } catch {
    return /w3s\.link|nftstorage\.link|dweb\.link/i.test(url);
  }
};

const DEAD_IPFS_HOSTS = new Set([
  'cloudflare-ipfs.com',
  'cf-ipfs.com',
]);

/** Build https gateway URL for an IPFS path (CID or CID/file...). */
export const toIpfsGatewayUrl = (
  ipfsPath: string,
  gateway: string = PRIMARY_IPFS_GATEWAY
): string => {
  const clean = ipfsPath.replace(/^ipfs\//, '').replace(/^\/+/, '');
  const encoded = clean
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');
  // Path-style dweb.link/ipfs/CID 301s to CID.ipfs.dweb.link — use the subdomain
  // so <video>/<audio> and HEAD probes get the file, not an HTML redirect.
  if (gateway.includes('dweb.link')) {
    const [cid, ...rest] = encoded.split('/');
    const suffix = rest.length ? `/${rest.join('/')}` : '';
    return `https://${cid}.ipfs.dweb.link${suffix}`;
  }

  const base = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return `${base}${encoded}`;
};

/** Ordered IPFS URLs across working gateways (preserves CID subpaths). */
export const buildIpfsFallbackUrls = (
  url: string,
  options?: { kind?: IpfsFallbackKind }
): string[] => {
  const kind = options?.kind ?? 'image';
  const path = extractIPFSPath(url);
  if (!path) return url ? [url] : [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const isHttp = url.startsWith('http://') || url.startsWith('https://');
  const originalHostile = isHttp && isIpfsCorsHostileUrl(url);
  const isDir = shouldProbeIpfsDirectory(url, path);
  const pathVariants = expandIpfsDirectoryImagePaths(path, url, kind);

  if (isDir) {
    const bare = path.replace(/\/+$/, '');
    const fileVariants = pathVariants.slice(1);
    // Skip CORS-hostile / flaky hosts for directory probes — they burn the
    // short playback candidate budget without helping.
    const gateways =
      kind === 'media'
        ? IPFS_GATEWAYS.filter((g) => !/w3s\.link|nftstorage\.link|dweb\.link/i.test(g))
        : IPFS_GATEWAYS;

    if (kind === 'media') {
      // Playback budget is tiny (MAX_PLAYBACK_CANDIDATES=6). Do NOT fill it with
      // the same bare CID on 6 gateways — include audio/video filenames early.
      push(toIpfsGatewayUrl(bare, PRIMARY_IPFS_GATEWAY));
      for (const variant of fileVariants.slice(0, 4)) {
        push(toIpfsGatewayUrl(variant, PRIMARY_IPFS_GATEWAY));
      }
      for (const gateway of gateways.slice(1)) {
        push(toIpfsGatewayUrl(bare, gateway));
      }
      if (gateways[1] && fileVariants[0]) {
        push(toIpfsGatewayUrl(fileVariants[0], gateways[1]));
      }
      return urls;
    }

    // Images: primary bare + cover filenames, then other gateways.
    push(toIpfsGatewayUrl(bare, PRIMARY_IPFS_GATEWAY));
    for (const variant of fileVariants) {
      push(toIpfsGatewayUrl(variant, PRIMARY_IPFS_GATEWAY));
    }
    for (const gateway of gateways.slice(1, 3)) {
      push(toIpfsGatewayUrl(bare, gateway));
      for (const variant of fileVariants.slice(0, 4)) {
        push(toIpfsGatewayUrl(variant, gateway));
      }
    }
    return urls;
  }

  // Prefer a CORS-friendly gateway before a hostile original (w3s / nft.storage / dweb).
  if (isHttp && !originalHostile) {
    push(url);
  }
  for (const gateway of IPFS_GATEWAYS) {
    push(toIpfsGatewayUrl(path, gateway));
  }
  if (isHttp && originalHostile) {
    push(url);
  }
  return urls;
};

/** Unwrap `/api/media-proxy?url=` back to the upstream OpenSea URL. */
// (defined in openSeaMedia.ts — re-exported above)

/**
 * HTTP CDN image fallbacks (OpenSea). Prefer raw2 rewrite when contract is known,
 * then proxy/dead-host variants — never burn five width retries on NXDOMAIN.
 */
export const buildHttpCdnImageFallbackUrls = (
  url: string,
  opts?: { contract?: string; network?: string }
): string[] => {
  const source = unwrapMediaProxyUrl(url);
  if (!source || (!source.startsWith('http://') && !source.startsWith('https://'))) return [];
  try {
    const u = new URL(source);
    const host = u.hostname.toLowerCase();
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (next: string) => {
      if (!next || seen.has(next)) return;
      seen.add(next);
      out.push(next);
    };

    if (isOpenSeaCdnHost(host)) {
      const raw2 = rewriteLegacyOpenSeaMediaUrl(source, opts?.contract, opts?.network);
      if (raw2 && raw2 !== source) push(raw2);
      push(toOpenSeaProxyUrl(source));
      const bare = new URL(source);
      bare.search = '';
      const bareRaw2 = rewriteLegacyOpenSeaMediaUrl(bare.toString(), opts?.contract, opts?.network);
      if (bareRaw2 && bareRaw2 !== bare.toString()) push(bareRaw2);
      push(toOpenSeaProxyUrl(bare.toString()));
      push(source);
      return out;
    }

    push(source);
    if (u.search) {
      const bare = new URL(source);
      bare.search = '';
      push(bare.toString());
    }
    return out;
  } catch {
    return [source];
  }
};

// Enhanced Arweave fallback with immediate default
export const getAlternativeArweaveUrl = (originalUrl: string, failedGateways: Set<string> = new Set()): string => {
  // Due to browser blocking, immediately return default image for Arweave URLs
  console.warn('Arweave URL detected, using fallback due to browser restrictions:', originalUrl);
  return '/default-nft.png';
};

// Enhanced IPFS fallback with better error handling
export const getAlternativeIPFSUrl = (url: string, failedGateways: Set<string> = new Set()): string | null => {
  const ipfsPath = extractIPFSPath(url);
  if (!ipfsPath) return null;

  for (const gateway of IPFS_GATEWAYS) {
    if (!failedGateways.has(gateway) && !url.includes(gateway.replace(/\/ipfs\/$/, ''))) {
      return toIpfsGatewayUrl(ipfsPath, gateway);
    }
  }

  return null;
};

/**
 * Extract CID (+ optional subpath) from ipfs:// or gateway URLs.
 * Preserves paths like Qm.../file.mp4 needed for directory CIDs.
 * Also handles subdomain gateways: {cid}.ipfs.w3s.link/file.gif
 */
export const extractIPFSPath = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;

  url = url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');

  if (url.startsWith('ipfs://')) {
    return url.replace(/^ipfs:\/\//, '').replace(/^\/+/, '') || null;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname.includes('/ipfs/')) {
      const pathParts = parsedUrl.pathname.split('/ipfs/');
      if (pathParts.length > 1) {
        return decodeURIComponent(pathParts.slice(1).join('/ipfs/')).replace(/^\/+/, '') || null;
      }
    }

    // Subdomain style: bafy….ipfs.w3s.link/COMPRESSED.gif
    const host = parsedUrl.hostname;
    const subMatch = host.match(
      /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]+|[a-z0-9]{46})\.ipfs\./i
    );
    if (subMatch?.[1]) {
      const subpath = parsedUrl.pathname.replace(/^\/+/, '');
      return subpath ? `${subMatch[1]}/${subpath}` : subMatch[1];
    }
  } catch {
    // continue
  }

  const ipfsMatch = url.match(/(?:ipfs\/|\/ipfs\/|ipfs:)(.+)$/i);
  if (ipfsMatch?.[1]) {
    return ipfsMatch[1].replace(/^\/+/, '');
  }

  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]+|[a-zA-Z0-9]{46})(\/.*)?$/i.test(url)) {
    return url;
  }

  return null;
};

/** @deprecated Prefer extractIPFSPath — kept for callers expecting CID-only in some cases */
export const extractIPFSHash = (url: string): string | null => {
  const path = extractIPFSPath(url);
  if (!path) return null;
  return path.split('/')[0];
};

// Function to process Arweave URLs into valid HTTP URLs
export const processArweaveUrl = (url: string, mediaType: 'image' | 'audio' | 'metadata' = 'image'): string => {
  if (!url) return url;
  if (typeof url !== 'string') return '';
  
  // Create a console logger specific to this function
  const arLogger = {
    debug: (msg: string, data?: any) => console.debug(`[Arweave URL Processor] ${msg}`, data || ''),
    error: (msg: string, data?: any) => console.error(`[Arweave URL Processor] ${msg}`, data || '')
  };
  
  try {
    // If it's not an ar:// URL, return as is
    if (!url.startsWith('ar://')) {
      return url;
    }

    // Special handling for audio files — prefer /raw/{fileTxId} (works when path URLs 404)
    if (mediaType === 'audio' && url.startsWith('ar://') && url.includes('/')) {
      const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(url);
      if (fileTxId) {
        const rawUrl = toArweaveRawUrl(fileTxId);
        arLogger.debug(`Audio file via raw gateway: ${rawUrl}`);
        return rawUrl;
      }
      if (manifestId && filePath) {
        return `${PRIMARY_ARWEAVE_GATEWAY}${manifestId}/${filePath}`;
      }
    }
    
    // PODs media special format: ar://<txid1>/<txid2>.ext
    const podsMediaPattern = /^ar:\/\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)(\.[a-zA-Z0-9]+)?$/;
    const podsMatch = url.match(podsMediaPattern);
    
    if (podsMatch) {
      const secondTxId = podsMatch[2];
      arLogger.debug(`Detected PODs media format, using raw file tx: ${secondTxId}`);
      return toArweaveRawUrl(secondTxId);
    }
    
    // Simple ar:// format
    if (!url.includes('/')) {
      const txId = url.replace('ar://', '');
      arLogger.debug(`Simple Arweave URL detected: ${txId}`);
      return toArweaveRawUrl(txId);
    }
    
    // Parse the URL to extract components
    const arPath = url.substring(5); // Remove 'ar://'
    const segments = arPath.split('/');
    
    // If there's only one segment, use it directly
    if (segments.length === 1) {
      const cleanId = segments[0].split('?')[0].split('#')[0].replace(MEDIA_EXT_RE, '');
      arLogger.debug(`Single segment Arweave URL: ${cleanId}`);
      return toArweaveRawUrl(cleanId);
    }
    
    // For multi-segment paths, use the last segment as the transaction ID
    const lastSegment = segments[segments.length - 1];
    const cleanId = lastSegment.split('?')[0].split('#')[0].replace(MEDIA_EXT_RE, '');
    
    arLogger.debug(`Multi-segment Arweave URL, using last segment raw: ${cleanId}`);
    return toArweaveRawUrl(cleanId);
  } catch (error) {
    // If there was an error processing the URL, log it and return the original
    arLogger.error('Error processing Arweave URL:', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return url;
  }
};

// Prefer gateways that actually serve PODs / large media (arweave.net often 404s these)
export const PRIMARY_ARWEAVE_GATEWAY = 'https://turbo-gateway.com/';

export const ARWEAVE_AUDIO_GATEWAYS = [
  'https://turbo-gateway.com/',
  'https://permagate.io/',
  'https://arweave.net/',
  'https://gateway.irys.xyz/',
  'https://ar-io.dev/',
  'https://g8way.io/',
];

export const ARWEAVE_GATEWAYS = [
  'https://turbo-gateway.com/',
  'https://permagate.io/',
  'https://arweave.net/',
  'https://ar-io.dev/',
  'https://g8way.io/',
];

const ARWEAVE_TX_ID_RE = /^[a-zA-Z0-9_-]{43}$/;
const MEDIA_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac|gif|png|jpe?g|webp|mp4|webm|mov)$/i;

/** Parse ar:// or https gateway URLs into manifest + file tx parts (PODs-style). */
export const parseArweaveMediaPath = (url: string): {
  manifestId?: string;
  fileTxId?: string;
  filePath?: string;
} => {
  if (!url || typeof url !== 'string') return {};

  let path = url;
  if (path.startsWith('ar://')) {
    path = path.slice(5);
  } else {
    try {
      path = new URL(path).pathname.replace(/^\/+/, '');
      // Strip /raw/ prefix if present
      if (path.startsWith('raw/')) path = path.slice(4);
    } catch {
      return {};
    }
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return {};

  if (segments.length === 1) {
    const fileTxId = segments[0].replace(MEDIA_EXT_RE, '');
    return ARWEAVE_TX_ID_RE.test(fileTxId) ? { fileTxId } : {};
  }

  const manifestId = segments[0];
  const filePath = segments.slice(1).join('/');
  const fileTxId = filePath.replace(MEDIA_EXT_RE, '');

  return {
    manifestId: ARWEAVE_TX_ID_RE.test(manifestId) ? manifestId : undefined,
    filePath,
    fileTxId: ARWEAVE_TX_ID_RE.test(fileTxId) ? fileTxId : undefined,
  };
};

/** Prefer /raw/{txId} — works when path manifests 404 on arweave.net. */
export const toArweaveRawUrl = (txId: string, gateway: string = PRIMARY_ARWEAVE_GATEWAY): string => {
  const base = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return `${base}raw/${txId}`;
};

/** Build ordered Arweave URLs across gateways (raw file tx first, then path, then direct). */
export const buildArweaveAudioFallbackUrls = (rawUrl: string): string[] => {
  return buildArweaveMediaFallbackUrls(rawUrl);
};

export const buildArweaveMediaFallbackUrls = (rawUrl: string): string[] => {
  if (!rawUrl || typeof rawUrl !== 'string') return [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const { manifestId, fileTxId, filePath } = parseArweaveMediaPath(rawUrl);
  const gateways = ARWEAVE_AUDIO_GATEWAYS;

  // 1. /raw/{fileTxId} on preferred gateways (confirmed working for PODs media)
  if (fileTxId) {
    for (const gateway of gateways) {
      push(toArweaveRawUrl(fileTxId, gateway));
    }
    for (const gateway of gateways) {
      push(`${gateway}${fileTxId}`);
    }
  }

  // 2. Full manifest path (PODs-style)
  if (manifestId && filePath) {
    for (const gateway of gateways) {
      push(`${gateway}${manifestId}/${filePath}`);
    }
  }

  // 3. Manifest alone / original https remap
  if (manifestId && manifestId !== fileTxId) {
    for (const gateway of gateways) {
      push(toArweaveRawUrl(manifestId, gateway));
      push(`${gateway}${manifestId}`);
    }
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    push(rawUrl);
  }

  return urls;
};

/**
 * Short image-only gateway list. Full playback lists are too long for <img>
 * hang timeouts — a 7MB PNG needs time, not 12×5s retries.
 */
export const buildArweaveImageFallbackUrls = (rawUrl: string): string[] => {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(rawUrl);
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  if (fileTxId) {
    push(toArweaveRawUrl(fileTxId, 'https://turbo-gateway.com/'));
    push(toArweaveRawUrl(fileTxId, 'https://permagate.io/'));
    push(`https://arweave.net/${fileTxId}`);
  } else if (manifestId && filePath) {
    push(toArweaveRawUrl(filePath.replace(MEDIA_EXT_RE, ''), 'https://turbo-gateway.com/'));
    push(`https://turbo-gateway.com/${manifestId}/${filePath}`);
    push(`https://arweave.net/${manifestId}/${filePath}`);
  }

  if (rawUrl.startsWith('http')) push(rawUrl);
  return urls;
};

// Function to process media URLs to ensure they're properly formatted
export const processMediaUrl = (url: string, fallbackUrl: string = '/default-nft.png', mediaType: 'image' | 'audio' | 'metadata' = 'image'): string => {
  if (!url) return fallbackUrl;
  if (typeof url !== 'string') return fallbackUrl;
  
  // Rewrite dead IPFS gateway hosts (cloudflare-ipfs.com DNS no longer resolves)
  if ((url.startsWith('http://') || url.startsWith('https://')) && (url.includes('/ipfs/') || /\.ipfs\./i.test(url))) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const path = extractIPFSPath(url);

      if (DEAD_IPFS_HOSTS.has(host) || host.endsWith('.cloudflare-ipfs.com')) {
        if (path) {
          return toIpfsGatewayUrl(path);
        }
      }

      // Dedicated Pinata + flaky w3s subdomain hosts — rewrite to public Pinata.
      // Keep nftstorage/dweb path URLs as-is (they often work for <img>);
      // NFTImage still cycles gateways via buildIpfsFallbackUrls on error.
      if (/mypinata\.cloud$/i.test(host) || /(?:^|\.)w3s\.link$/i.test(host)) {
        if (path) {
          return toIpfsGatewayUrl(path);
        }
      }

      if (url.includes('/ipfs/')) {
        const hasDoubleIpfs = url.includes('/ipfs/ipfs/');
        if (!hasDoubleIpfs) {
          return url;
        }
        return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
      }

      // Other subdomain gateways ({cid}.ipfs.dweb.link, …) → primary gateway
      if (path && /\.ipfs\./i.test(host)) {
        return toIpfsGatewayUrl(path);
      }
    } catch {
      // fall through
    }
  }

  // For audio files from Arweave, we need to be extra careful to preserve the exact file path
  if (mediaType === 'audio' && url.startsWith('ar://')) {
    return processArweaveUrl(url, 'audio');
  }

  // Handle IPFS URLs with working primary gateway (preserves CID/file subpaths)
  if (url.startsWith('ipfs://')) {
    const path = extractIPFSPath(url);
    if (path) {
      return toIpfsGatewayUrl(path);
    }
  }

  const ipfsPath = extractIPFSPath(url);
  if (ipfsPath) {
    return toIpfsGatewayUrl(ipfsPath);
  }

  if (url.startsWith('ar://')) {
    const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(url);

    // Prefer /raw/{fileTxId} — turbo/permagate serve PODs media that arweave.net 404s
    if (fileTxId) {
      return toArweaveRawUrl(fileTxId);
    }

    if (manifestId && filePath) {
      return `${PRIMARY_ARWEAVE_GATEWAY}${manifestId}/${filePath}`;
    }

    return toArweaveRawUrl(url.replace('ar://', '').split('/')[0]);
  }

  // Same PODs rewrite for https://arweave.net/<manifest>/<file>.ext
  // Only multi-segment paths — single-tx IDs often work on arweave.net and
  // break (or hang) when forced through turbo /raw/.
  if (
    /arweave\.(net|dev)|permagate\.io|turbo-gateway\.com|irys\.xyz|ar-io\.dev|g8way\.io/i.test(
      url
    )
  ) {
    const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(url);
    if (fileTxId && manifestId && filePath && !url.includes('/raw/')) {
      return toArweaveRawUrl(fileTxId);
    }
  }

  // Dedicated Pinata gateways (*.mypinata.cloud) often stall in mini-app /
  // tunnel browsers for multi-MB GIFs. Prefer the public Pinata gateway.
  if (/mypinata\.cloud/i.test(url) && url.includes('/ipfs/')) {
    const path = extractIPFSPath(url);
    if (path) {
      return preferBrowserReachableMediaUrl(toIpfsGatewayUrl(path));
    }
  }

  // OpenSea CDNs often fail DNS inside Farcaster mini-app webviews.
  if (mediaType === 'image' || mediaType === 'audio') {
    return preferBrowserReachableMediaUrl(url) || fallbackUrl;
  }

  return url || fallbackUrl;
};

export const PLAYBACK_STALL_MS = 2000;
/** Only abandon a URL that is not actually downloading (see failover guard). */
export const FIRST_BYTE_FAILOVER_MS = 8000;
/** Faster hop when the URL is clearly a bare IPFS directory (often unreplicated). */
export const IPFS_DIR_FAILOVER_MS = 3000;
export const MAX_PLAYBACK_CANDIDATES = 6;
const GATEWAY_RACE_MS = 1400;

const PLAYBACK_ARWEAVE_GATEWAYS = [
  'https://turbo-gateway.com/',
  'https://permagate.io/',
  'https://arweave.net/',
];

/** tx.arweave.net subdomains often fail HTTP2; use the path gateway instead. */
export const canonicalizeArweaveGatewayUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.endsWith('.arweave.net') &&
      parsed.hostname !== 'arweave.net' &&
      parsed.hostname !== 'www.arweave.net'
    ) {
      const path = parsed.pathname.replace(/^\/+/, '');
      if (path) return `https://arweave.net/${path}${parsed.search}`;
    }
  } catch {
    return url;
  }
  return url;
};

/** Short candidate list so hanging gateways cannot stall playback for minutes. */
export const buildFastPlaybackUrls = (
  rawUrl: string,
  opts?: { contract?: string; network?: string }
): string[] => {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  rawUrl = canonicalizeArweaveGatewayUrl(
    rewriteLegacyOpenSeaMediaUrl(rawUrl, opts?.contract, opts?.network)
  );

  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  if (
    rawUrl.startsWith('ar://') ||
    /arweave\.(net|dev)|permagate\.io|turbo-gateway\.com|irys\.xyz|ar-io\.dev|g8way\.io/i.test(rawUrl)
  ) {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      push(rawUrl);
    }
    const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(rawUrl);
    if (fileTxId) {
      // Path URLs first. /raw/ often returns 206 on a Range probe but is not a
      // playable <video> source (NotSupportedError) for these Featured MP4s.
      for (const gateway of PLAYBACK_ARWEAVE_GATEWAYS) {
        push(`${gateway}${fileTxId}`);
      }
      for (const gateway of PLAYBACK_ARWEAVE_GATEWAYS) {
        push(toArweaveRawUrl(fileTxId, gateway));
      }
    }
    if (manifestId && filePath) {
      push(`${PLAYBACK_ARWEAVE_GATEWAYS[0]}${manifestId}/${filePath}`);
    }
    return urls.slice(0, MAX_PLAYBACK_CANDIDATES);
  }

  if (rawUrl.startsWith('ipfs://') || extractIPFSPath(rawUrl)) {
    // Playback: probe audio/video filenames inside directory CIDs — never image.png.
    return buildIpfsFallbackUrls(rawUrl, { kind: 'media' }).slice(0, MAX_PLAYBACK_CANDIDATES);
  }

  // OpenSea user media: rewrite dead hosts → raw2, then proxy as last resort.
  try {
    const openSeaSource = unwrapMediaProxyUrl(rawUrl);
    const host = new URL(openSeaSource).hostname.toLowerCase();
    if (isOpenSeaCdnHost(host)) {
      const raw2 = rewriteLegacyOpenSeaMediaUrl(openSeaSource, opts?.contract, opts?.network);
      if (raw2) push(raw2);
      push(toOpenSeaProxyUrl(openSeaSource));
      const bare = new URL(openSeaSource);
      bare.search = '';
      push(rewriteLegacyOpenSeaMediaUrl(bare.toString(), opts?.contract, opts?.network));
      push(openSeaSource);
      return urls.filter(Boolean).slice(0, MAX_PLAYBACK_CANDIDATES);
    }
  } catch {
    // fall through
  }

  const processed = processMediaUrl(rawUrl, '', 'audio');
  push(processed);
  if (rawUrl.startsWith('https://') && rawUrl !== processed) {
    push(rawUrl);
  }
  return urls;
};

/**
 * Probe first-byte TTFB across gateways in parallel. First success is promoted
 * so we do not sit on a hung Arweave/IPFS host for the failover timeout.
 * CORS failures are treated as "unknown" (keep original order).
 */
export async function pickFastestPlaybackUrl(
  urls: string[],
  timeoutMs = GATEWAY_RACE_MS
): Promise<string[]> {
  if (urls.length <= 1) {
    playbackSpeedLog('gateway race skipped', { reason: 'only one candidate', urls: urls.map(shortUrl) });
    return urls;
  }

  playbackSpeedLog('gateway race start', {
    timeoutMs,
    count: urls.length,
    urls: urls.map(shortUrl),
  });

  const probe = (url: string, signal: AbortSignal): Promise<number> =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
        mode: 'cors',
        signal,
      })
        .then((res) => {
          const ms = Math.round(performance.now() - started);
          if (res.ok || res.status === 206) {
            playbackSpeedLog('gateway race probe OK', { ms, status: res.status, url: shortUrl(url) });
            resolve(ms);
            return;
          }
          playbackSpeedLog('gateway race probe HTTP fail', { ms, status: res.status, url: shortUrl(url) });
          reject(new Error(String(res.status)));
        })
        .catch((err: unknown) => {
          const ms = Math.round(performance.now() - started);
          const name = err instanceof Error ? err.name : 'error';
          const message = err instanceof Error ? err.message : String(err);
          playbackSpeedLog('gateway race probe fail', { ms, name, message, url: shortUrl(url) });
          reject(err);
        });
    });

  const controllers = urls.map(() => new AbortController());
  const timer = window.setTimeout(() => {
    playbackSpeedLog('gateway race timeout — aborting remaining probes', { timeoutMs });
    controllers.forEach((c) => c.abort());
  }, timeoutMs);

  try {
    const winner = await Promise.any(
      urls.map((url, i) => probe(url, controllers[i].signal).then((ms) => ({ url, ms })))
    );
    controllers.forEach((c) => c.abort());
    playbackSpeedLog('gateway race winner', { ms: Math.round(winner.ms), url: shortUrl(winner.url) });
    return [winner.url, ...urls.filter((u) => u !== winner.url)];
  } catch {
    playbackSpeedLog('gateway race no winner — keeping original order (CORS or all failed)');
    return urls;
  } finally {
    window.clearTimeout(timer);
    controllers.forEach((c) => c.abort());
  }
}

export const abortMediaElement = (el: HTMLMediaElement) => {
  el.pause();
};

/** Same node the player UI adopts — create it immediately so play() stays in the tap gesture. */
export function ensurePlaybackVideoElement(contract: string, tokenId: string): HTMLVideoElement {
  const id = `video-${contract}-${tokenId}`;
  const existing = document.getElementById(id);
  if (existing instanceof HTMLVideoElement) return existing;

  const video = document.createElement('video');
  video.id = id;
  video.setAttribute('data-podplayr-player', '1');
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = false;
  video.autoplay = false;
  video.style.display = 'none';
  document.body.appendChild(video);
  return video;
}

export async function waitForVideoElement(
  contract: string,
  tokenId: string,
  timeoutMs = 5000
): Promise<HTMLVideoElement | null> {
  const id = `video-${contract}-${tokenId}`;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const el = document.getElementById(id);
    if (el instanceof HTMLVideoElement) return el;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      requestAnimationFrame(done);
      window.setTimeout(done, 32);
    });
  }
  return null;
}

// Function to check if a URL is a video file
export const isVideoUrl = (url: string): boolean => {
  if (!url) return false;
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov'];
  return videoExtensions.some(ext => url.toLowerCase().endsWith(ext));
};

// Function to check if a URL is an audio file
export const isAudioUrl = (url: string): boolean => {
  if (!url) return false;
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a'];
  return audioExtensions.some(ext => url.toLowerCase().endsWith(ext));
};

// Safe percentage for progress-bar widths/positions. Guards the same NaN/Infinity
// cases as formatTime (duration not loaded yet, 0, or a stream with no reported
// length) so the bar never gets a "NaN%"/"Infinity%" width — clamped to [0, 100].
export const safeProgressPercent = (value: number, duration: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (value / duration) * 100));
};

// Function to format time in MM:SS format.
// Guards NaN/Infinity/negative so the UI can never show "NaN:NaN" — these happen
// legitimately whenever duration/progress isn't known yet (metadata not loaded)
// or a gateway streams audio without reporting a proper Content-Length.
export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

/**
 * Derive display elapsed/remaining so the two numbers always stay in sync.
 * Flooring progress and (duration - progress) separately can drift by 1s
 * (e.g. 0:45 / -1:14 when total is 2:00). Remaining is derived from floored
 * elapsed instead so elapsed + remaining === floor(duration).
 */
export const getDisplayTimes = (
  progress: number,
  duration: number
): { elapsed: number; remaining: number; total: number } => {
  const total = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
  const rawProgress = Number.isFinite(progress) && progress > 0 ? progress : 0;
  const elapsed = total > 0
    ? Math.min(total, Math.floor(rawProgress))
    : Math.floor(rawProgress);
  const remaining = total > 0 ? Math.max(0, total - elapsed) : 0;
  return { elapsed, remaining, total };
};

// Create a safe document ID from a URL by removing invalid characters
const createSafeId = (url: string): string => {
  if (!url) return '';
  
  // Try to extract IPFS hash first
  const ipfsHash = extractIPFSHash(url);
  if (ipfsHash) {
    return `ipfs_${ipfsHash}`;
  }

  // For non-IPFS URLs, create a safe ID by removing all special characters and slashes
  return url
    .replace(/^https?:\/\//, '') // Remove protocol
    .replace(/\/ipfs\//g, '_') // Replace /ipfs/ with underscore
    .replace(/\/+/g, '_') // Replace all slashes with underscore
    .replace(/[^a-zA-Z0-9]/g, '_') // Replace ALL special chars with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .toLowerCase() // Convert to lowercase for consistency
    .slice(0, 100); // Limit length
};

/**
 * In-memory cache to avoid redundant mediaKey calculations
 * Maps NFT contract+tokenId to its calculated mediaKey
 */
// Add caching to prevent regenerating the same mediaKeys
// Remove duplicate declaration since mediaKeyCache is already declared below

/**
 * Generate a unique mediaKey for an NFT
 * Uses UUID to ensure each NFT has a unique identifier for tracking
 */
import { createHash } from 'crypto';
// uuidv4 is already imported at the top of the fil

// Cache for consistent mediaKey generation
const mediaKeyCache = new Map<string, string>();

export const getMediaKey = (nft: UserNFT): string => {
  // Create a deterministic key based on NFT properties
  // NORMALIZE the tokenId to ensure consistency
  const normalizedTokenId = nft.tokenId?.toString().replace(/^0x+/, '0x') || '';
  const nftIdentifier = `${nft.contract}-${normalizedTokenId}`;
  
  // Check cache first
  if (mediaKeyCache.has(nftIdentifier)) {
    return mediaKeyCache.get(nftIdentifier)!;
  }
  
  // Generate deterministic mediaKey based on NFT properties
  const mediaKey = createHash('sha256')
    .update(`${nft.contract}-${normalizedTokenId}`)
    .digest('hex')
    .substring(0, 32); // Keep it shorter but still unique
  
  // Cache the result
  mediaKeyCache.set(nftIdentifier, mediaKey);
  
  return mediaKey;
};

export const generateNewMediaKey = (): string => {
  return uuidv4();
};

const IMAGE_FALLBACK = '/default-nft.png';
const AUDIO_FALLBACK = '/default-audio.mp3';
const nftMediaUrlCache: Record<string, Record<string, string>> = {};

/** Drop cached image/audio URLs so the next resolve re-runs processMediaUrl. */
export const clearNftMediaUrlCache = (
  nft?: UserNFT | null,
  mediaType?: 'image' | 'audio'
): void => {
  if (!nft) {
    Object.keys(nftMediaUrlCache).forEach((key) => delete nftMediaUrlCache[key]);
    return;
  }
  const cacheKey = `${nft.contract}-${nft.tokenId}`;
  if (!mediaType) {
    delete nftMediaUrlCache[cacheKey];
    return;
  }
  if (nftMediaUrlCache[cacheKey]) {
    delete nftMediaUrlCache[cacheKey][mediaType];
  }
};

/** Resolve an NFT image/audio URL, preferring a gateway that already worked. */
export const getNftMediaUrl = (nft: UserNFT, mediaType: 'image' | 'audio'): string => {
  if (!nft) {
    return mediaType === 'image' ? IMAGE_FALLBACK : AUDIO_FALLBACK;
  }

  const cacheKey = `${nft.contract}-${nft.tokenId}`;
  const mediaKey = getMediaKey(nft);
  const imageCandidates = mediaType === 'image' ? pickImageCandidates(nft) : [];
  const alchemyPreferred =
    mediaType === 'image'
      ? [nft.image, ...imageCandidates].find((u) => isAlchemyCdnMediaUrl(u))
      : [nft.audio, nft.videoUrl, nft.metadata?.animation_url].find((u) =>
          isAlchemyCdnMediaUrl(u)
        );
  // Prefer video cover from image fields only. Fall back to animation_url video
  // only when there is no Alchemy still (otherwise Base House / Coinbase Pass
  // cards flash the playback mp4 instead of the still).
  const imageTokenVideo =
    mediaType === 'image'
      ? [nft.image, nft.metadata?.image].find(
          (u) =>
            !!u &&
            (looksLikeVideoFileUrl(u) ||
              /niftyisland\.com/i.test(u) ||
              (/raw2?\.seadn\.io/i.test(u) && !looksLikeAudioFileUrl(u)))
        )
      : undefined;
  const animTokenVideo =
    mediaType === 'image' && !alchemyPreferred
      ? [nft.metadata?.animation_url, nft.animationUrl, nft.videoUrl].find(
          (u) =>
            !!u &&
            (looksLikeVideoFileUrl(u) ||
              /niftyisland\.com/i.test(u) ||
              (/raw2?\.seadn\.io/i.test(u) && !looksLikeAudioFileUrl(u)))
        )
      : undefined;
  const tokenVideoPreferred = imageTokenVideo || animTokenVideo;
  const rawSourceUrl =
    mediaType === 'image'
      ? tokenVideoPreferred ||
        alchemyPreferred ||
        imageCandidates[0] ||
        nft.image ||
        nft.metadata?.image ||
        ''
      : alchemyPreferred || nft.audio || nft.metadata?.animation_url || '';
  const sourceUrl = rewriteLegacyOpenSeaMediaUrl(rawSourceUrl, nft.contract, nft.network);

  const pods = parseArweaveMediaPath(sourceUrl);
  const isPodsStyle = !!(pods.manifestId && pods.filePath);
  const isPoisonedRaw = (candidate: string) =>
    mediaType === 'image' &&
    candidate.includes('/raw/') &&
    !!sourceUrl &&
    !sourceUrl.includes('/raw/') &&
    !isPodsStyle;

  const isPoisonedMypinata = (candidate: string) =>
    mediaType === 'image' && /mypinata\.cloud/i.test(candidate);

  // Subdomain / CORS-hostile gateways often fail in the mini-app (Chili Sounds
  // on *.ipfs.w3s.link). Prefer pinata rewrite via processMediaUrl instead.
  const isPoisonedHostileIpfs = (candidate: string) => {
    if (mediaType !== 'image') return false;
    try {
      return /(?:^|\.)w3s\.link$/i.test(new URL(candidate).hostname);
    } catch {
      return /w3s\.link/i.test(candidate);
    }
  };

  // Stale cache/memory often holds dead public IPFS after Alchemy enrich.
  const isPoisonedStaleIpfs = (candidate: string) =>
    !!alchemyPreferred &&
    !isAlchemyCdnMediaUrl(candidate) &&
    (!!extractIPFSPath(candidate) || /\/ipfs\//i.test(candidate));

  if (alchemyPreferred) {
    if (!nftMediaUrlCache[cacheKey]) nftMediaUrlCache[cacheKey] = {};
    nftMediaUrlCache[cacheKey][mediaType] = alchemyPreferred;
    return preferBrowserReachableMediaUrl(alchemyPreferred);
  }

  const cached = nftMediaUrlCache[cacheKey]?.[mediaType];
  if (cached) {
    if (
      !isPoisonedRaw(cached) &&
      !isPoisonedMypinata(cached) &&
      !isPoisonedHostileIpfs(cached) &&
      !isPoisonedStaleIpfs(cached)
    ) {
      return preferBrowserReachableMediaUrl(cached);
    }
    delete nftMediaUrlCache[cacheKey][mediaType];
    forgetMediaUrl(mediaKey, mediaType);
  }

  const remembered = getRememberedMediaUrl(mediaKey, mediaType);
  if (remembered) {
    // Single-tx Arweave images remembered as turbo /raw/ often hang; PODs
    // (manifest/file) still need /raw/. Skip poisoned memory for plain txs.
    // Dedicated mypinata hosts stall on large GIFs (Chili Sounds) — skip those too.
    if (
      !isPoisonedRaw(remembered) &&
      !isPoisonedMypinata(remembered) &&
      !isPoisonedHostileIpfs(remembered) &&
      !isPoisonedStaleIpfs(remembered)
    ) {
      if (!nftMediaUrlCache[cacheKey]) nftMediaUrlCache[cacheKey] = {};
      nftMediaUrlCache[cacheKey][mediaType] = remembered;
      return preferBrowserReachableMediaUrl(remembered);
    }
    forgetMediaUrl(mediaKey, mediaType);
  }

  if (!sourceUrl) {
    return mediaType === 'image' ? IMAGE_FALLBACK : AUDIO_FALLBACK;
  }

  const url = processMediaUrl(sourceUrl, mediaType === 'image' ? IMAGE_FALLBACK : AUDIO_FALLBACK, mediaType);
  if (!nftMediaUrlCache[cacheKey]) nftMediaUrlCache[cacheKey] = {};
  nftMediaUrlCache[cacheKey][mediaType] = url;
  return preferBrowserReachableMediaUrl(url);
};

/** Warm the browser cache for an NFT's display image. Audio starts on play. */
export const preloadNftMedia = (nft: UserNFT): void => {
  if (!nft || typeof window === 'undefined') return;

  const imageUrl = getNftMediaUrl(nft, 'image');
  if (imageUrl && imageUrl !== IMAGE_FALLBACK) {
    const imgPreload = new Image();
    imgPreload.src = imageUrl;
  }
};

export const validateMediaKey = (mediaKey: string): boolean => {
  return typeof mediaKey === 'string' && mediaKey.length > 0;
};

export function getDirectMediaUrl(url: string): string {
  if (!url) return '';

  const ipfsPath = extractIPFSPath(url);
  if (ipfsPath) {
    return toIpfsGatewayUrl(ipfsPath);
  }

  if (url.includes('ar://')) {
    return processArweaveUrl(url);
  }

  return url;
}

// Function to check if audio/video playback is currently active
// This is used to reduce logging noise during playback
export const isPlaybackActive = (): boolean => {
  // Check if any audio elements are currently playing
  const audioElements = document.querySelectorAll('audio');
  for (const audio of audioElements) {
    if (!audio.paused && !audio.ended) {
      return true;
    }
  }
  
  // Check if any video elements are currently playing
  const videoElements = document.querySelectorAll('video');
  for (const video of videoElements) {
    if (!video.paused && !video.ended) {
      return true;
    }
  }
  
  return false;
};
