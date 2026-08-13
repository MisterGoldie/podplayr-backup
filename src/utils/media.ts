"use client";

import { useState } from 'react';
import { NFT as UserNFT } from '../types/user';
import { getCdnUrl, CDN_CONFIG } from './cdn';
import { v4 as uuidv4 } from 'uuid';

// List of reliable IPFS gateways in order of preference
// Helper function to clean IPFS URLs
export const getCleanIPFSUrl = (url: string): string => {
  if (!url) return url;
  if (typeof url !== 'string') return '';
  // Remove any duplicate 'ipfs' in the path
  return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
};

// Prefer gateways that currently resolve and serve NFT media reliably.
// cloudflare-ipfs.com is dead (ERR_NAME_NOT_RESOLVED). ipfs.io often 504s.
export const PRIMARY_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

export const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://gateway.ipfs.io/ipfs/',
];

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
  const base = gateway.endsWith('/') ? gateway : `${gateway}/`;
  return `${base}${encoded}`;
};

/** Ordered IPFS URLs across working gateways (preserves CID subpaths). */
export const buildIpfsFallbackUrls = (url: string): string[] => {
  const path = extractIPFSPath(url);
  if (!path) return url ? [url] : [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  for (const gateway of IPFS_GATEWAYS) {
    push(toIpfsGatewayUrl(path, gateway));
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    push(url);
  }
  return urls;
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

// Check if an NFT is using the same URL for both image and audio
export const isAudioUrlUsedAsImage = (nft: UserNFT, imageUrl: string): boolean => {
  if (!imageUrl) return false;
  
  // Get all possible audio URLs
  const audioUrls = [
    nft?.audio,
    (nft?.metadata as any)?.audio,
    nft?.metadata?.animation_url
  ].filter(Boolean);
  
  // Return true if imageUrl matches any audio URL
  return audioUrls.includes(imageUrl);
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

// Function to process media URLs to ensure they're properly formatted
export const processMediaUrl = (url: string, fallbackUrl: string = '/default-nft.png', mediaType: 'image' | 'audio' | 'metadata' = 'image'): string => {
  if (!url) return fallbackUrl;
  if (typeof url !== 'string') return fallbackUrl;
  
  // Rewrite dead IPFS gateway hosts (cloudflare-ipfs.com DNS no longer resolves)
  if ((url.startsWith('http://') || url.startsWith('https://')) && url.includes('/ipfs/')) {
    try {
      const parsed = new URL(url);
      if (DEAD_IPFS_HOSTS.has(parsed.hostname)) {
        const path = extractIPFSPath(url);
        if (path) {
          url = toIpfsGatewayUrl(path);
        }
      } else {
        const hasDoubleIpfs = url.includes('/ipfs/ipfs/');
        if (!hasDoubleIpfs) {
          return url;
        }
        return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
      }
    } catch {
      // fall through
    }
  }

  // For audio files from Arweave, we need to be extra careful to preserve the exact file path
  if (mediaType === 'audio' && url.startsWith('ar://')) {
    return processArweaveUrl(url, 'audio');
  }

  // First, try to use our CDN if enabled
  if (CDN_CONFIG.baseUrl) {
    // Don't double-process URLs that are already using our CDN
    if (url.includes(CDN_CONFIG.baseUrl)) {
      return url;
    }
    
    // Use CDN for HTTP(S) URLs that aren't already using a CDN
    if ((url.startsWith('http://') || url.startsWith('https://'))) {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        
        if (
          !DEAD_IPFS_HOSTS.has(hostname) &&
          !hostname.startsWith('cdn.') &&
          !hostname.includes('.cdn.')
        ) {
          return getCdnUrl(url, mediaType);
        }
      } catch (error) {
        console.error('Failed to parse URL:', url, error);
      }
    }
  }

  // Handle IPFS URLs with working primary gateway (preserves CID/file subpaths)
  if (url.startsWith('ipfs://')) {
    const path = extractIPFSPath(url);
    if (path) {
      const ipfsUrl = toIpfsGatewayUrl(path);
      if (CDN_CONFIG.baseUrl) {
        return getCdnUrl(ipfsUrl, mediaType);
      }
      return ipfsUrl;
    }
  }

  const ipfsPath = extractIPFSPath(url);
  if (ipfsPath) {
    const ipfsUrl = toIpfsGatewayUrl(ipfsPath);
    if (CDN_CONFIG.baseUrl) {
      return getCdnUrl(ipfsUrl, mediaType);
    }
    return ipfsUrl;
  }

  // Handle Arweave URLs directly within processMediaUrl for consistency
  if (url.startsWith('ar://')) {
    console.log(`[processMediaUrl] Processing Arweave URL: ${url}, mediaType: ${mediaType}`);

    const { fileTxId, manifestId, filePath } = parseArweaveMediaPath(url);

    // Prefer /raw/{fileTxId} — turbo/permagate serve PODs media that arweave.net 404s
    if (fileTxId) {
      const arweaveUrl = toArweaveRawUrl(fileTxId);
      console.log(`[processMediaUrl] Using raw file tx URL: ${arweaveUrl}`);
      if (CDN_CONFIG.baseUrl) {
        return getCdnUrl(arweaveUrl, mediaType);
      }
      return arweaveUrl;
    }

    if (manifestId && filePath) {
      const arweaveUrl = `${PRIMARY_ARWEAVE_GATEWAY}${manifestId}/${filePath}`;
      console.log(`[processMediaUrl] Using path URL: ${arweaveUrl}`);
      if (CDN_CONFIG.baseUrl) {
        return getCdnUrl(arweaveUrl, mediaType);
      }
      return arweaveUrl;
    }

    const txId = url.replace('ar://', '').split('/')[0];
    const arweaveUrl = toArweaveRawUrl(txId);
    console.log(`[processMediaUrl] Converted simple Arweave URL: ${arweaveUrl}`);
    if (CDN_CONFIG.baseUrl) {
      return getCdnUrl(arweaveUrl, mediaType);
    }
    return arweaveUrl;
  }

  // For any other URLs, try to use CDN if available
  if (CDN_CONFIG.baseUrl && (url.startsWith('http://') || url.startsWith('https://'))) {
    return getCdnUrl(url, mediaType);
  }

  return url || fallbackUrl;
};

// Export the list of gateways so components can try alternatives if needed

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
