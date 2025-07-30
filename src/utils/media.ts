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

// Update IPFS_GATEWAYS array (around line 18)
export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',           // Most reliable
  'https://gateway.pinata.cloud/ipfs/', // Second choice
  'https://nftstorage.link/ipfs/',   // Third choice
  'https://dweb.link/ipfs/',         // Additional fallback
];

// Enhanced Arweave fallback with immediate default
export const getAlternativeArweaveUrl = (originalUrl: string, failedGateways: Set<string> = new Set()): string => {
  // Due to browser blocking, immediately return default image for Arweave URLs
  console.warn('Arweave URL detected, using fallback due to browser restrictions:', originalUrl);
  return '/default-nft.png';
};

// Enhanced IPFS fallback with better error handling
// Remove lines 511-526 (the duplicate getAlternativeArweaveUrl function)
// Keep only the enhanced version at lines 26-30
export const getAlternativeIPFSUrl = (url: string, failedGateways: Set<string> = new Set()): string | null => {
  const ipfsHash = extractIPFSHash(url);
  if (!ipfsHash) return null;

  // Find next available gateway that hasn't failed
  for (const gateway of IPFS_GATEWAYS) {
    if (!failedGateways.has(gateway) && !url.includes(gateway)) {
      return `${gateway}${ipfsHash}`;
    }
  }
  
  return null; // No more gateways available
};

// Helper function to extract CID from various IPFS URL formats
export const extractIPFSHash = (url: string): string | null => {
  if (!url) return null;
  if (typeof url !== 'string') return null;

  // Remove any duplicate 'ipfs' in the path
  url = url.replace(/\/ipfs\/ipfs\//, '/ipfs/');

  // Handle ipfs:// protocol
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', '');
  }

  // Match IPFS hash patterns - support both v0 and v1 CIDs
  const ipfsMatch = url.match(/(?:ipfs\/|\/ipfs\/|ipfs:)([a-zA-Z0-9]{46,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55})/i);
  if (ipfsMatch) {
    return ipfsMatch[1];
  }

  // Handle nftstorage.link URLs
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'nftstorage.link' && parsedUrl.pathname.includes('/ipfs/')) {
      // Keep using the nftstorage.link gateway for these URLs
      return url;
    }
  } catch (e) {
    // If URL parsing fails, continue with other checks
  }

  // Handle direct CID - support both v0 and v1 CIDs
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55}|[a-zA-Z0-9]{46})$/.test(url)) {
    return url;
  }

  return null;
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
    // If it's already an https://arweave.net URL, return it as is
    if (url.startsWith('https://arweave.net/')) {
      return url;
    }
    
    // If it's not an ar:// URL, return as is
    if (!url.startsWith('ar://')) {
      return url;
    }

    // Special handling for audio files to preserve exact path structure
    if (mediaType === 'audio' && url.startsWith('ar://') && url.includes('/')) {
      const arPath = url.replace('ar://', '');
      const segments = arPath.split('/');
      const txId = segments[0];
      const filePath = segments.slice(1).join('/');
      
      arLogger.debug(`Audio file with path structure: ${txId}/${filePath}`);
      
      // For audio files, preserve the exact path structure which is critical for playback
      return `https://arweave.net/${txId}/${filePath}`;
    }
    
    // PODs media special format: ar://<txid1>/<txid2>.mp3
    // Example: ar://qILNpSrUH8TcX_-_zGDicXiaAYaqLDF6Xxu2WVz1Uek/ykXQJ6ujmaciYiWHitm_Q_vcWtw_ER8nLjt3FocR9eo.mp3
    const podsMediaPattern = /^ar:\/\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)(\.[a-zA-Z0-9]+)?$/;
    const podsMatch = url.match(podsMediaPattern);
    
    if (podsMatch && mediaType !== 'audio') {
      // Handle PODs media format (for non-audio files)
      const firstTxId = podsMatch[1];
      const secondTxId = podsMatch[2];
      const extension = podsMatch[3] || '';
      
      arLogger.debug(`Detected PODs media format: ${firstTxId}/${secondTxId}${extension}`);
      
      // Use the second transaction ID as the main ID
      return `https://arweave.net/${secondTxId}${extension}`;
    }
    
    // Simple ar:// format
    if (!url.includes('/')) {
      const txId = url.replace('ar://', '');
      arLogger.debug(`Simple Arweave URL detected: ${txId}`);
      return `https://arweave.net/${txId}`;
    }
    
    // Parse the URL to extract components
    const arPath = url.substring(5); // Remove 'ar://'
    const segments = arPath.split('/');
    
    // If there's only one segment, use it directly
    if (segments.length === 1) {
      const cleanId = segments[0].split('?')[0].split('#')[0];
      arLogger.debug(`Single segment Arweave URL: ${cleanId}`);
      return `https://arweave.net/${cleanId}`;
    }
    
    // For multi-segment paths, use the last segment as the transaction ID
    const lastSegment = segments[segments.length - 1];
    
    // Clean the ID by removing query parameters and hash fragments
    // But keep file extensions for media files
    const cleanId = lastSegment.split('?')[0].split('#')[0];
    
    arLogger.debug(`Multi-segment Arweave URL, using last segment: ${cleanId}`);
    return `https://arweave.net/${cleanId}`;
  } catch (error) {
    // If there was an error processing the URL, log it and return the original
    arLogger.error('Error processing Arweave URL:', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return url;
  }
};

// List of alternative Arweave gateways to try for audio files
export const ARWEAVE_AUDIO_GATEWAYS = [
  'https://arweave.net/',
  'https://arweave.dev/',
  'https://gateway.arweave.net/',
  'https://arweave.crustapps.net/'
];

