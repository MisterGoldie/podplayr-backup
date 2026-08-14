'use client';

import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { FarcasterContext, UserFidContext } from '~/app/providers';
import { PlayerWithAds } from './player/PlayerWithAds';
import { getMediaKey } from '~/utils/media';
import { BottomNav } from './navigation/BottomNav';
import HomeView from './views/HomeView';
import ExploreView from './views/ExploreView';
import LibraryView from './views/LibraryView';
import ProfileView from './views/ProfileView';
import UserProfileView from './views/UserProfileView';
import {
  trackUserSearch,
  getLikedNFTs,
  searchUsers,
  toggleLikeNFT,
  fetchUserNFTs,
  subscribeToRecentSearches
} from '../lib/firebase';
import type { NFT, FarcasterUser, SearchedUser } from '../types/user';
import { usePlayer } from '../contexts/PlayerContext';
import { useTopPlayedNFTs } from '../hooks/useTopPlayedNFTs';
import { UserDataLoader } from './data/UserDataLoader';
import { logger } from '../utils/logger';
import { isNftMediaDead, subscribeToDeadNftUpdates } from '../utils/deadNftRegistry';
import { UserImageProvider } from '../contexts/UserImageContext';
import { BaseAppSignIn } from './auth/BaseAppSignIn';

const demoLogger = logger.getModuleLogger('demo');

interface PageState {
  isHome: boolean;
  isExplore: boolean;
  isLibrary: boolean;
  isProfile: boolean;
  isUserProfile: boolean;
}

interface NavigationSource {
  fromExplore: boolean;
  fromProfile: boolean;
}

const HOME_PAGE: PageState = {
  isHome: true,
  isExplore: false,
  isLibrary: false,
  isProfile: false,
  isUserProfile: false
};

const deduplicateNFTsByMediaKey = (nfts: NFT[]): NFT[] => {
  const uniqueNFTs = new Map<string, NFT>();

  nfts.forEach((nft) => {
    const mediaKey = getMediaKey(nft);
    if (!uniqueNFTs.has(mediaKey)) {
      uniqueNFTs.set(mediaKey, nft);
      return;
    }

    const existing = uniqueNFTs.get(mediaKey)!;
    if (nft.metadata && (!existing.metadata || Object.keys(nft.metadata).length > Object.keys(existing.metadata).length)) {
      uniqueNFTs.set(mediaKey, nft);
    }
  });

  return Array.from(uniqueNFTs.values());
};

