'use client';

import { useEffect, useCallback, useRef } from 'react';
import { searchUsers } from '../../lib/firebase';
import { getLikedNFTs, subscribeToLikedNFTs } from '../../lib/firebase/likes';
import { fetchUserNFTsFromAlchemy } from '../../lib/alchemy';
import { getMediaKey } from '../../utils/media';
import type { NFT, FarcasterUser } from '../../types/user';

const NFT_CACHE_KEY = 'podplayr_nft_cache_';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// Use sessionStorage instead of module-level Map for persistence across component mounts
const SESSION_CACHE_KEY = 'podplayr_user_data_session_cache';
const SESSION_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CachedUserData {
  userData: FarcasterUser;
  nfts: NFT[];
  likedNFTs: NFT[];
  timestamp: number;
}

interface UserDataLoaderProps {
  userFid: number;
  onUserDataLoaded?: (userData: FarcasterUser) => void;
  onNFTsLoaded?: (nfts: NFT[]) => void;
  onLikedNFTsLoaded?: (nfts: NFT[]) => void;
  onError?: (error: string) => void;
}

const getSessionCache = (): Map<number, CachedUserData> => {
  try {
    const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      return new Map(Object.entries(data).map(([key, value]) => [parseInt(key), value as CachedUserData]));
    }
  } catch (error) {
    console.error('Error reading session cache:', error);
  }
  return new Map();
};

const setSessionCache = (cache: Map<number, CachedUserData>) => {
  try {
    const data = Object.fromEntries(cache.entries());
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error writing session cache:', error);
  }
};

const getCachedNFTs = (userId: number): NFT[] | null => {
  const cached = localStorage.getItem(`${NFT_CACHE_KEY}${userId}`);
  if (cached) {
    const { nfts, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < TWENTY_FOUR_HOURS) {
      return nfts;
    }
  }
  return null;
};

