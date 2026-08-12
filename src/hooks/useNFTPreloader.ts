import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { NFT } from '../types/user';
import { getMediaKey, processMediaUrl, buildArweaveMediaFallbackUrls } from '../utils/media';
import { v4 as uuidv4 } from 'uuid';

// Network speed detection
const detectNetworkSpeed = () => {
  if ('connection' in navigator) {
    const conn = (navigator as any).connection;
    if (conn.effectiveType) {
      return conn.effectiveType as '4g' | '3g' | 'slow-3g';
    }
  }
  return '4g';
};

const preloadSingleImage = async (nft: NFT, imageMap: Map<string, HTMLImageElement>) => {
  // Get the image URL
  const rawImageUrl = nft.metadata?.image || nft.image || '';
  if (!rawImageUrl) return;

  const candidates = [
    processMediaUrl(rawImageUrl, '/default-nft.png', 'image'),
    ...buildArweaveMediaFallbackUrls(rawImageUrl),
  ].filter((url, index, arr) => url && arr.indexOf(url) === index);

  const key = getMediaKey(nft);

  for (const imageUrl of candidates) {
    const loaded = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => {
        imageMap.set(key, img);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = imageUrl;
    });
    if (loaded) return;
  }

  console.warn('Failed to preload image for NFT:', nft.name);
};

const preloadBatch = async (nfts: NFT[], imageMap: Map<string, HTMLImageElement> = new Map()) => {
  await Promise.all(nfts.map(nft => preloadSingleImage(nft, imageMap)));
  return imageMap;
};

// Remove the custom generateMediaKey function
// const generateMediaKey = (nft: NFT): string => {
//   return uuidv4();
// };

// The file already imports and uses getMediaKey correctly in most places
export const useNFTPreloader = (nfts: NFT[]) => {
  const [preloadedImages, setPreloadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [networkType, setNetworkType] = useState<'4g' | '3g' | 'slow-3g'>('4g');
  const [loadedCount, setLoadedCount] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageMapRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const nftsRef = useRef(nfts);

  // Update nftsRef when nfts change
  useEffect(() => {
    nftsRef.current = nfts;
  }, [nfts]);

  // Determine batch size based on network speed
  const batchSize = useMemo(() => networkType === '4g' ? 6 : 3, [networkType]);

  // Network speed detection
  useEffect(() => {
    const updateNetworkType = () => {
      setNetworkType(detectNetworkSpeed());
    };

    updateNetworkType();
    if ('connection' in navigator) {
      (navigator as any).connection.addEventListener('change', updateNetworkType);
      return () => {
        (navigator as any).connection.removeEventListener('change', updateNetworkType);
      };
    }
  }, []);

  // Progressive loading with Intersection Observer
  const loadMoreOnScroll = useCallback(async () => {
    if (loadedCount >= nftsRef.current.length) return;
    
    const nextBatch = nftsRef.current.slice(loadedCount, loadedCount + batchSize);
    const updatedMap = await preloadBatch(nextBatch, imageMapRef.current);
    imageMapRef.current = updatedMap;
    setPreloadedImages(new Map(updatedMap));
    setLoadedCount(prev => prev + batchSize);
  }, [loadedCount, batchSize]); // Removed nfts from dependencies

  // Initialize Intersection Observer
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreOnScroll();
        }
      },
      { threshold: 0.5 }
    );

    observerRef.current = observer;
    observer.observe(containerRef.current);
    
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [loadMoreOnScroll]);

  // Preload initial batch
  useEffect(() => {
    const preloadInitialBatch = async () => {
      setIsLoading(true);
      const initialBatch = nftsRef.current.slice(0, batchSize);
      
      // Preload initial batch
      const updatedMap = await preloadBatch(initialBatch, imageMapRef.current);
      imageMapRef.current = updatedMap;
      setPreloadedImages(new Map(updatedMap));
      setLoadedCount(batchSize);
      setIsLoading(false);
    };

    preloadInitialBatch();

    // Cleanup function
    return () => {
      imageMapRef.current.clear();
      setPreloadedImages(new Map());
      setLoadedCount(0);
    };
  }, [batchSize]); // Only depend on batchSize

  const getPreloadedImage = useCallback((nft: NFT): HTMLImageElement | undefined => {
    const key = getMediaKey(nft);
    return preloadedImages.get(key);
  }, [preloadedImages]);

  const preloadImage = useCallback((nft: NFT) => {
    const rawImageUrl = nft.image || nft.metadata?.image;
    if (!rawImageUrl) return;

    const key = getMediaKey(nft);
    if (imageMapRef.current.has(key)) return;

    const candidates = [
      processMediaUrl(rawImageUrl, '/default-nft.png', 'image'),
      ...buildArweaveMediaFallbackUrls(rawImageUrl),
    ].filter((url, index, arr) => url && arr.indexOf(url) === index);

    const tryNext = (index: number) => {
      if (index >= candidates.length) {
        console.warn('Failed to preload image for NFT:', nft.name);
        return;
      }
      const img = new Image();
      img.onload = () => {
        imageMapRef.current.set(key, img);
        setPreloadedImages(new Map(imageMapRef.current));
      };
      img.onerror = () => tryNext(index + 1);
      img.src = candidates[index];
    };

    tryNext(0);
  }, []);

  return {
    preloadedImages,
    isLoading,
    getPreloadedImage,
    preloadImage,
    containerRef
  };
};
