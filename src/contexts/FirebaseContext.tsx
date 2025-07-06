import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { NFT } from '../types/user';
import { logger } from '../utils/logger';

// Create a dedicated logger for this context
const firebaseContextLogger = logger.getModuleLogger('FirebaseContext');

interface FirebaseContextType {
  recentSearches: any[];
  featuredNFTs: NFT[];
  isLoading: boolean;
  error: Error | null;
  followerCount: number;
}

const FirebaseContext = createContext<FirebaseContextType | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [featuredNFTs, setFeaturedNFTs] = useState<NFT[]>([]);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Set up all Firebase listeners
  useEffect(() => {
    firebaseContextLogger.info('Setting up Firebase listeners');

    // Recent searches listener
    const recentSearchesQuery = query(
      collection(db, 'recentSearches'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsubscribeRecentSearches = onSnapshot(
      recentSearchesQuery,
      (snapshot) => {
        const searches = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        firebaseContextLogger.info(`Fetched ${searches.length} recent searches`);
        setRecentSearches(searches);
      },
      (error) => {
        firebaseContextLogger.error('Error fetching recent searches:', error);
        setError(error);
      }
    );

    // Featured NFTs listener
    const featuredNFTsUnsubscribe = onSnapshot(
      collection(db, 'featuredNFTs'),
      (snapshot) => {
        const featured = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            contract: data.contract || '',
            tokenId: data.tokenId || '',
            name: data.name || '',
            image: data.image || '',
            ...data
          } as NFT;
        });
        setFeaturedNFTs(featured);
      },
      (error) => {
        console.error('Error fetching featured NFTs:', error);
      }
    );

    // Follower count listener
    const followerCountQuery = query(
      collection(db, 'users'),
      where('isFollower', '==', true)
    );

    const unsubscribeFollowerCount = onSnapshot(
      followerCountQuery,
      (snapshot) => {
        const count = snapshot.size;
        firebaseContextLogger.info(`Updated follower count: ${count}`);
        setFollowerCount(count);
        setIsLoading(false);
      },
      (error) => {
        firebaseContextLogger.error('Error fetching follower count:', error);
        setError(error);
      }
    );

    // Cleanup function
    return () => {
      firebaseContextLogger.info('Cleaning up Firebase listeners');
      unsubscribeRecentSearches();
      featuredNFTsUnsubscribe();
      unsubscribeFollowerCount();
    };
  }, []);

  const value = {
    recentSearches,
    featuredNFTs,
    followerCount,
    isLoading,
    error
  };

  return (
    <FirebaseContext.Provider value={value}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}; 