'use client';

import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { FarcasterContext, UserFidContext } from '~/app/providers';
import { PlayerWithAds, usePrerollAd } from './player/PlayerWithAds';
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
  subscribeToRecentSearches
} from '../lib/firebase';
import type { NFT, FarcasterUser, SearchedUser } from '../types/user';
import { usePlayer } from '../contexts/PlayerContext';
import { useTopPlayedNFTs } from '../hooks/useTopPlayedNFTs';
import { UserDataLoader } from './data/UserDataLoader';
import { logger } from '../utils/logger';
import { isNftMediaDead, subscribeToDeadNftUpdates } from '../utils/deadNftRegistry';
import { applyConfirmedPlayback, isPlayableMediaNFT } from '../utils/isMediaNFT';
import { UserImageProvider } from '../contexts/UserImageContext';
import { BaseAppSignIn } from './auth/BaseAppSignIn';
import { parseProfileFid } from '../lib/miniapp';
import { restorePageScroll } from '../utils/pageScroll';
import NFTNotification from './NFTNotification';
import { useNFTNotification } from '../context/NFTNotificationContext';

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

  const [currentPage, setCurrentPage] = useState<PageState>(() => {
    if (typeof window === 'undefined') return HOME_PAGE;
    return parseProfileFid(window.location.pathname, window.location.search)
      ? { ...HOME_PAGE, isHome: false, isUserProfile: true }
      : HOME_PAGE;
  });
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

  const isLoadingLikedNFTsRef = useRef(false);
  const skipEmptyLikeCacheWrite = useRef(true);

  const { topPlayed: topPlayedNFTs, loading: topPlayedLoading } = useTopPlayedNFTs();
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
  const { showAd, beforePlay, onAdComplete } = usePrerollAd();
  const { showNotification } = useNFTNotification();

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
        const liked = (await getLikedNFTs(fid)).filter(isPlayableMediaNFT);
        setLikedNFTs(liked);
        applyConfirmedPlayback(liked, setLikedNFTs);
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
    // Only prune when playable audio/video is dead — a broken thumbnail alone
    // must not shrink the collection count (placeholder still shows the card).
    return subscribeToDeadNftUpdates((deadMediaKey) => {
      setUserNFTs((prev) =>
        prev.filter((nft) => {
          if (getMediaKey(nft) !== deadMediaKey) return true;
          return !isNftMediaDead(nft);
        })
      );
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
      throw new Error('No FID available for like toggle');
    }

    try {
      const mediaKey = getMediaKey(nft);
      const wasLiked = likedNFTs.some((likedNFT) => {
        const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
        return likedMediaKey === mediaKey;
      });

      const newLikeState = await toggleLikeNFT(nft, fid);

      if (newLikeState) {
        if (!wasLiked && isPlayableMediaNFT(nft)) {
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
      throw likeError;
    }
  }, [fid, likedNFTs]);

  const handlePlayNFT = useCallback(async (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => {
    const sameTrack = currentPlayingNFT
      ? getMediaKey(currentPlayingNFT) === getMediaKey(nft)
      : currentlyPlaying === `${nft.contract}-${nft.tokenId}`;

    console.log('[PLAY-DEBUG] Demo.handlePlayNFT', {
      name: nft.name,
      sameTrack,
      isPlaying,
      queueType: context?.queueType,
      queueLen: context?.queue?.length,
    });

    setIsPlayerMinimized(true);

    // Same track from Recently Played / cards: toggle pause, or restart so
    // play-count threshold can fire again after an ended / paused session.
    if (sameTrack) {
      if (isPlaying) {
        handlePlayPause();
        return;
      }
      beforePlay(
        () => { void handlePlayAudio(nft, context); },
        undefined
      );
      return;
    }

    beforePlay(
      () => { void handlePlayAudio(nft, context); },
      isPlaying ? handlePlayPause : undefined
    );
  }, [handlePlayAudio, currentlyPlaying, currentPlayingNFT, beforePlay, isPlaying, handlePlayPause]);

  const handlePlayNextGated = useCallback(() => {
    beforePlay(
      () => { void handlePlayNext(); },
      isPlaying ? handlePlayPause : undefined
    );
  }, [beforePlay, handlePlayNext, isPlaying, handlePlayPause]);

  const handlePlayPreviousGated = useCallback(() => {
    beforePlay(
      () => { void handlePlayPrevious(); },
      isPlaying ? handlePlayPause : undefined
    );
  }, [beforePlay, handlePlayPrevious, isPlaying, handlePlayPause]);

  const syncProfileUrl = useCallback((profileFid: number | null) => {
    if (typeof window === 'undefined') return;
    const nextPath = profileFid ? `/profile/${profileFid}` : '/';
    if (window.location.pathname.replace(/\/$/, '') === nextPath.replace(/\/$/, '')) return;
    window.history.pushState(profileFid ? { profileFid } : {}, '', nextPath);
  }, []);

  const openUserProfile = useCallback((user: FarcasterUser, source: NavigationSource, updateUrl = true) => {
    setSelectedUser(user);
    setUserNFTs([]);
    setUserNftsLoading(true);
    setNavigationSource(source);
    setCurrentPage({
      ...HOME_PAGE,
      isHome: false,
      isUserProfile: true,
    });
    if (updateUrl) {
      syncProfileUrl(user.fid);
    }
    restorePageScroll();
  }, [syncProfileUrl]);

  const closeUserProfile = useCallback((nextPage: PageState = HOME_PAGE) => {
    setSelectedUser(null);
    setUserNFTs([]);
    setUserNftsLoading(false);
    setNavigationSource({ fromExplore: false, fromProfile: false });
    setCurrentPage(nextPage);
    syncProfileUrl(null);
    restorePageScroll();
  }, [syncProfileUrl]);

  const onReset = useCallback(() => {
    closeUserProfile(HOME_PAGE);
  }, [closeUserProfile]);

  const handlePlayerLikeToggle = useCallback(async (nft: NFT) => {
    const wasLiked = isNFTLiked(nft);
    try {
      await onLikeToggle(nft);
      showNotification(wasLiked ? 'unlike' : 'like', nft);
    } catch {
      // Logged inside onLikeToggle; skip the header banner on failure.
    }
  }, [isNFTLiked, onLikeToggle, showNotification]);

  const handleDirectUserSelect = useCallback(async (user: FarcasterUser) => {
    try {
      demoLogger.info(`Selected user: ${user.username}`);
      openUserProfile(user, { fromExplore: true, fromProfile: false });

      if (fid && user.fid) {
        try {
          await trackUserSearch(user.username, fid);
        } catch (trackError) {
          demoLogger.error('Error tracking user search:', trackError);
        }
      }
      // Owned NFTs load once via UserDataLoader → handleNFTsLoaded
    } catch (selectError) {
      demoLogger.error('Error selecting user:', selectError);
    }
  }, [fid, openUserProfile]);

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
    setNavigationSource({ fromExplore: false, fromProfile: false });
    setCurrentPage({
      isHome: view === 'home',
      isExplore: view === 'explore',
      isLibrary: view === 'library',
      isProfile: view === 'profile',
      isUserProfile: false
    });
    syncProfileUrl(null);
    restorePageScroll();
  }, [syncProfileUrl]);

  const loadProfileFromFid = useCallback(async (profileFid: number, updateUrl = false) => {
    if (selectedUser?.fid === profileFid && currentPage.isUserProfile) return;

    try {
      const users = await searchUsers(String(profileFid));
      const user = users[0];
      if (!user) {
        demoLogger.warn('No user found for profile fid:', profileFid);
        setCurrentPage(HOME_PAGE);
        syncProfileUrl(null);
        return;
      }

      openUserProfile(user, { fromExplore: false, fromProfile: false }, updateUrl);
      // Owned NFTs load once via UserDataLoader → handleNFTsLoaded
    } catch (error) {
      demoLogger.error('Error loading profile from URL:', error);
    }
  }, [currentPage.isUserProfile, openUserProfile, selectedUser?.fid, syncProfileUrl]);

  const handleOpenArtistProfile = useCallback(async (artistFid: number) => {
    setIsPlayerMinimized(true);
    try {
      const users = await searchUsers(String(artistFid));
      const user = users[0];
      if (!user) {
        demoLogger.warn('No user found for artist fid:', artistFid);
        return;
      }
      openUserProfile(
        user,
        {
          fromExplore: currentPage.isExplore || navigationSource.fromExplore,
          fromProfile: currentPage.isProfile || navigationSource.fromProfile,
        },
        true
      );
    } catch (error) {
      demoLogger.error('Error opening artist profile:', error);
    }
  }, [
    currentPage.isExplore,
    currentPage.isProfile,
    navigationSource.fromExplore,
    navigationSource.fromProfile,
    openUserProfile,
  ]);

  useEffect(() => {
    const profileFid = parseProfileFid(window.location.pathname, window.location.search);
    if (!profileFid) return;
    void loadProfileFromFid(profileFid);
  }, [loadProfileFromFid]);

  useEffect(() => {
    const onPopState = () => {
      const profileFid = parseProfileFid(window.location.pathname, window.location.search);
      if (profileFid) {
        void loadProfileFromFid(profileFid);
        return;
      }

      setSelectedUser(null);
      setUserNFTs([]);
      setUserNftsLoading(false);
      setNavigationSource({ fromExplore: false, fromProfile: false });
      setCurrentPage(HOME_PAGE);
      restorePageScroll();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loadProfileFromFid]);

  const currentViewKey = useMemo((): 'home' | 'explore' | 'library' | 'profile' => {
    if (currentPage.isExplore) return 'explore';
    if (currentPage.isLibrary) return 'library';
    if (currentPage.isProfile || currentPage.isUserProfile) return 'profile';
    return 'home';
  }, [currentPage]);

  useEffect(() => {
    restorePageScroll();
  }, [currentViewKey, currentPage.isUserProfile, selectedUser?.fid]);

  return (
    <div className="relative bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082] text-white">
      <NFTNotification onLogoClick={onReset} />
      <BaseAppSignIn variant="banner" />
      {currentPage.isHome && (
        <HomeView
          topPlayedNFTs={topPlayedNFTs}
          topPlayedLoading={topPlayedLoading}
          onPlayNFT={handlePlayNFT}
          currentlyPlaying={currentlyPlaying}
          isPlaying={isPlaying}
          handlePlayPause={handlePlayPause}
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
          onPlayNFT={handlePlayNFT}
          currentlyPlaying={currentlyPlaying}
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
            onNFTsLoaded={() => {}}
            onLikeToggle={onLikeToggle}
            isNFTLiked={isNFTLiked}
            onUserProfileClick={(user) => {
              demoLogger.info('Navigating to user profile from ProfileView modal:', user.username);
              openUserProfile(user, { fromExplore: false, fromProfile: true });
              // Owned NFTs load once via UserDataLoader → handleNFTsLoaded
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
          onBack={() => {
            if (navigationSource.fromProfile) {
              closeUserProfile({
                ...HOME_PAGE,
                isHome: false,
                isProfile: true,
              });
            } else if (navigationSource.fromExplore) {
              closeUserProfile({
                ...HOME_PAGE,
                isHome: false,
                isExplore: true,
              });
            } else {
              closeUserProfile(HOME_PAGE);
            }
          }}
          currentUserFid={fid || 0}
          onLikeToggle={onLikeToggle}
          isNFTLiked={isNFTLiked}
          onUserProfileClick={(user) => {
            demoLogger.info('Navigating to user profile from UserProfileView:', user.username);
            openUserProfile(user, {
              fromExplore: navigationSource.fromExplore,
              fromProfile: navigationSource.fromProfile,
            });
          }}
        />
      )}
      <BottomNav
        currentView={currentViewKey}
        onViewChange={handleViewChange}
        isPlayerActive={!!currentPlayingNFT}
        isPlayerMinimized={isPlayerMinimized}
        isAdPlaying={showAd}
      />
      {selectedUser && (
        <UserDataLoader
          userFid={selectedUser.fid}
          onNFTsLoaded={handleNFTsLoaded}
          onError={handleUserDataError}
        />
      )}
      {(showAd || currentPlayingNFT) && (
        <PlayerWithAds
          nft={currentPlayingNFT}
          isPlaying={isPlaying}
          progress={audioProgress}
          duration={audioDuration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onNext={handlePlayNextGated}
          onPrevious={handlePlayPreviousGated}
          isMinimized={isPlayerMinimized}
          onMinimizeToggle={() => setIsPlayerMinimized(!isPlayerMinimized)}
          onPlayNFT={handlePlayNFT}
          onLikeToggle={handlePlayerLikeToggle}
          isLiked={!!currentPlayingNFT && isNFTLiked(currentPlayingNFT)}
          onPictureInPicture={togglePictureInPicture}
          onOpenArtistProfile={handleOpenArtistProfile}
          showAd={showAd}
          onAdComplete={onAdComplete}
        />
      )}
    </div>
  );
};

export const Demo = React.memo(DemoBase);
