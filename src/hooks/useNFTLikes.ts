import { useState, useEffect } from 'react';
import { getFirestore, doc, onSnapshot, DocumentSnapshot } from 'firebase/firestore';
import type { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

export const useNFTLikes = (nft: NFT | null) => {
  const [likesCount, setLikesCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!nft) {
      setLikesCount(0);
      setIsLoading(false);
      return;
    }

    const mediaKey = getMediaKey(nft);
    const db = getFirestore();
    const globalLikeRef = doc(db, 'global_likes', mediaKey);

    // Set up real-time listener for global like count
    const unsubscribe = onSnapshot(globalLikeRef,
      (snapshot: DocumentSnapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setLikesCount(data?.likeCount || 0);
        } else {
          setLikesCount(0);
        }
        setIsLoading(false);
      },
      (error: Error) => {
        console.error('Error listening to likes:', error);
        setLikesCount(0);
        setIsLoading(false);
      }
    );

    // Cleanup listener when component unmounts or NFT changes
    return () => unsubscribe();
  }, [nft]);

  return { likesCount, isLoading };
};
