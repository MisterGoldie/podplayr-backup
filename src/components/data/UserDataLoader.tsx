'use client';

import { useEffect, useCallback } from 'react';
import { searchUsers, getLikedNFTs } from '../../lib/firebase';
import { subscribeToLikedNFTs } from '../../lib/firebase/likes';
import { fetchUserNFTsFromAlchemy } from '../../lib/alchemy';
import { getMediaKey } from '../../utils/media';
import type { NFT, FarcasterUser } from '../../types/user';

const NFT_CACHE_KEY = 'podplayr_nft_cache_';
// Change from 2 hours to 24 hours
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

interface UserDataLoaderProps {
  userFid: number;
  onUserDataLoaded?: (userData: FarcasterUser) => void;
  onNFTsLoaded?: (nfts: NFT[]) => void;
  onLikedNFTsLoaded?: (nfts: NFT[]) => void;
  onError?: (error: string) => void;
}

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
    const loadUserData = async () => {
      try {
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
          return;
        }

        // Try cached NFTs first
        console.log('Checking NFT cache...');
        const cachedNFTs = getCachedNFTs(userFid);
        if (cachedNFTs) {
          console.log('Found cached NFTs, validating structure...');
          const hasValidStructure = cachedNFTs.every(nft => 
            nft.hasOwnProperty('contract') && 
            nft.hasOwnProperty('tokenId') && 
            nft.hasOwnProperty('metadata')
          );

          if (hasValidStructure) {
            console.log('Using cached NFTs:', cachedNFTs.length);
            handleNFTsLoaded(cachedNFTs);
            return;
          }
          console.log('Invalid cache structure, removing cache');
          localStorage.removeItem(`${NFT_CACHE_KEY}${userFid}`);
        }

        // Fetch fresh NFTs
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
        const nftsWithLikeStatus = allNFTs.map(nft => {
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
        
        handleNFTsLoaded(nftsWithLikeStatus);

        // Initial load of liked NFTs (for backward compatibility)
        console.log('Loading liked NFTs initially...');
        const likedNFTs = await getLikedNFTs(userFid);
        console.log('Liked NFTs loaded initially:', likedNFTs.length);
        handleLikedNFTsLoaded(likedNFTs);
        
        // Set up real-time subscription to liked NFTs
        console.log('Setting up real-time subscription to liked NFTs...');
        const unsubscribeLikes = subscribeToLikedNFTs(userFid, (updatedLikedNFTs: NFT[]) => {
          console.log('Liked NFTs update received:', updatedLikedNFTs.length);
          handleLikedNFTsLoaded(updatedLikedNFTs);
          
          // Update localStorage cache for next time
          const mediaKeys = updatedLikedNFTs.map(nft => nft.mediaKey || getMediaKey(nft)).filter(Boolean);
          localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
        });
        
        // Return cleanup function
        return () => {
          console.log('Cleaning up liked NFTs subscription');
          unsubscribeLikes();
        };

      } catch (error) {
        console.error('Error loading user data:', error);
        handleError('Failed to load user data');
      }
    };

    if (userFid) {
      loadUserData();
    }
  }, [userFid, handleUserDataLoaded, handleNFTsLoaded, handleLikedNFTsLoaded, handleError]);
  
  return null;
};

// Remove lines 195-202 (the broken code snippet)
// The file should end at line 193 with:

export default UserDataLoader;
