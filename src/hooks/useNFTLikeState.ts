import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { isPlaybackActive } from '../utils/media';
import { v4 as uuidv4 } from 'uuid';

// Create a logger specifically for like state management with playback awareness
const likeStateLogger = {
  debug: (message: string, ...args: any[]) => {
    if (!isPlaybackActive()) {
      console.debug(`[LikeState] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    if (!isPlaybackActive()) {
      console.info(`[LikeState] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => console.warn(`[LikeState] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[LikeState] ${message}`, ...args),
};

// Cache to prevent duplicate listeners for the same NFT/user combination
const activeListeners = new Map<string, number>();

// Generate a unique, random media key for each NFT
const generateMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useNFTLikeState = (nft: NFT | null, fid: number) => {
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  
  // Track the mediaKey to help with debugging
  const mediaKeyRef = useRef<string>('');
  
  // Track subscription status
  const isSubscribedRef = useRef<boolean>(false);
  
  // Create a cache key for this NFT/user combination
  const cacheKeyRef = useRef<string>('');

  useEffect(() => {
    if (!nft || !fid) {
      setIsLiked(false);
      setLikesCount(0);
      setIsLoading(false);
      isSubscribedRef.current = false;
      return;
    }
    
    const mediaKey = generateMediaKey(nft);
    mediaKeyRef.current = mediaKey;
    
    // Create a cache key for this NFT/user combination
    const cacheKey = `${mediaKey}-${fid}`;
    cacheKeyRef.current = cacheKey;
    
    // Check if we already have an active listener for this NFT/user combination
    const listenerCount = activeListeners.get(cacheKey) || 0;
    activeListeners.set(cacheKey, listenerCount + 1);
    
    // Only log for the first instance of this NFT/user combination
    if (listenerCount === 0 && process.env.NODE_ENV === 'development' && !isPlaybackActive()) {
      likeStateLogger.info('Setting up like state listeners for:', { 
        nftName: nft.name, 
        mediaKey,
        fid
      });
    }
    
    // Set up Firestore listeners
    const db = getFirestore();
    
    // Listen for user's like state
    const userLikeRef = doc(db, 'likes', `${fid}`);
    const userLikeUnsubscribe = onSnapshot(userLikeRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        const likedMediaKeys = data.likedMediaKeys || [];
        setIsLiked(likedMediaKeys.includes(mediaKey));
      } else {
        setIsLiked(false);
      }
      setIsLoading(false);
      setLastUpdated(Date.now());
    });
    
    // Listen for global likes count
    const likesRef = doc(db, 'likes', mediaKey);
    const likesUnsubscribe = onSnapshot(likesRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setLikesCount(data.count || 0);
      } else {
        setLikesCount(0);
      }
    });
    
    isSubscribedRef.current = true;
    
    // Cleanup function
    return () => {
      userLikeUnsubscribe();
      likesUnsubscribe();
      
      // Decrement listener count
      const currentCount = activeListeners.get(cacheKey) || 0;
      if (currentCount > 1) {
        activeListeners.set(cacheKey, currentCount - 1);
      } else {
        activeListeners.delete(cacheKey);
      }
      
      isSubscribedRef.current = false;
    };
  }, [nft, fid]);

  // Toggle like state
  const toggleLike = async () => {
    if (!nft || !fid || !mediaKeyRef.current) return;
    
    const db = getFirestore();
    const userLikeRef = doc(db, 'likes', `${fid}`);
    const likesRef = doc(db, 'likes', mediaKeyRef.current);
    
    try {
      // Get current user's like state
      const userLikeDoc = await getDoc(userLikeRef);
      const userLikeData = userLikeDoc.exists() ? userLikeDoc.data() : { likedMediaKeys: [] };
      const likedMediaKeys = userLikeData.likedMediaKeys || [];
      
      // Get current global likes count
      const likesDoc = await getDoc(likesRef);
      const likesData = likesDoc.exists() ? likesDoc.data() : { count: 0 };
      const currentCount = likesData.count || 0;
      
      // Toggle like state
      const newIsLiked = !likedMediaKeys.includes(mediaKeyRef.current);
      
      // Update user's like state
      await setDoc(userLikeRef, {
        likedMediaKeys: newIsLiked
          ? [...likedMediaKeys, mediaKeyRef.current]
          : likedMediaKeys.filter(key => key !== mediaKeyRef.current)
      });
      
      // Update global likes count
      await setDoc(likesRef, {
        count: newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1)
      });
      
      // Update local state
      setIsLiked(newIsLiked);
      setLikesCount(newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1));
      
      // Dispatch custom event for other components
      const event = new CustomEvent('nftLikeStateChange', {
        detail: {
          mediaKey: mediaKeyRef.current,
          isLiked: newIsLiked,
          nft
        }
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      likeStateLogger.error('Error toggling like state:', error);
    }
  };

  return {
    isLiked,
    likesCount,
    isLoading,
    lastUpdated,
    mediaKey: mediaKeyRef.current,
    isSubscribed: isSubscribedRef.current,
    toggleLike
  };
};
