import { useEffect, useState, useCallback, useRef } from 'react';
import type { NFT } from '../types/user';
import { getMediaKey, processMediaUrl, processArweaveUrl } from '../utils/media';
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
  let imageUrl = nft.metadata?.image || nft.image || '';
  if (!imageUrl) return;

  // Process the URL to handle special protocols
  try {
    // Safely check if this is an Arweave URL
    if (typeof imageUrl === 'string' && imageUrl.startsWith('ar://')) {
      // Special handling for Arweave URLs
      imageUrl = processArweaveUrl(imageUrl);
      console.log('Processed Arweave URL for preloading:', imageUrl);
    } else {
      // Process other URL types
      imageUrl = processMediaUrl(imageUrl);
    }
  } catch (error) {
    console.error('Error processing image URL:', error);
    imageUrl = '/default-nft.png';
  }

  const key = getMediaKey(nft);
  
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageMap.set(key, img);
      resolve();
    };
    img.onerror = (error) => {
      console.warn('Failed to preload image for NFT:', nft.name, error);
      // Try a fallback for Arweave URLs
      try {
        const isArweaveNet = typeof imageUrl === 'string' && new URL(imageUrl).hostname === 'arweave.net';
        const hasArProtocol = typeof nft.metadata?.image === 'string' && nft.metadata.image.startsWith('ar://');
        
        if (isArweaveNet && hasArProtocol) {
          const fallbackUrl = `/default-nft.png`;
          console.log('Using fallback for failed Arweave image:', fallbackUrl);
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            imageMap.set(key, fallbackImg);
            resolve();
          };
          fallbackImg.onerror = () => {
            console.error('Even fallback image failed to load');
            resolve(); // Resolve anyway to not block other images
          };
          fallbackImg.src = fallbackUrl;
        } else {
          resolve(); // Resolve even on error to not block other images
        }
      } catch (error) {
        console.error('Error checking Arweave URL in preloadSingleImage:', error);
        resolve(); // Resolve even on error to not block other images
      }
    };
    img.src = imageUrl;
  });
};

const preloadBatch = async (nfts: NFT[], imageMap: Map<string, HTMLImageElement> = new Map()) => {
  await Promise.all(nfts.map(nft => preloadSingleImage(nft, imageMap)));
  return imageMap;
};

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useNFTPreloader = (nfts: NFT[]) => {
  const [preloadedImages, setPreloadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [networkType, setNetworkType] = useState<'4g' | '3g' | 'slow-3g'>('4g');
  const [loadedCount, setLoadedCount] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageMapRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Determine batch size based on network speed
  const batchSize = networkType === '4g' ? 6 : 3;

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
    if (loadedCount >= nfts.length) return;
    
    const nextBatch = nfts.slice(loadedCount, loadedCount + batchSize);
    const updatedMap = await preloadBatch(nextBatch, imageMapRef.current);
    imageMapRef.current = updatedMap;
    setPreloadedImages(new Map(updatedMap));
    setLoadedCount(prev => prev + batchSize);
  }, [loadedCount, nfts, batchSize]);

  // Initialize Intersection Observer
  useEffect(() => {
    if (!containerRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreOnScroll();
        }
      },
      { threshold: 0.5 }
    );

    observerRef.current.observe(containerRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadMoreOnScroll]);

  // Preload initial batch
  useEffect(() => {
    const preloadInitialBatch = async () => {
      setIsLoading(true);
      const initialBatch = nfts.slice(0, batchSize);
      
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
  }, [nfts, batchSize]);

  const getPreloadedImage = (nft: NFT): HTMLImageElement | undefined => {
    const key = generateMediaKey(nft);
    return preloadedImages.get(key);
  };

  const preloadImage = useCallback((nft: NFT) => {
    // Get the image URL
    let nftImageUrl = nft.image || nft.metadata?.image;
    if (!nftImageUrl) return;
    
    // Process the URL to handle special protocols
    try {
      // Safely check if this is an Arweave URL
      if (typeof nftImageUrl === 'string' && nftImageUrl.startsWith('ar://')) {
        // Special handling for Arweave URLs
        nftImageUrl = processArweaveUrl(nftImageUrl);
        console.log('Processed Arweave URL for preloading in preloadImage:', nftImageUrl);
      } else {
        // Process other URL types
        nftImageUrl = processMediaUrl(nftImageUrl);
      }
    } catch (error) {
      console.error('Error processing image URL in preloadImage:', error);
      nftImageUrl = '/default-nft.png';
    }
    
    // Create a key for this NFT
    const key = `${nft.contract}-${nft.tokenId}`;
    
    // Skip if already preloaded
    if (preloadedImages.has(key)) return;
    
    // Create a new image element
    const img = new Image();
    
    // Set the source to preload
    img.src = nftImageUrl;
    
    // Store the preloaded image
    img.onload = () => {
      setPreloadedImages(prev => {
        const newMap = new Map(prev);
        newMap.set(key, img);
        return newMap;
      });
    };
    
    img.onerror = (error) => {
      console.warn('Failed to preload image in preloadImage for NFT:', nft.name, error);
      // Try a fallback for Arweave URLs
      try {
        const isArweaveNet = typeof nftImageUrl === 'string' && new URL(nftImageUrl).hostname === 'arweave.net';
        const hasArProtocol = typeof nft.metadata?.image === 'string' && nft.metadata.image.startsWith('ar://');
        
        if (isArweaveNet && hasArProtocol) {
          const fallbackUrl = `/default-nft.png`;
          console.log('Using fallback for failed Arweave image in preloadImage:', fallbackUrl);
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            setPreloadedImages(prev => {
              const newMap = new Map(prev);
              newMap.set(key, fallbackImg);
              return newMap;
            });
          };
          fallbackImg.src = fallbackUrl;
        }
      } catch (error) {
        console.error('Error checking Arweave URL in preloadImage:', error);
      }
    };
  }, [preloadedImages]);

  return {
    isLoading,
    getPreloadedImage,
    preloadedImages,
    preloadImage
  };
};
