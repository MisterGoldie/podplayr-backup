import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, onSnapshot } from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { getMediaKey } from '../utils/media';
import { likesDebug } from '../utils/likesDebug';
import { findExistingUserLikeIds, mergeLegacyLikeCounts } from '../lib/consolidateUserLikes';

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
  const nftRef = useRef(nft);
  nftRef.current = nft;
  const previousCountRef = useRef<number>(0);

  const mediaKey = nft ? getMediaKey(nft) : '';

  useEffect(() => {
    if (!nft || !mediaKey) {
      setIsLiked(false);
      setLikesCount(0);
      setIsLoading(false);
      isSubscribedRef.current = false;
      return;
    }

    mediaKeyRef.current = mediaKey;
    previousCountRef.current = 0;
    setIsLoading(true);
    if (watchCount) {
      likesDebug.log('useNFTLikeState subscribe', {
        mediaKey,
        fid,
        watchIsLiked,
        liveCount,
        watchCount,
        name: nft.name,
        contract: nft.contract,
        tokenId: nft.tokenId,
        alreadyMerged: false,
      });
    }

    const db = getFirestore();
    let cancelled = false;
    let unsubscribeUserLike: Unsubscribe | null = null;
    let unsubscribeCount: Unsubscribe | null = null;

    const listen = () => {
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
            likesDebug.error('user like listener failed', error, { fid, mediaKey });
            if (!cancelled && !watchCount) setIsLoading(false);
          }
        );
      }

      const globalLikeRef = doc(db, 'global_likes', mediaKey);
      if (watchCount) {
        if (liveCount) {
          unsubscribeCount = onSnapshot(globalLikeRef, (snap) => {
            if (cancelled) return;
            const next = snap.exists() ? snap.data()?.likeCount || 0 : 0;
            likesDebug.log('global_likes snapshot', {
              path: globalLikeRef.path,
              exists: snap.exists(),
              fromCache: snap.metadata.fromCache,
              hasPendingWrites: snap.metadata.hasPendingWrites,
              likeCount: snap.exists() ? snap.data()?.likeCount : null,
              previous: previousCountRef.current,
            });
            if (snap.metadata.fromCache && !snap.exists()) return;
            if (!snap.exists()) {
              if (previousCountRef.current > 0) {
                likesDebug.log('global_likes missing — keeping recovered count', {
                  previous: previousCountRef.current,
                });
                return;
              }
              setLikesCount(0);
              setIsLoading(false);
              return;
            }
            if (snap.metadata.fromCache && next < previousCountRef.current) {
              likesDebug.log('global_likes cache stale — ignoring lower count', {
                next,
                previous: previousCountRef.current,
              });
              return;
            }
            previousCountRef.current = Math.max(previousCountRef.current, next);
            setLikesCount(previousCountRef.current);
            setIsLoading(false);
          }, (error) => {
            likesDebug.error('global_likes listener failed', error, { mediaKey });
          });
        } else {
          getDoc(globalLikeRef).then((snap) => {
            if (cancelled) return;
            likesDebug.log('global_likes getDoc', {
              path: globalLikeRef.path,
              exists: snap.exists(),
              likeCount: snap.exists() ? snap.data()?.likeCount : null,
            });
            setLikesCount(snap.exists() ? (snap.data()?.likeCount || 0) : 0);
            setIsLoading(false);
          }).catch((error) => {
            likesDebug.error('global_likes getDoc failed', error, { mediaKey });
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

    listen();

    void (async () => {
      try {
        if (watchCount && nftRef.current) {
          likesDebug.log('mergeLegacyLikeCounts start', { mediaKey });
          const folded = await mergeLegacyLikeCounts(db, nftRef.current, mediaKey);
          likesDebug.log('mergeLegacyLikeCounts done', { mediaKey, folded, cancelled });
          if (!cancelled && folded > 0) {
            previousCountRef.current = Math.max(previousCountRef.current, folded);
            setLikesCount(previousCountRef.current);
          }
        }
        if (watchIsLiked && fid && nftRef.current) {
          const existing = await findExistingUserLikeIds(db, String(fid), nftRef.current);
          if (!cancelled && existing.length > 0) {
            setIsLiked(true);
          }
        }
      } catch (error) {
        likesDebug.error('Error folding leftover like counts', error, { mediaKey });
      }
    })();

    isSubscribedRef.current = true;

    return () => {
      cancelled = true;
      unsubscribeUserLike?.();
      unsubscribeCount?.();
      isSubscribedRef.current = false;
    };
  }, [mediaKey, fid, watchIsLiked, liveCount, watchCount]);

  const toggleLike = async () => {
    if (!nft || !fid || !mediaKeyRef.current) return;

    const previousLiked = isLiked;
    const optimisticLiked = !previousLiked;
    setIsLiked(optimisticLiked);
    setLikesCount((prev) => Math.max(0, prev + (optimisticLiked ? 1 : -1)));
    setLastUpdated(Date.now());

    try {
      const { toggleLikeNFT } = await import('../lib/firebase/likes');
      const newIsLiked = await toggleLikeNFT(nft, fid);
      setIsLiked(newIsLiked);
      if (newIsLiked !== optimisticLiked) {
        setLikesCount((prev) => Math.max(0, prev + (newIsLiked ? 1 : -1)));
      }
      setLastUpdated(Date.now());
      return newIsLiked;
    } catch (error) {
      setIsLiked(previousLiked);
      setLikesCount((prev) => Math.max(0, prev + (previousLiked ? 1 : -1)));
      likesDebug.error('Error toggling like state', error, { mediaKey: mediaKeyRef.current, fid });
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
