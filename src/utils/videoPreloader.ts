import { NFT } from '../types/user';
import { isCellularConnection } from './cellularOptimizer';
import { processMediaUrl } from './media';

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
  
  try {
    const { isCellular } = isCellularConnection();
    
    // Process the URL to handle special protocols (ar://, ipfs://, etc.)
    const processedUrl = processMediaUrl(nft.metadata.animation_url);
    
    // For cellular connections, just load headers to get content length
    if (isCellular) {
      const response = await fetch(processedUrl, { 
        method: 'HEAD',
        headers: {
          'Range': 'bytes=0-0' // Just request the first byte to get headers
        }
      });
      
      console.log(`Preloaded metadata for ${nft.name}, size: ${response.headers.get('content-length')} bytes`);
    } else {
      // For WiFi, we can be more aggressive with preloading
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = processedUrl;
      
      // Remove after loading metadata
      video.onloadedmetadata = () => {
        console.log(`Preloaded metadata for ${nft.name}, duration: ${video.duration}s`);
        video.src = '';
      };
      
      // Handle errors
      video.onerror = () => {
        console.error(`Failed to preload metadata for ${nft.name}`);
        video.src = '';
      };
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
    
    // Determine chunk size based on network
    const chunkSize = isCellular 
      ? (generation === '5G' ? 500000 : // 500KB for 5G
         generation === '4G' ? 200000 : // 200KB for 4G
         100000) // 100KB for 3G/2G
      : 1000000; // 1MB for WiFi
    
    // Process the URL to handle special protocols (ar://, ipfs://, etc.)
    const processedUrl = processMediaUrl(nft.metadata.animation_url);

    // Fetch just the initial chunk
    const response = await fetch(processedUrl, {
      headers: {
        'Range': `bytes=0-${chunkSize - 1}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to preload chunk: ${response.status}`);
    }
    
    // Store in cache
    const chunk = await response.arrayBuffer();
    videoCache.setChunk(processedUrl, 0, chunkSize - 1, chunk);
    
    console.log(`Preloaded initial ${chunkSize} bytes for ${nft.name}`);
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