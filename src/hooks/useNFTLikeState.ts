import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, onSnapshot } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { isPlaybackActive, getMediaKey } from '../utils/media';
import { findExistingUserLikeIds, mergeLegacyLikeCounts } from '../lib/consolidateUserLikes';

const mergedLikeKeys = new Set<string>();

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

export interface UseNFTLikeStateOptions {
  /** Subscribe to the user's own like state for this NFT. Skip when the caller
   * already tracks/derives `isLiked` itself (e.g. via an `isNFTLiked` prop) to
   * avoid opening a redundant listener per card. Default true. */
  watchIsLiked?: boolean;
  /** Keep the global like count live via onSnapshot. Grids with many cards should
   * pass false to do a single one-time read instead of N concurrent listeners.
   * Default true. Ignored when watchCount is false. */
  liveCount?: boolean;
  /** Fetch the global like count. Pass false when the caller does not display it.
   * Default true. */
  watchCount?: boolean;
}

export const useNFTLikeState = (
  nft: NFT | null,
  fid: number | null,
  options?: UseNFTLikeStateOptions
) => {
  const watchIsLiked = options?.watchIsLiked ?? true;
  const liveCount = options?.liveCount ?? true;
  const watchCount = options?.watchCount ?? true;
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  const mediaKeyRef = useRef<string>('');
  const isSubscribedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!nft) {
      setIsLiked(false);
      setLikesCount(0);
      setIsLoading(false);
      isSubscribedRef.current = false;
      return;
    }

    const mediaKey = getMediaKey(nft);
    mediaKeyRef.current = mediaKey;
    setIsLoading(true);

    const db = getFirestore();
    let cancelled = false;
    let unsubscribeUserLike: Unsubscribe | null = null;
    let unsubscribeCount: Unsubscribe | null = null;

    const listen = (foldedCount?: number) => {
      if (cancelled) return;

      if (watchIsLiked && fid) {
        unsubscribeUserLike = onSnapshot(
          doc(db, 'users', String(fid), 'likes', mediaKey),
          (snap) => {
            if (cancelled) return;
            setIsLiked(snap.exists());
            if (!watchCount) setIsLoading(false);
            setLastUpdated(Date.now());
          },
          (error) => {
            likeStateLogger.error('User like listener failed:', error);
            if (!cancelled && !watchCount) setIsLoading(false);
          }
        );
      }

      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      if (watchCount) {
        if (typeof foldedCount === 'number' && foldedCount > 0) {
          setLikesCount(foldedCount);
        }
        if (liveCount) {
          unsubscribeCount = onSnapshot(globalLikeRef, (snap) => {
            if (cancelled) return;
            setLikesCount(snap.exists() ? (snap.data()?.likeCount || 0) : 0);
            setIsLoading(false);
          });
        } else {
          getDoc(globalLikeRef).then((snap) => {
            if (cancelled) return;
            setLikesCount(snap.exists() ? (snap.data()?.likeCount || 0) : 0);
            setIsLoading(false);
          }).catch(() => {
            if (!cancelled) {
              setLikesCount(0);
              setIsLoading(false);
            }
          });
        }
      } else if (!watchIsLiked) {
        setIsLoading(false);
      }
    };

    void (async () => {
      let folded = 0;
      try {
        if (watchCount && !mergedLikeKeys.has(mediaKey)) {
          mergedLikeKeys.add(mediaKey);
          try {
            folded = await mergeLegacyLikeCounts(db, nft, mediaKey);
          } catch (error) {
            mergedLikeKeys.delete(mediaKey);
            throw error;
          }
        }
        if (watchIsLiked && fid) {
          const existing = await findExistingUserLikeIds(db, String(fid), nft);
          if (!cancelled && existing.length > 0) {
            setIsLiked(true);
          }
        }
      } catch (error) {
        likeStateLogger.error('Error folding leftover like counts:', error);
      }
      listen(folded);
    })();

    isSubscribedRef.current = true;

    return () => {
      cancelled = true;
      unsubscribeUserLike?.();
      unsubscribeCount?.();
      isSubscribedRef.current = false;
    };
  }, [nft, fid, watchIsLiked, liveCount, watchCount]);

  const toggleLike = async () => {
    if (!nft || !fid || !mediaKeyRef.current) return;

    try {
      const { toggleLikeNFT } = await import('../lib/firebase/likes');
      const newIsLiked = await toggleLikeNFT(nft, fid);
      setIsLiked(newIsLiked);
      setLikesCount((prev) => Math.max(0, prev + (newIsLiked ? 1 : -1)));
      setLastUpdated(Date.now());
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
