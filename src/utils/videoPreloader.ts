import { NFT } from '../types/user';
import { processMediaUrl, buildIpfsFallbackUrls, extractIPFSPath } from './media';

const isCellularConnection = (): {
  isCellular: boolean;
  generation: '5G' | '4G' | '3G' | '2G' | 'unknown';
} => {
  if (typeof navigator === 'undefined' || !('connection' in navigator)) {
    return { isCellular: false, generation: 'unknown' };
  }

  const connection = (navigator as Navigator & { connection?: {
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  } }).connection;
  const effectiveType = connection?.effectiveType || '';
  const downlink = connection?.downlink || 0;
  const rtt = connection?.rtt || 0;

  const isCellular =
    connection?.type === 'cellular' ||
    effectiveType.includes('g') ||
    Boolean(connection?.type?.includes('cell'));

  let generation: '5G' | '4G' | '3G' | '2G' | 'unknown' = 'unknown';
  if (isCellular) {
    if (downlink >= 50 && rtt < 50) generation = '5G';
    else if (downlink >= 10 || (effectiveType === '4g' && downlink > 5)) generation = '4G';
    else if (effectiveType === '3g' || downlink > 1) generation = '3G';
    else if (effectiveType === '2g' || effectiveType === 'slow-2g') generation = '2G';
  }

  return { isCellular, generation };
};

const resolveMediaUrls = (rawUrl: string): string[] => {
  if (rawUrl.startsWith('ipfs://') || extractIPFSPath(rawUrl)) {
    return buildIpfsFallbackUrls(rawUrl, { kind: 'media' });
  }
  const processed = processMediaUrl(rawUrl, '', 'audio');
  return processed ? [processed] : [];
};

// LRU Cache for video chunks
class VideoCache {
  private cache: Map<string, ArrayBuffer>;
  private maxSize: number;
  private currentSize: number;
  
  constructor(maxSizeMB: number = 50) {
    this.cache = new Map();
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert to bytes
    this.currentSize = 0;
  }
  
  async getChunk(url: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const key = `${url}:${start}-${end}`;
    if (this.cache.has(key)) {
      // Move to end of LRU (most recently used)
      const chunk = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, chunk);
      return chunk;
    }
    return null;
  }
  
  setChunk(url: string, start: number, end: number, chunk: ArrayBuffer): void {
    const key = `${url}:${start}-${end}`;
    const chunkSize = chunk.byteLength;
    
    // Check if adding this would exceed cache size
    if (this.currentSize + chunkSize > this.maxSize) {
      // Remove oldest entries until we have space
      const entries = Array.from(this.cache.entries());
      let i = 0;
      
      while (this.currentSize + chunkSize > this.maxSize && i < entries.length) {
        const [oldKey, oldChunk] = entries[i];
        this.cache.delete(oldKey);
        this.currentSize -= oldChunk.byteLength;
        i++;
      }
    }
    
    // Add new chunk
    this.cache.set(key, chunk);
    this.currentSize += chunkSize;
  }
  
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }
}

// Singleton cache instance
const videoCache = new VideoCache();

// Function to preload video metadata
export const preloadVideoMetadata = async (nft: NFT): Promise<void> => {
  if (!nft.metadata?.animation_url) return;

  const urls = resolveMediaUrls(nft.metadata.animation_url);
  if (urls.length === 0) return;

  try {
    const { isCellular } = isCellularConnection();

    if (isCellular) {
      let lastError: unknown;
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            headers: { Range: 'bytes=0-0' },
          });
          if (response.ok || response.status === 206) {
            console.log(`Preloaded metadata for ${nft.name}, size: ${response.headers.get('content-length')} bytes`);
            return;
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
    } else {
      await new Promise<void>((resolve) => {
        let index = 0;
        const video = document.createElement('video');
        video.preload = 'metadata';

        const tryNext = () => {
          if (index >= urls.length) {
            console.error(`Failed to preload metadata for ${nft.name}`);
            video.src = '';
            resolve();
            return;
          }
          video.src = urls[index++];
        };

        video.onloadedmetadata = () => {
          console.log(`Preloaded metadata for ${nft.name}, duration: ${video.duration}s`);
          video.src = '';
          resolve();
        };
        video.onerror = () => tryNext();
        tryNext();
      });
    }
  } catch (error) {
    console.error(`Error preloading video metadata for ${nft.name}:`, error);
  }
};

// Function to preload initial video chunk
export const preloadVideoInitialChunk = async (nft: NFT): Promise<void> => {
  if (!nft.metadata?.animation_url) return;

  try {
    const { isCellular, generation } = isCellularConnection();

    const chunkSize = isCellular
      ? generation === '5G'
        ? 500000
        : generation === '4G'
          ? 200000
          : 100000
      : 1000000;

    const urls = resolveMediaUrls(nft.metadata.animation_url);
    let lastError: unknown;

    for (const processedUrl of urls) {
      try {
        const response = await fetch(processedUrl, {
          headers: { Range: `bytes=0-${chunkSize - 1}` },
        });

        if (!response.ok && response.status !== 206) {
          throw new Error(`Failed to preload chunk: ${response.status}`);
        }

        const chunk = await response.arrayBuffer();
        videoCache.setChunk(processedUrl, 0, chunkSize - 1, chunk);
        console.log(`Preloaded initial ${chunkSize} bytes for ${nft.name}`);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
  } catch (error) {
    console.error(`Error preloading video chunk for ${nft.name}:`, error);
  }
};

// Export the cache for use in the player
export { videoCache };

// Function to predictively preload the next few NFTs in a queue
export const predictivePreload = (nfts: NFT[], currentIndex: number, preloadCount: number = 3): void => {
  if (!nfts || nfts.length === 0 || currentIndex < 0) return;
  
  // Determine if we're on a cellular connection
  const { isCellular } = isCellularConnection();
  
  // Determine how many NFTs to preload based on connection type
  const actualPreloadCount = isCellular ? Math.min(2, preloadCount) : preloadCount;
  
  // Preload the next few NFTs
  for (let i = 1; i <= actualPreloadCount; i++) {
    const nextIndex = (currentIndex + i) % nfts.length;
    const nextNFT = nfts[nextIndex];
    
    if (nextNFT && nextNFT.metadata?.animation_url) {
      console.log(`Predictively preloading NFT ${i} of ${actualPreloadCount}: ${nextNFT.name || 'Unnamed NFT'}`);
      
      // For cellular connections, just preload metadata
      if (isCellular) {
        preloadVideoMetadata(nextNFT);
      } else {
        // For WiFi, preload initial chunk too
        preloadVideoInitialChunk(nextNFT);
      }
    }
  }
};