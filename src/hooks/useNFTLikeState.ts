import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { isPlaybackActive, getMediaKey } from '../utils/media';
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

// Shared per-fid subscription to `likes/{fid}` — every NFTCard for the same user
// used to open its own onSnapshot on this exact document. A grid of N cards
// means N redundant live connections to identical data. Instead, share one
// listener per fid and fan its updates out to every subscriber.
interface FidLikesEntry {
  unsubscribe: Unsubscribe;
  likedMediaKeys: Set<string>;
  subscribers: Set<(keys: Set<string>) => void>;
}
const fidLikesRegistry = new Map<number, FidLikesEntry>();

const subscribeToFidLikes = (fid: number, onUpdate: (keys: Set<string>) => void): (() => void) => {
  let entry = fidLikesRegistry.get(fid);
  if (!entry) {
    const db = getFirestore();
    const likedMediaKeys = new Set<string>();
    const subscribers = new Set<(keys: Set<string>) => void>();
    const unsubscribe = onSnapshot(doc(db, 'likes', `${fid}`), (snap) => {
      likedMediaKeys.clear();
      if (snap.exists()) {
        const data = snap.data();
        (data.likedMediaKeys || []).forEach((k: string) => likedMediaKeys.add(k));
      }
      subscribers.forEach((cb) => cb(likedMediaKeys));
    });
    entry = { unsubscribe, likedMediaKeys, subscribers };
    fidLikesRegistry.set(fid, entry);
  }
  entry.subscribers.add(onUpdate);
  // Deliver current known state immediately (covers late subscribers joining after the first snapshot).
  onUpdate(entry.likedMediaKeys);

  return () => {
    const current = fidLikesRegistry.get(fid);
    if (!current) return;
    current.subscribers.delete(onUpdate);
    if (current.subscribers.size === 0) {
      current.unsubscribe();
      fidLikesRegistry.delete(fid);
    }
  };
};

export interface UseNFTLikeStateOptions {
  /** Subscribe to the user's own like state for this NFT. Skip when the caller
   * already tracks/derives `isLiked` itself (e.g. via an `isNFTLiked` prop) to
   * avoid opening a redundant shared-listener subscription per card. Default true. */
  watchIsLiked?: boolean;
  /** Keep the global like count live via onSnapshot. Grids with many cards should
   * pass false to do a single one-time read instead of N concurrent listeners,
   * since live-updating like counts while browsing a grid isn't critical UX.
   * Default true. */
  liveCount?: boolean;
}

// Generate a unique, random media key for each NFT
// Remove the custom generateMediaKey function and use the centralized one
// const generateMediaKey = (nft: NFT): string => {
//   return uuidv4();
// };

export const useNFTLikeState = (
  nft: NFT | null,
  fid: number | null,
  options?: UseNFTLikeStateOptions
) => {
  const watchIsLiked = options?.watchIsLiked ?? true;
  const liveCount = options?.liveCount ?? true;
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
    
    const mediaKey = getMediaKey(nft);
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
    
    const db = getFirestore();
    let cancelled = false;

    // User's own like state — shared per-fid listener (see subscribeToFidLikes)
    // instead of one onSnapshot per card, since every card for the same user
    // reads the exact same `likes/{fid}` document.
    let unsubscribeFidLikes: (() => void) | null = null;
    if (watchIsLiked) {
      unsubscribeFidLikes = subscribeToFidLikes(fid, (likedMediaKeys) => {
        setIsLiked(likedMediaKeys.has(mediaKey));
        setIsLoading(false);
        setLastUpdated(Date.now());
      });
    } else {
      setIsLoading(false);
    }

    // Global likes count — one-time read by default. Grids can have dozens of
    // cards on screen at once; keeping this live per-card multiplies concurrent
    // Firestore connections for a count that doesn't need to update in real time.
    const likesRef = doc(db, 'likes', mediaKey);
    let unsubscribeCount: Unsubscribe | null = null;
    if (liveCount) {
      unsubscribeCount = onSnapshot(likesRef, (doc) => {
        setLikesCount(doc.exists() ? (doc.data().count || 0) : 0);
      });
    } else {
      getDoc(likesRef).then((snap) => {
        if (cancelled) return;
        setLikesCount(snap.exists() ? (snap.data().count || 0) : 0);
      }).catch(() => {
        if (!cancelled) setLikesCount(0);
      });
    }
    
    isSubscribedRef.current = true;
    
    // Cleanup function
    return () => {
      cancelled = true;
      unsubscribeFidLikes?.();
      unsubscribeCount?.();
      
      // Decrement listener count
      const currentCount = activeListeners.get(cacheKey) || 0;
      if (currentCount > 1) {
        activeListeners.set(cacheKey, currentCount - 1);
      } else {
        activeListeners.delete(cacheKey);
      }
      
      isSubscribedRef.current = false;
    };
  }, [nft, fid, watchIsLiked, liveCount]);

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
          : likedMediaKeys.filter((key: string) => key !== mediaKeyRef.current)
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
//