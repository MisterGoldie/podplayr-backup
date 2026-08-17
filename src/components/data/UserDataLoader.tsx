'use client';

import { useEffect, useCallback, useRef } from 'react';
import { searchUsers, fetchUserNFTs } from '../../lib/firebase';
import { getLikedNFTs, subscribeToLikedNFTs } from '../../lib/firebase/likes';
import { getMediaKey } from '../../utils/media';
import { applyConfirmedPlayback, isPlayableMediaNFT } from '../../utils/isMediaNFT';
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
    if (Date.now() - timestamp < TWENTY_FOUR_HOURS && Array.isArray(nfts) && nfts.length > 0) {
      // Reject caches written while cover selection was broken (empty image fields).
      const missingCover = nfts.filter(
        (nft: NFT) =>
          !nft?.image &&
          !nft?.metadata?.image &&
          !nft?.collection?.image &&
          !nft?.metadata?.animation_url &&
          !nft?.videoUrl
      ).length;
      if (missingCover > 0) {
        localStorage.removeItem(`${NFT_CACHE_KEY}${userId}`);
        return null;
      }
      return nfts;
    }
  }
  return null;
};

const withLikeStatus = (nfts: NFT[]): NFT[] => {
  const cachedLikes = localStorage.getItem('podplayr_liked_media_keys');
  let mediaKeys: string[] = [];
  if (cachedLikes) {
    try {
      mediaKeys = JSON.parse(cachedLikes) as string[];
    } catch (error) {
      console.error('Error parsing cached likes:', error);
    }
  }

  return nfts.map((nft) => {
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    return {
      ...nft,
      mediaKey,
      isLikedCached: mediaKeys.includes(mediaKey),
    };
  });
};

const cacheOwnedNFTs = (userFid: number, nfts: NFT[]) => {
  localStorage.setItem(
    `${NFT_CACHE_KEY}${userFid}`,
    JSON.stringify({ nfts, timestamp: Date.now() })
  );
};

export const UserDataLoader: React.FC<UserDataLoaderProps> = ({
  userFid,
  onUserDataLoaded,
  onNFTsLoaded,
  onLikedNFTsLoaded,
  onError
}) => {
  const loadingRef = useRef<number | null>(null);
  const likesEnabled = Boolean(onLikedNFTsLoaded);

  const handleUserDataLoaded = useCallback((userData: FarcasterUser) => {
    onUserDataLoaded?.(userData);
  }, [onUserDataLoaded]);

  const handleNFTsLoaded = useCallback((nfts: NFT[]) => {
    onNFTsLoaded?.(nfts);
  }, [onNFTsLoaded]);

  const handleLikedNFTsLoaded = useCallback((nfts: NFT[]) => {
    onLikedNFTsLoaded?.(nfts.filter(isPlayableMediaNFT));
  }, [onLikedNFTsLoaded]);

  const handleError = useCallback((error: string) => {
    onError?.(error);
  }, [onError]);

  useEffect(() => {
    if (!userFid) return;

    // Prevent multiple simultaneous loads for the same user
    if (loadingRef.current === userFid) {
      return;
    }

    let cancelled = false;
    let unsubscribeLikes: (() => void) | undefined;
    loadingRef.current = userFid;

    const loadUserData = async () => {
      try {
        const sessionCache = getSessionCache();
        const cached = sessionCache.get(userFid);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < SESSION_CACHE_DURATION) {
          handleUserDataLoaded(cached.userData);
          handleNFTsLoaded(cached.nfts);
          if (likesEnabled) {
            handleLikedNFTsLoaded(cached.likedNFTs);
          }
          // Still refresh owned NFTs in background so custody-only caches don't stick
        }


        const users = await searchUsers(userFid.toString()).catch((error) => {
          console.error('Error searching for user:', error);
          handleError(error.message || 'Error searching for user');
          return [];
        });

        if (cancelled) return;

        if (!users?.length) {
          console.error('No user found for FID:', userFid);
          handleError('User not found');
          return;
        }

        const userData = users[0];
        handleUserDataLoaded(userData);

        // Serve local cache immediately (stale-while-revalidate), then always
        // refresh via fetchUserNFTs so verified wallets aren't missed.
        const cachedNFTs = getCachedNFTs(userFid);
        if (cachedNFTs?.length) {
          const hasValidStructure = cachedNFTs.every(
            (nft) =>
              Object.prototype.hasOwnProperty.call(nft, 'contract') &&
              Object.prototype.hasOwnProperty.call(nft, 'tokenId') &&
              Object.prototype.hasOwnProperty.call(nft, 'metadata')
          );

          if (hasValidStructure) {
            handleNFTsLoaded(withLikeStatus(cachedNFTs));
          } else {
            localStorage.removeItem(`${NFT_CACHE_KEY}${userFid}`);
          }
        }

        const freshNFTs = await fetchUserNFTs(userFid);
        if (cancelled) return;

        // Do not soft-merge covers from cache — that preferred OpenSea collection
        // art over Alchemy token stills and could pollute animation_url.
        const nftsWithLikeStatus = withLikeStatus(freshNFTs);
        cacheOwnedNFTs(userFid, nftsWithLikeStatus);
        handleNFTsLoaded(nftsWithLikeStatus);

        let likedNFTs: NFT[] = cached?.likedNFTs || [];
        if (likesEnabled) {
          likedNFTs = await getLikedNFTs(userFid);
          if (cancelled) return;
          handleLikedNFTsLoaded(likedNFTs);
          applyConfirmedPlayback(likedNFTs, handleLikedNFTsLoaded);

          unsubscribeLikes = subscribeToLikedNFTs(userFid, (updatedLikedNFTs: NFT[]) => {
            if (cancelled) return;
            handleLikedNFTsLoaded(updatedLikedNFTs);

            const currentCache = getSessionCache();
            const existingCache = currentCache.get(userFid);
            if (existingCache) {
              currentCache.set(userFid, {
                ...existingCache,
                likedNFTs: updatedLikedNFTs,
                timestamp: Date.now(),
              });
              setSessionCache(currentCache);
            }
          });
        }

        const updatedCache = getSessionCache();
        updatedCache.set(userFid, {
          userData,
          nfts: nftsWithLikeStatus,
          likedNFTs,
          timestamp: Date.now(),
        });
        setSessionCache(updatedCache);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading user data:', error);
        handleError('Failed to load user data');
      } finally {
        if (loadingRef.current === userFid) {
          loadingRef.current = null;
        }
      }
    };

    void loadUserData();

    return () => {
      cancelled = true;
      unsubscribeLikes?.();
      if (loadingRef.current === userFid) {
        loadingRef.current = null;
      }
    };
  }, [
    userFid,
    likesEnabled,
    handleUserDataLoaded,
    handleNFTsLoaded,
    handleLikedNFTsLoaded,
    handleError,
  ]);

  return null;
};

export default UserDataLoader;