const DemoBase: React.FC = () => {
  const { isFarcaster, user: farcasterUser, client: farcasterClient, location: farcasterLocation } = useContext(FarcasterContext);
  const { fid, isFidReady } = useContext(UserFidContext);

  const [currentPage, setCurrentPage] = useState<PageState>(HOME_PAGE);
  const [navigationSource, setNavigationSource] = useState<NavigationSource>({
    fromExplore: false,
    fromProfile: false
  });
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
  const [searchResults, setSearchResults] = useState<FarcasterUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [userNFTs, setUserNFTs] = useState<NFT[]>([]);
  const [userNftsLoading, setUserNftsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [likedNFTs, setLikedNFTs] = useState<NFT[]>([]);
  const [likedNFTsLoaded, setLikedNFTsLoaded] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchedUser[]>([]);
  const [isAdPlaying, setIsAdPlaying] = useState(false);

  const isLoadingLikedNFTsRef = useRef(false);
  const skipEmptyLikeCacheWrite = useRef(true);

  const { topPlayed: topPlayedNFTs } = useTopPlayedNFTs();
  const {
    isPlaying,
    currentPlayingNFT,
    currentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause,
    handleSeek,
    handlePlayNext,
    handlePlayPrevious
  } = usePlayer();

  useEffect(() => {
    try {
      const cachedLikes = localStorage.getItem('podplayr_liked_media_keys');
      if (!cachedLikes) return;
      const mediaKeys = JSON.parse(cachedLikes) as string[];
      setLikedNFTs(mediaKeys.map((mediaKey) => ({ mediaKey } as NFT)));
    } catch (error) {
      demoLogger.error('Error loading cached likes:', error);
    }
  }, []);

  useEffect(() => {
    if (skipEmptyLikeCacheWrite.current && likedNFTs.length === 0) {
      skipEmptyLikeCacheWrite.current = false;
      return;
    }
    skipEmptyLikeCacheWrite.current = false;
    try {
      const mediaKeys = likedNFTs
        .map((nft) => nft.mediaKey || getMediaKey(nft))
        .filter((key): key is string => Boolean(key));
      localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(mediaKeys));
    } catch {
      // Ignore quota / private-mode failures
    }
  }, [likedNFTs]);

  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (isLoadingLikedNFTsRef.current) return;
      if (!fid) {
        setLikedNFTsLoaded(true);
        return;
      }

      isLoadingLikedNFTsRef.current = true;
      setLikedNFTsLoaded(false);
      try {
        const liked = await getLikedNFTs(fid);
        setLikedNFTs(liked.filter((item) => !isNftMediaDead(item)));
      } catch (error) {
        demoLogger.error('Error loading liked NFTs:', error);
      } finally {
        isLoadingLikedNFTsRef.current = false;
        setLikedNFTsLoaded(true);
      }
    };

    if (isFidReady) {
      void loadLikedNFTs();
    }
  }, [fid, isFidReady]);

  useEffect(() => {
    return subscribeToDeadNftUpdates((deadMediaKey) => {
      setLikedNFTs((prev) => prev.filter((nft) => getMediaKey(nft) !== deadMediaKey));
      setUserNFTs((prev) => prev.filter((nft) => getMediaKey(nft) !== deadMediaKey));
    });
  }, []);

  useEffect(() => {
    if (!fid) return;

    const unsubscribe = subscribeToRecentSearches(fid, (searches) => {
      setRecentSearches(searches);
    });

    return unsubscribe;
  }, [fid]);

  const releaseVideoResources = useCallback(() => {
    const currentId = currentPlayingNFT
      ? `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
      : null;

    document.querySelectorAll('video').forEach((video) => {
      if (video.id !== currentId && !video.paused) {
        try {
          video.pause();
        } catch {
          // Ignore pause errors from detached nodes
        }
      }
    });
  }, [currentPlayingNFT]);

  useEffect(() => {
    if (currentPlayingNFT) {
      releaseVideoResources();
    }
  }, [currentPlayingNFT, releaseVideoResources]);

  const handleNFTsLoaded = useCallback((nfts: NFT[]) => {
    setUserNFTs(deduplicateNFTsByMediaKey(nfts));
    setUserNftsLoading(false);
  }, []);

  const handleUserDataError = useCallback((loadError: string) => {
    demoLogger.error('NFT loading error:', loadError);
    setUserNftsLoading(false);
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      setSearchResults(await searchUsers(query));
    } catch (searchError) {
      demoLogger.error('Error searching users:', searchError);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const isNFTLiked = useCallback((nft: NFT): boolean => {
    if (!nft) return false;
    const nftMediaKey = getMediaKey(nft);
    if (!nftMediaKey) return false;

    return likedNFTs.some((likedNFT) => {
      const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
      return likedMediaKey === nftMediaKey;
    });
  }, [likedNFTs]);

  const onLikeToggle = useCallback(async (nft: NFT) => {
    if (!fid) {
      demoLogger.warn('No FID available for like toggle');
      return;
    }

    try {
      const mediaKey = getMediaKey(nft);
      const wasLiked = likedNFTs.some((likedNFT) => {
        const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
        return likedMediaKey === mediaKey;
      });

      const newLikeState = await toggleLikeNFT(nft, fid);

      if (newLikeState) {
        if (!wasLiked) {
          const likedAt = Date.now();
          const likedNft: NFT = {
            ...nft,
            likedTimestamp: likedAt,
            likedAt: new Date(likedAt).toISOString(),
          };
          setLikedNFTs((prev) => [
            likedNft,
            ...prev.filter((existing) => (existing.mediaKey || getMediaKey(existing)) !== mediaKey)
          ]);
        }
      } else {
        setLikedNFTs((prev) => prev.filter((likedNFT) => {
          const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
          return likedMediaKey !== mediaKey;
        }));
      }
    } catch (likeError) {
      demoLogger.error('Error toggling like:', likeError);
    }
  }, [fid, likedNFTs]);

  const handlePlayNFT = useCallback(async (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => {
    const sameTrack = currentPlayingNFT
      ? getMediaKey(currentPlayingNFT) === getMediaKey(nft)
      : currentlyPlaying === `${nft.contract}-${nft.tokenId}`;

    setIsPlayerMinimized(true);
    if (!sameTrack) {
      await handlePlayAudio(nft, context);
    }
  }, [handlePlayAudio, currentlyPlaying, currentPlayingNFT]);

  const onReset = useCallback(() => {
    setCurrentPage(HOME_PAGE);
  }, []);

  const handleDirectUserSelect = useCallback(async (user: FarcasterUser) => {
    try {
      demoLogger.info(`Selected user: ${user.username}`);
      setSelectedUser(user);
      setUserNFTs([]);
      setUserNftsLoading(true);

      if (fid && user.fid) {
        try {
          await trackUserSearch(user.username, fid);
        } catch (trackError) {
          demoLogger.error('Error tracking user search:', trackError);
        }
      }

      setNavigationSource({ fromExplore: true, fromProfile: false });
      setCurrentPage((prev) => ({
        ...prev,
        isExplore: false,
        isUserProfile: true
      }));

      fetchUserNFTs(user.fid).then((nfts) => {
        const deduplicatedNFTs = deduplicateNFTsByMediaKey(nfts);
        setUserNFTs(deduplicatedNFTs);
        if (deduplicatedNFTs.length > 0) {
          setUserNftsLoading(false);
        }
      }).catch((fetchError) => {
        demoLogger.error('Error loading NFTs for user:', fetchError);
        setUserNftsLoading(false);
      });
    } catch (selectError) {
      demoLogger.error('Error selecting user:', selectError);
    }
  }, [fid]);

  const togglePictureInPicture = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (!currentPlayingNFT) return;

      const video = document.getElementById(
        `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
      ) as HTMLVideoElement | null;

      if (video && 'requestPictureInPicture' in video) {
        await video.requestPictureInPicture();
      }
    } catch (pipError) {
      demoLogger.error('PiP error:', pipError);
    }
  }, [currentPlayingNFT]);

  const handleViewChange = useCallback((view: 'home' | 'explore' | 'library' | 'profile') => {
    setSelectedUser(null);
    setUserNFTs([]);
    setUserNftsLoading(false);
    setCurrentPage({
      isHome: view === 'home',
      isExplore: view === 'explore',
      isLibrary: view === 'library',
      isProfile: view === 'profile',
      isUserProfile: false
    });
  }, []);

  const currentViewKey = useMemo((): 'home' | 'explore' | 'library' | 'profile' => {
    if (currentPage.isExplore) return 'explore';
    if (currentPage.isLibrary) return 'library';
    if (currentPage.isProfile || currentPage.isUserProfile) return 'profile';
    return 'home';
  }, [currentPage]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082] text-white">
      <BaseAppSignIn variant="banner" />
      {currentPage.isHome && (
        <HomeView
          topPlayedNFTs={topPlayedNFTs}
          onPlayNFT={handlePlayNFT}
          currentlyPlaying={currentlyPlaying}
          isPlaying={isPlaying}
          handlePlayPause={handlePlayPause}
          onReset={onReset}
          onLikeToggle={onLikeToggle}
          likedNFTs={likedNFTs}
          currentPlayingNFT={currentPlayingNFT}
        />
      )}
      {currentPage.isExplore && (
        <ExploreView
          onSearch={handleSearch}
          isPlaying={isPlaying}
          searchResults={searchResults}
          isSearching={isSearching}
          recentSearches={recentSearches}
          handleDirectUserSelect={handleDirectUserSelect}
          onReset={onReset}
        />
      )}
      {currentPage.isLibrary && (
        <LibraryView
          likedNFTs={likedNFTs}
          isPlaying={isPlaying}
          currentlyPlaying={currentlyPlaying}
          currentPlayingNFT={currentPlayingNFT}
          handlePlayAudio={handlePlayNFT}
          handlePlayPause={handlePlayPause}
          onReset={onReset}
          userContext={{
            user: {
              fid: fid || 0,
              pfpUrl: farcasterUser?.pfp ?? ''
            }
          }}
          setIsLiked={() => {}}
          setIsPlayerVisible={() => {}}
          setIsPlayerMinimized={setIsPlayerMinimized}
          onLikeToggle={onLikeToggle}
          isLoading={!likedNFTsLoaded}
        />
      )}
      {currentPage.isProfile && (
        <UserImageProvider fid={fid} initialProfileImage={farcasterUser?.pfp}>
          <ProfileView
            farcasterContext={{
              isFarcaster,
              user: farcasterUser,
              client: farcasterClient,
              location: farcasterLocation
            }}
            nfts={[]}
            handlePlayAudio={handlePlayNFT}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            handlePlayPause={handlePlayPause}
            onReset={onReset}
            onNFTsLoaded={() => {}}
            onLikeToggle={onLikeToggle}
            isNFTLiked={isNFTLiked}
            onUserProfileClick={(user) => {
              demoLogger.info('Navigating to user profile from ProfileView modal:', user.username);
              setSelectedUser(user);
              setUserNFTs([]);
              setUserNftsLoading(true);
              setNavigationSource({ fromExplore: false, fromProfile: true });
              setCurrentPage((prev) => ({ ...prev, isProfile: false, isUserProfile: true }));
            }}
          />
        </UserImageProvider>
      )}
      {currentPage.isUserProfile && selectedUser && (
        <UserProfileView
          user={selectedUser}
          nfts={userNFTs}
          nftsLoading={userNftsLoading}
          handlePlayAudio={handlePlayNFT}
          isPlaying={isPlaying}
          currentlyPlaying={currentlyPlaying}
          handlePlayPause={handlePlayPause}
          onReset={onReset}
          onBack={() => {
            setSelectedUser(null);
            setUserNFTs([]);
            setUserNftsLoading(false);

            if (navigationSource.fromProfile) {
              setCurrentPage((prev) => ({ ...prev, isUserProfile: false, isProfile: true }));
            } else {
              setCurrentPage((prev) => ({ ...prev, isUserProfile: false, isExplore: true }));
            }

            setNavigationSource({ fromExplore: false, fromProfile: false });
          }}
          currentUserFid={fid || 0}
          onLikeToggle={onLikeToggle}
          isNFTLiked={isNFTLiked}
        />
      )}
      <BottomNav
        currentView={currentViewKey}
        onViewChange={handleViewChange}
        isPlayerActive={!!currentPlayingNFT}
        isPlayerMinimized={isPlayerMinimized}
        isAdPlaying={isAdPlaying}
      />
      {selectedUser && (
        <UserDataLoader
          userFid={selectedUser.fid}
          onNFTsLoaded={handleNFTsLoaded}
          onError={handleUserDataError}
        />
      )}
      {currentPlayingNFT && (
        <PlayerWithAds
          nft={currentPlayingNFT}
          isPlaying={isPlaying}
          progress={audioProgress}
          duration={audioDuration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onNext={handlePlayNext}
          onPrevious={handlePlayPrevious}
          isMinimized={isPlayerMinimized}
          onMinimizeToggle={() => setIsPlayerMinimized(!isPlayerMinimized)}
          onPlayNFT={handlePlayNFT}
          onLikeToggle={() => currentPlayingNFT && onLikeToggle(currentPlayingNFT)}
          isLiked={isNFTLiked(currentPlayingNFT)}
          onPictureInPicture={togglePictureInPicture}
          onAdStateChange={setIsAdPlaying}
        />
      )}
    </div>
  );
};

export const Demo = React.memo(DemoBase);
