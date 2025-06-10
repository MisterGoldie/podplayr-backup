import { useState, useEffect, useCallback, useRef } from 'react';
import { NFT } from '../types/user';
import { getMediaKey, processMediaUrl } from '../utils/media';
import { v4 as uuidv4 } from 'uuid';

// Create a singleton cache that persists across component remounts
class SessionImageCache {
  private static instance: SessionImageCache;
  private cache: Map<string, HTMLImageElement>;
  private loadingPromises: Map<string, Promise<void>>;

  private constructor() {
    this.cache = new Map();
    this.loadingPromises = new Map();
  }

  public static getInstance(): SessionImageCache {
    if (!SessionImageCache.instance) {
      SessionImageCache.instance = new SessionImageCache();
    }
    return SessionImageCache.instance;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public get(key: string): HTMLImageElement | undefined {
    return this.cache.get(key);
  }

  public getLoadingPromise(key: string): Promise<void> | undefined {
    return this.loadingPromises.get(key);
  }

  public async preloadImage(nft: NFT): Promise<void> {
    const key = getMediaKey(nft);
    if (this.has(key)) return;

    // If already loading, return existing promise
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key);
    }

    const imageUrl = processMediaUrl(nft.metadata?.image || nft.image || '');
    if (!imageUrl) return;

    const loadPromise = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(key, img);
        this.loadingPromises.delete(key);
        resolve();
      };
      img.onerror = () => {
        this.loadingPromises.delete(key);
        resolve(); // Resolve anyway to prevent hanging
      };
      img.src = imageUrl;
    });

    this.loadingPromises.set(key, loadPromise);
    return loadPromise;
  }

  public clear(): void {
    this.cache.clear();
    this.loadingPromises.clear();
  }
}

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useSessionImageCache = (nfts: NFT[]) => {
  const [isLoading, setIsLoading] = useState(true);
  const cache = SessionImageCache.getInstance();

  // Use a ref to track if this is the first render
  const initialRenderRef = useRef(true);
  
  // Use a ref to store the NFT keys for comparison
  const prevNftKeysRef = useRef<string[]>([]);
  
  useEffect(() => {
    let mounted = true;
    
    // Generate stable keys for comparison
    const currentNftKeys = nfts.map(nft => getMediaKey(nft));
    
    // Only run preload if this is the first render or if NFTs have actually changed
    const nftsChanged = !arraysEqual(currentNftKeys, prevNftKeysRef.current);
    
    if (initialRenderRef.current || nftsChanged) {
      // Update refs
      initialRenderRef.current = false;
      prevNftKeysRef.current = currentNftKeys;
      
      const preloadBatch = async () => {
        if (!mounted) return;
        setIsLoading(true);

        try {
          // Preload first batch immediately
          const initialBatch = nfts.slice(0, 6);
          await Promise.all(initialBatch.map(nft => cache.preloadImage(nft)));

          // Preload rest in background
          if (mounted) {
            const remainingBatch = nfts.slice(6);
            remainingBatch.forEach(nft => {
              cache.preloadImage(nft).catch(() => {}); // Ignore errors for background loading
            });
          }
        } finally {
          if (mounted) {
            setIsLoading(false);
          }
        }
      };

      preloadBatch();
    }

    return () => {
      mounted = false;
    };
  }, [nfts]);
  
  // Helper function to compare arrays
  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }

  const getPreloadedImage = (nft: NFT): HTMLImageElement | undefined => {
    const key = getMediaKey(nft);
    return cache.get(key);
  };

  // Use useCallback to memoize the preloadImage function to prevent infinite renders
  const preloadImage = useCallback((nft: NFT) => {
    return cache.preloadImage(nft);
  }, []);

  return {
    isLoading,
    getPreloadedImage,
    preloadImage
  };
}; 