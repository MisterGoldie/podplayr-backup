import { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Create a dedicated logger for this module
const playCountLogger = logger.getModuleLogger('playCount');

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useNFTPlayCount = (nft: NFT | null, shouldFetch: boolean = true) => {
  const [playCount, setPlayCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [realCountIncrease, setRealCountIncrease] = useState(false);
  const previousCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);

  // Reset the initial load flag when NFT changes
  useEffect(() => {
    // We need to reset this for each NFT change to avoid immediate animation
    isInitialLoadRef.current = true;
    previousCountRef.current = 0; // Reset this too for clean state
  }, [nft?.contract, nft?.tokenId]);

  useEffect(() => {
    // Skip Firebase connection if we shouldn't fetch yet
    if (!shouldFetch || !nft) {
      setPlayCount(0);
      setLoading(false);
      return;
    }

    // Generate mediaKey for content-based tracking
    const mediaKey = getMediaKey(nft);
    if (!mediaKey) {
      playCountLogger.error('Could not generate mediaKey for NFT:', nft);
      setPlayCount(0);
      setLoading(false);
      return;
    }

    const db = getFirestore();
    const globalPlayRef = doc(db, 'global_plays', mediaKey);

    playCountLogger.debug('Listening for play count with mediaKey:', { mediaKey, nft });

    // Set up real-time listener for global play count
    const unsubscribe = onSnapshot(globalPlayRef,
      (snapshot: DocumentSnapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const newCount = data?.playCount || 0;
          
          // Check if this is a real count increase from Firebase
          // This will only happen when the 25% threshold is reached
          // Don't trigger animation on initial load
          if (newCount > previousCountRef.current && !isInitialLoadRef.current) {
            playCountLogger.debug('REAL PLAY COUNT INCREASE:', { 
              mediaKey, 
              oldCount: previousCountRef.current, 
              newCount,
              isInitialLoad: isInitialLoadRef.current
            });
            setRealCountIncrease(true);
            
            // Reset the animation flag after a short delay
            setTimeout(() => {
              setRealCountIncrease(false);
            }, 2000); // slightly longer than animation duration
          }
          
          // After first load, set initial load flag to false
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
          }
          
          // Update previous count reference
          previousCountRef.current = newCount;
          
          // Update the state
          setPlayCount(newCount);
          playCountLogger.debug('Updated play count:', { mediaKey, count: newCount });
        } else {
          setPlayCount(0);
          previousCountRef.current = 0;
          playCountLogger.debug('No play count found for:', { mediaKey });
        }
        setLoading(false);
      },
      (error: Error) => {
        playCountLogger.error('Error listening to play count:', error);
        setPlayCount(0);
        setLoading(false);
      }
    );

    // Cleanup listener when component unmounts or NFT changes
    return () => {
      playCountLogger.debug('Cleaning up play count listener for:', mediaKey);
      unsubscribe();
    };
  }, [nft, shouldFetch]);

  return { playCount, loading, realCountIncrease };
};