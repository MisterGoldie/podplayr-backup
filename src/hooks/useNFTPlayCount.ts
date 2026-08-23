import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { logger } from '../utils/logger';
import { getMediaKey } from '../utils/media';
import { mergeLegacyPlayCounts } from '../lib/consolidateGlobalPlays';

const playCountLogger = logger.getModuleLogger('playCount');
const mergedPlayKeys = new Set<string>();

export const useNFTPlayCount = (nft: NFT | null, shouldFetch: boolean = true) => {
  const [playCount, setPlayCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [realCountIncrease, setRealCountIncrease] = useState(false);
  const previousCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);
  const nftRef = useRef(nft);
  nftRef.current = nft;

  const mediaKey =
    shouldFetch && nft?.contract && nft.tokenId !== undefined && nft.tokenId !== null && String(nft.tokenId) !== ''
      ? getMediaKey(nft)
      : '';

  useEffect(() => {
    if (!shouldFetch || !mediaKey) {
      setPlayCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    isInitialLoadRef.current = true;
    previousCountRef.current = 0;

    const db = getFirestore();
    const globalPlayRef = doc(db, 'global_plays', mediaKey);
    let cancelled = false;
    let unsubscribe = () => {};

    const applySnapshot = (snapshot: DocumentSnapshot) => {
      if (cancelled) return;
      // An empty cache hit is not "0 plays". Wait for the server (or a cached doc).
      if (snapshot.metadata.fromCache && !snapshot.exists()) {
        return;
      }

      const newCount = snapshot.exists() ? (snapshot.data()?.playCount || 0) : 0;

      if (newCount > previousCountRef.current && !isInitialLoadRef.current) {
        playCountLogger.debug('REAL PLAY COUNT INCREASE:', {
          mediaKey,
          oldCount: previousCountRef.current,
          newCount,
        });
        setRealCountIncrease(true);
        setTimeout(() => {
          setRealCountIncrease(false);
        }, 2000);
      }

      isInitialLoadRef.current = false;
      previousCountRef.current = newCount;
      setPlayCount(newCount);
      setLoading(false);
    };

    const listen = () => {
      if (cancelled) return;
      playCountLogger.debug('Listening for play count with mediaKey:', { mediaKey });

      getDoc(globalPlayRef)
        .then(applySnapshot)
        .catch((error: Error) => {
          if (cancelled) return;
          playCountLogger.error('Error fetching play count:', error);
          setPlayCount(0);
          setLoading(false);
        });

      unsubscribe = onSnapshot(
        globalPlayRef,
        applySnapshot,
        (error: Error) => {
          if (cancelled) return;
          playCountLogger.error('Error listening to play count:', error);
          setPlayCount(0);
          setLoading(false);
        }
      );
    };

    const foldThenListen = async () => {
      const source = nftRef.current;
      if (source && !mergedPlayKeys.has(mediaKey)) {
        mergedPlayKeys.add(mediaKey);
        try {
          await mergeLegacyPlayCounts(db, source, mediaKey);
        } catch (error) {
          mergedPlayKeys.delete(mediaKey);
          playCountLogger.error('Error folding leftover play counts:', error);
        }
      }
      listen();
    };

    void foldThenListen();

    return () => {
      cancelled = true;
      playCountLogger.debug('Cleaning up play count listener for:', mediaKey);
      unsubscribe();
    };
  }, [mediaKey, shouldFetch]);

  return { playCount, loading, realCountIncrease };
};
