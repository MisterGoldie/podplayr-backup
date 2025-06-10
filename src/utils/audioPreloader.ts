import { getMediaKey, extractIPFSHash, IPFS_GATEWAYS } from './media';
import type { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';

interface AudioMetadata {
  duration: number;
  lastPlayed: number;
  url: string;
  gateway?: string;
}

interface GatewayTest {
  url: string;
  speed: number;
  valid: boolean;
}

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};

// Cache audio metadata using mediaKey as the identifier
export const cacheAudioMetadata = async (nft: NFT, audioElement: HTMLAudioElement | null) => {
  if (!audioElement || !nft) return;
  
  const mediaKey = generateMediaKey(nft);
  try {
    const metadata: AudioMetadata = {
      duration: audioElement.duration,
      lastPlayed: Date.now(),
      url: nft.audio || nft.metadata?.animation_url || ''
    };
    
    localStorage.setItem(`audio-cache-${mediaKey}`, JSON.stringify(metadata));
  } catch (error) {
    console.warn('Failed to cache audio metadata:', error);
  }
};

// Get cached metadata for an NFT
export const getCachedAudioMetadata = (nft: NFT): AudioMetadata | null => {
  if (!nft) return null;
  
  try {
    const mediaKey = generateMediaKey(nft);
    const cached = localStorage.getItem(`audio-cache-${mediaKey}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.warn('Failed to get cached audio metadata:', error);
    return null;
  }
};

// Test gateway speeds and cache results
export const testGatewaySpeeds = async (urls: string[]): Promise<GatewayTest[]> => {
  const tests = urls.map(async (url) => {
    const start = performance.now();
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const end = performance.now();
      return { url, speed: end - start, valid: response.ok };
    } catch {
      return { url, speed: Infinity, valid: false };
    }
  });

  return Promise.all(tests);
};

// Get the fastest gateway for a given NFT
export const getFastestGateway = async (nft: NFT): Promise<string | null> => {
  const mediaKey = generateMediaKey(nft);
  const url = nft.audio || nft.metadata?.animation_url;
  if (!url) return null;

  try {
    // Check cached gateway first
    const gatewayCacheStr = localStorage.getItem('gateway-speeds');
    const gatewayCache = gatewayCacheStr ? JSON.parse(gatewayCacheStr) : {};
    if (gatewayCache[mediaKey]) {
      return gatewayCache[mediaKey];
    }

    // If no cached gateway, test speeds
    const ipfsHash = extractIPFSHash(url);
    const urlsToTry = ipfsHash 
      ? IPFS_GATEWAYS.map((gateway: string) => `${gateway}${ipfsHash}`)
      : [url];

    const results = await testGatewaySpeeds(urlsToTry);
    const fastestGateway = results
      .filter(r => r.valid)
      .sort((a, b) => a.speed - b.speed)[0];

    if (fastestGateway) {
      // Cache the result
      gatewayCache[mediaKey] = fastestGateway.url;
      localStorage.setItem('gateway-speeds', JSON.stringify(gatewayCache));
      return fastestGateway.url;
    }
  } catch (error) {
    console.warn('Error finding fastest gateway:', error);
  }
  
  return null;
};

export const preloadAudio = async (url: string): Promise<void> => {
  try {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = url;
    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve);
      audio.addEventListener('error', reject);
    });
  } catch (error) {
    console.error('Error preloading audio:', error);
  }
};