// Function to process media URLs to ensure they're properly formatted
export const processMediaUrl = (url: string, fallbackUrl: string = '/default-nft.png', mediaType: 'image' | 'audio' | 'metadata' = 'image'): string => {
  if (!url) return fallbackUrl;
  
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
        
        // Check if URL is not already using a CDN based on hostname
        if (hostname !== 'cloudflare-ipfs.com' && 
            !hostname.startsWith('cdn.') && 
            !hostname.includes('.cdn.')) {
          return getCdnUrl(url, mediaType);
        }
      } catch (error) {
        console.error('Failed to parse URL:', url, error);
      }
    }
  }

  // Remove any duplicate 'ipfs' in the path
  url = url.replace(/\/ipfs\/ipfs\//, '/ipfs/');

  // Check for supported media types that might need special handling
  const fileExt = url.split('.').pop()?.toLowerCase();
  
  // Handle IPFS URLs
  if (url.startsWith('ipfs://')) {
    // Remove ipfs:// prefix and any trailing slashes
    const hash = url.replace('ipfs://', '').replace(/\/*$/, '');
    
    // Process through our CDN if available
    if (CDN_CONFIG.baseUrl) {
      const ipfsUrl = `${IPFS_GATEWAYS[0]}${hash}`;
      return getCdnUrl(ipfsUrl, mediaType);
    }
    
    // For mobile devices, prioritize more reliable gateways
    // Use cloudflare gateway for better global CDN coverage
    const isMobile = typeof window !== 'undefined' && 
                    (navigator.userAgent.match(/Android/i) ||
                     navigator.userAgent.match(/iPhone/i) ||
                     navigator.userAgent.match(/iPad/i));
    
    if (isMobile) {
      return `https://cloudflare-ipfs.com/ipfs/${hash}`;
    }
    
    return `${IPFS_GATEWAYS[0]}${hash}`;
  }

  // Try to extract IPFS hash from other formats
  const ipfsHash = extractIPFSHash(url);
  if (ipfsHash) {
    // Remove any trailing slashes from the hash
    const cleanHash = ipfsHash.replace(/\/*$/, '');
    
    // Process through our CDN if available
    if (CDN_CONFIG.baseUrl) {
      const ipfsUrl = `${IPFS_GATEWAYS[0]}${cleanHash}`;
      return getCdnUrl(ipfsUrl, mediaType);
    }
    
    // For mobile devices, prioritize more reliable gateways
    const isMobile = typeof window !== 'undefined' && 
                    (navigator.userAgent.match(/Android/i) ||
                     navigator.userAgent.match(/iPhone/i) ||
                     navigator.userAgent.match(/iPad/i));
    
    if (isMobile) {
      return `https://cloudflare-ipfs.com/ipfs/${cleanHash}`;
    }
    
    return `${IPFS_GATEWAYS[0]}${cleanHash}`;
  }

  // Handle Arweave URLs directly within processMediaUrl for consistency
  if (url.startsWith('ar://')) {
    // Extract the transaction ID, removing the ar:// prefix
    let txId = url.replace('ar://', '');
    
    // Log the processing details
    console.log(`[processMediaUrl] Processing Arweave URL: ${url}, mediaType: ${mediaType}`);
    
    // Special handling for PODs audio URLs - we need to preserve the full path for audio files
    if (mediaType === 'audio' && txId.includes('/')) {
      // Format: ar://TRANSACTION_ID/PATH/TO/FILE.ext
      const segments = txId.split('/');
      const arTxId = segments[0]; // First segment is the transaction ID
      const filePath = segments.slice(1).join('/');
      
      // For audio files, use the full path which is required for PODs audio
      const fullPathUrl = `https://arweave.net/${arTxId}/${filePath}`;
      console.log(`[processMediaUrl] Using full path URL for audio: ${fullPathUrl}`);
      
      // Process through our CDN if available
      if (CDN_CONFIG.baseUrl) {
        return getCdnUrl(fullPathUrl, mediaType);
      }
      return fullPathUrl;
    }
    // Handle PODs-style URLs with multiple segments (for non-audio or as fallback)
    else if (txId.includes('/')) {
      // Format: ar://TRANSACTION_ID/PATH/TO/FILE.ext
      const segments = txId.split('/');
      txId = segments[0]; // First segment is the transaction ID
      
      // Reconstruct the path
      const path = segments.slice(1).join('/');
      const arweaveUrl = `https://arweave.net/${txId}/${path}`;
      
      console.log(`[processMediaUrl] Converted PODs-style URL: ${arweaveUrl}`);
      
      // Process through our CDN if available
      if (CDN_CONFIG.baseUrl) {
        return getCdnUrl(arweaveUrl, mediaType);
      }
      return arweaveUrl;
    }
    
    // Simple ar://TRANSACTION_ID format
    const arweaveUrl = `https://arweave.net/${txId}`;
    console.log(`[processMediaUrl] Converted simple Arweave URL: ${arweaveUrl}`);
    
    // Process through our CDN if available
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

// Function to format time in MM:SS format
export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return '0:00';
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
  
  // Handle IPFS URLs - try multiple gateways for better performance
  if (url.includes('ipfs://')) {
    const ipfsHash = url.replace('ipfs://', '');
    
    // For video content, use a CDN-backed gateway
    return `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`;
    
    // Fallbacks if needed:
    // return `https://ipfs.io/ipfs/${ipfsHash}`;
    // return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
  }
  
  // Handle Arweave URLs using our dedicated function
  if (url.includes('ar://')) {
    return processArweaveUrl(url);
  }
  
  // Return the URL directly without any processing
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

// Add after processArweaveUrl function
export const ARWEAVE_GATEWAYS = [
  'https://arweave.net/',
  'https://ar-io.net/',
  'https://g8way.io/',
];