export const UserDataLoader: React.FC<UserDataLoaderProps> = ({
  userFid,
  onUserDataLoaded,
  onNFTsLoaded,
  onLikedNFTsLoaded,
  onError
}) => {
  const loadingRef = useRef<number | null>(null);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleUserDataLoaded = useCallback((userData: FarcasterUser) => {
    onUserDataLoaded?.(userData);
  }, [onUserDataLoaded]);

  const handleNFTsLoaded = useCallback((nfts: NFT[]) => {
    onNFTsLoaded?.(nfts);
  }, [onNFTsLoaded]);

  const handleLikedNFTsLoaded = useCallback((nfts: NFT[]) => {
    onLikedNFTsLoaded?.(nfts);
  }, [onLikedNFTsLoaded]);

  const handleError = useCallback((error: string) => {
    onError?.(error);
  }, [onError]);

  useEffect(() => {
    // Prevent multiple simultaneous loads for the same user
    if (loadingRef.current === userFid) {
      console.log('Already loading data for FID:', userFid);
      return;
    }

    const loadUserData = async () => {
      loadingRef.current = userFid;
      
      try {
        // Check session cache first
        const sessionCache = getSessionCache();
        const cached = sessionCache.get(userFid);
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < SESSION_CACHE_DURATION) {
          console.log('✅ Using cached user data for FID:', userFid);
          handleUserDataLoaded(cached.userData);
          handleNFTsLoaded(cached.nfts);
          handleLikedNFTsLoaded(cached.likedNFTs);
          loadingRef.current = null;
          return;
        }
        
        console.log('Starting user data load for FID:', userFid);
        
        // Get Farcaster user data
        console.log('Fetching Farcaster user data...');
        const users = await searchUsers(userFid.toString()).catch(error => {
          console.error('Error searching for user:', error);
          handleError(error.message || 'Error searching for user');
          return [];
        });

        if (!users?.length) {
          console.error('No user found for FID:', userFid);
          handleError('User not found');
          loadingRef.current = null;
          return;
        }

        const userData = users[0];
        console.log('User data loaded:', {
          fid: userData.fid,
          username: userData.username,
          custody_address: userData.custody_address,
          verified_addresses: userData.verified_addresses
        });
        handleUserDataLoaded(userData);

        // Get addresses
        console.log('Extracting wallet addresses...');
        const addresses = [
          userData.custody_address,
          ...(userData.verified_addresses?.eth_addresses || [])
        ].filter(Boolean) as string[];

        console.log('Found wallet addresses:', addresses);
        if (!addresses.length) {
          console.error('No wallet addresses found for user:', userData.username);
          handleError('No wallet addresses found');
          loadingRef.current = null;
          return;
        }

        // Try cached NFTs first
        console.log('Checking NFT cache...');
        const cachedNFTs = getCachedNFTs(userFid);
        let nftsWithLikeStatus: NFT[] = [];
        
        if (cachedNFTs) {
          console.log('Found cached NFTs, validating structure...');
          const hasValidStructure = cachedNFTs.every(nft => 
            nft.hasOwnProperty('contract') && 
            nft.hasOwnProperty('tokenId') && 
            nft.hasOwnProperty('metadata')
          );

          if (hasValidStructure) {
            console.log('Using cached NFTs:', cachedNFTs.length);
            nftsWithLikeStatus = cachedNFTs.map(nft => {
              const mediaKey = getMediaKey(nft);
              const cachedLikes = localStorage.getItem('podplayr_liked_media_keys');
              let isLiked = false;
              
              if (cachedLikes) {
                try {
                  const mediaKeys = JSON.parse(cachedLikes) as string[];
                  isLiked = mediaKeys.includes(mediaKey);
                } catch (error) {
                  console.error('Error parsing cached likes:', error);
                }
              }
              
              return { ...nft, mediaKey, isLikedCached: isLiked };
            });
          } else {
            console.log('Invalid cache structure, removing cache');
            localStorage.removeItem(`${NFT_CACHE_KEY}${userFid}`);
          }
        }
        
        // If no valid cached NFTs, fetch fresh ones
        if (nftsWithLikeStatus.length === 0) {
          console.log('Fetching fresh NFTs from Alchemy...');
          const nftPromises = addresses.map(address => {
            console.log('Fetching NFTs for address:', address);
            return fetchUserNFTsFromAlchemy(address);
          });
          const nftResults = await Promise.all(nftPromises);
          const allNFTs = nftResults.flat();
          console.log('Total NFTs found:', allNFTs.length);

          // Cache NFTs
          console.log('Caching NFTs...');
          localStorage.setItem(`${NFT_CACHE_KEY}${userFid}`, JSON.stringify({
            nfts: allNFTs,
            timestamp: Date.now()
          }));

          // After loading NFTs, immediately check their like status
          nftsWithLikeStatus = allNFTs.map(nft => {
            const mediaKey = getMediaKey(nft);
            const cachedLikes = localStorage.getItem('podplayr_liked_media_keys');
            let isLiked = false;
            
            if (cachedLikes) {
              try {
                const mediaKeys = JSON.parse(cachedLikes) as string[];
                isLiked = mediaKeys.includes(mediaKey);
              } catch (error) {
                console.error('Error parsing cached likes:', error);
              }
            }
            
            return { ...nft, mediaKey, isLikedCached: isLiked };
          });
        }
        
        handleNFTsLoaded(nftsWithLikeStatus);

        // Initial load of liked NFTs (for backward compatibility)
        console.log('Loading liked NFTs initially...');
        const likedNFTs = await getLikedNFTs(userFid);
        console.log('Liked NFTs loaded initially:', likedNFTs.length);
        handleLikedNFTsLoaded(likedNFTs);
        
        // Cache all data in session cache
        const updatedCache = getSessionCache();
        updatedCache.set(userFid, {
          userData,
          nfts: nftsWithLikeStatus,
          likedNFTs,
          timestamp: now
        });
        setSessionCache(updatedCache);
        
        // Set up real-time subscription to liked NFTs
        console.log('Setting up real-time subscription to liked NFTs...');
        const unsubscribeLikes = subscribeToLikedNFTs(userFid, (updatedLikedNFTs: NFT[]) => {
          console.log('Liked NFTs update received:', updatedLikedNFTs.length);
          handleLikedNFTsLoaded(updatedLikedNFTs);
          
          // Update session cache
          const currentCache = getSessionCache();
          const existingCache = currentCache.get(userFid);
          if (existingCache) {
            currentCache.set(userFid, {
              ...existingCache,
              likedNFTs: updatedLikedNFTs,
              timestamp: Date.now()
            });
            setSessionCache(currentCache);
          }
          
          // Update localStorage cache for next time
          const mediaKeys = updatedLikedNFTs.map(nft => nft.mediaKey || getMediaKey(nft)).filter(Boolean);
          localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
        });
        
        loadingRef.current = null;
        
        // Return cleanup function
        return () => {
          console.log('Cleaning up liked NFTs subscription');
          unsubscribeLikes();
        };

      } catch (error) {
        console.error('Error loading user data:', error);
        handleError('Failed to load user data');
        loadingRef.current = null;
      }
    };

    if (userFid) {
      loadUserData();
    }
  }, [userFid, handleUserDataLoaded, handleNFTsLoaded, handleLikedNFTsLoaded, handleError]);
  
  return null;
};

export default UserDataLoader;
