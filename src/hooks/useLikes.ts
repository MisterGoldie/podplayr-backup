import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Define a type for our likes record to avoid TypeScript errors
type LikesRecord = { [mediaKey: string]: boolean };

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

/**
 * Hook for managing NFT like state using mediaKey-based tracking
 * This ensures likes are consistent across all instances of the same content
 */
export const useLikes = (userFid: number) => {
  // Use our defined type for the likes state
  const [likedMediaKeys, setLikedMediaKeys] = useState<LikesRecord>({});
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load liked media keys from localStorage on mount
  useEffect(() => {
    try {
      const savedLikes = localStorage.getItem('podplayr_liked_media_keys');
      if (savedLikes) {
        const mediaKeys = JSON.parse(savedLikes) as string[];
        const likeMap: Record<string, boolean> = {};
        
        mediaKeys.forEach(key => {
          likeMap[key] = true;
        });
        
        setLikedMediaKeys(likeMap);
        logger.info(`Loaded ${mediaKeys.length} liked media keys from localStorage`);
      }
    } catch (error) {
      logger.error('Error loading liked NFTs from localStorage:', error);
    }
  }, []);

  // Protect the like state from being accidentally reset
  useEffect(() => {
    // EMERGENCY FIX: Block any attempts to reset liked status after initial load
    const originalSetLikedMediaKeys = setLikedMediaKeys;
    
    // Override the state setter to prevent certain updates
    const protectedSetLikedMediaKeys: typeof setLikedMediaKeys = (newValueOrUpdater) => {
      // If it's a function updater, let it through
      if (typeof newValueOrUpdater === 'function') {
        originalSetLikedMediaKeys(newValueOrUpdater);
        return;
      }
      
      // If direct value, only allow additions, never removals
      originalSetLikedMediaKeys(prevLikes => {
        // Create merged state that preserves all existing likes
        const mergedState: LikesRecord = { ...prevLikes };
        
        // Only add new likes, never remove existing ones
        Object.entries(newValueOrUpdater as LikesRecord).forEach(([key, isLiked]) => {
          if (isLiked === true) {
            mergedState[key] = true;
          }
          // Ignore false values - don't allow unlikes through this path
        });
        
        return mergedState;
      });
    };
    
    // @ts-ignore - Replace the setter with our protected version
    setLikedMediaKeys = protectedSetLikedMediaKeys;
  }, []);

  // Fetch liked NFTs from Firebase
  const fetchLikedNfts = useCallback(async () => {
    if (!userFid) return;
    
    setIsLoading(true);
    
    try {
      // CRITICAL: Use the users/{fid}/likes collection which is organized by mediaKey
      const likesCollection = collection(db, 'users', userFid.toString(), 'likes');
      const snapshot = await getDocs(likesCollection);
      
      const fetchedLikes: LikesRecord = {};
      
      snapshot.docs.forEach((doc) => {
        // The document ID is the mediaKey
        const mediaKey = doc.id;
        fetchedLikes[mediaKey] = true;
      });
      
      setLikedMediaKeys(prevLikes => {
        const mergedLikes: LikesRecord = { ...prevLikes, ...fetchedLikes };
        
        // Save to localStorage
        const mediaKeys = Object.keys(mergedLikes).filter(key => mergedLikes[key] === true);
        localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
        
        return mergedLikes;
      });
      
      setIsInitialLoadComplete(true);
      logger.info(`Fetched ${Object.keys(fetchedLikes).length} liked NFTs for user ${userFid}`);
    } catch (error) {
      logger.error('Error fetching liked NFTs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userFid]);

  // Check if an NFT is liked based on its mediaKey
  const isNFTLiked = useCallback((nft: NFT): boolean => {
    if (!nft) return false;
    
    // CRITICAL: Use mediaKey for content-based tracking
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return false;
    
    return mediaKey in likedMediaKeys && likedMediaKeys[mediaKey] === true;
  }, [likedMediaKeys]);

  // Add a like for an NFT
  const addLike = useCallback((nft: NFT) => {
    if (!nft) return;
    
    // CRITICAL: Use mediaKey for content-based tracking
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return;
    
    setLikedMediaKeys(prev => {
      const updated: LikesRecord = { ...prev, [mediaKey]: true };
      
      // Save to localStorage
      const mediaKeys = Object.keys(updated).filter(key => updated[key] === true);
      localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
      
      return updated;
    });
  }, []);

  // Remove a like for an NFT
  const removeLike = useCallback((nft: NFT) => {
    if (!nft) return;
    
    // CRITICAL: Use mediaKey for content-based tracking
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return;
    
    setLikedMediaKeys(prev => {
      const updated: LikesRecord = { ...prev };
      delete updated[mediaKey];
      
      // Save to localStorage
      const mediaKeys = Object.keys(updated).filter(key => updated[key] === true);
      localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
      
      return updated;
    });
  }, []);

  // Load liked NFTs when userFid changes
  useEffect(() => {
    if (userFid) {
      fetchLikedNfts();
    }
  }, [userFid, fetchLikedNfts]);

  return {
    likedMediaKeys,
    isNFTLiked,
    addLike,
    removeLike,
    isLoading,
    isInitialLoadComplete,
    fetchLikedNfts
  };
};