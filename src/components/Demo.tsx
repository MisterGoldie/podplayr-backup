'use client';

import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { FarcasterContext, UserFidContext } from '~/app/providers';
import { PlayerWithAds, usePrerollAd } from './player/PlayerWithAds';
import { getMediaKey } from '~/utils/media';
import { sameLikedTrack } from '../utils/likeDedupe';
import { BottomNav } from './navigation/BottomNav';
import HomeView from './views/HomeView';
import {
  trackUserSearch,
  searchUsers,
  subscribeToRecentSearches
} from '../lib/firebase';
import { getLikedNFTs, toggleLikeNFT } from '../lib/firebase/likes';
import type { NFT, FarcasterUser, SearchedUser } from '../types/user';
import { usePlayer } from '../contexts/PlayerContext';
import { useTopPlayedNFTs } from '../hooks/useTopPlayedNFTs';
import { UserDataLoader } from './data/UserDataLoader';
import { logger } from '../utils/logger';
import { isNftMediaDead, subscribeToDeadNftUpdates } from '../utils/deadNftRegistry';
import { applyConfirmedPlayback, isPlayableMediaNFT } from '../utils/isMediaNFT';
import { withFeaturedPlayback, findFeaturedNftByIdentity } from '../data/featuredNfts';
import { UserImageProvider } from '../contexts/UserImageContext';
import { BaseAppSignIn } from './auth/BaseAppSignIn';
import { WebPrivyController } from './auth/WebPrivyController';
import { hasPrivyAppId } from './providers/PrivyAppProvider';
import { parseProfileFid, parseNftDeepLinkFromLaunch, isLivePath, isLiveLaunch } from '../lib/miniapp';
import { markDeepLinkSettled } from '../lib/deepLinkReady';
import { emitLikeCountBump } from '../lib/likeCountEvents';
import { LivePlayer } from './live/LivePlayer';
import { firstNonNull, readNftBootstrap } from '../lib/nftBootstrap';
import { normalizeNftTokenId } from '../utils/nftIdentity';
import { restorePageScroll } from '../utils/pageScroll';
import NFTNotification from './NFTNotification';
import { useNFTNotification } from '../context/NFTNotificationContext';
import { idbGetJson, idbRemove, idbSetJson } from '../utils/idbCache';
import { getLikedMediaKeysCache, setLikedMediaKeysCache, clearLikedMediaKeysCache } from '../utils/likedMediaKeysCache';

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

function TabLoading() {
  return (
    <div className="page-scroll min-h-[50vh] pt-20 px-4 animate-pulse">
      <div className="h-6 w-40 bg-purple-900/40 rounded mb-6" />
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-[160px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0" />
        ))}
      </div>
    </div>
  );
}

const ExploreView = dynamic(() => import('./views/ExploreView'), {
  ssr: false,
  loading: TabLoading,
});
const LibraryView = dynamic(() => import('./views/LibraryView'), {
  ssr: false,
  loading: TabLoading,
});
const ProfileView = dynamic(() => import('./views/ProfileView'), {
  ssr: false,
  loading: TabLoading,
});
const UserProfileView = dynamic(() => import('./views/UserProfileView'), {
  ssr: false,
  loading: TabLoading,
});

// Backed by IndexedDB, not localStorage — localStorage is blocked by
// Tracking Prevention in Farcaster's WKWebView (reads always return null,
// writes silently no-op), so this snapshot never actually warmed a mobile
// session before. IndexedDB is not subject to that restriction. See
// src/utils/idbCache.ts.
const LIKED_NFTS_SNAPSHOT_KEY = 'podplayr_liked_nfts_snapshot_v1';
const LIKED_NFTS_SNAPSHOT_TTL = 24 * 60 * 60 * 1000;

function likedNftsSnapshotIsUsable(nfts: unknown): nfts is NFT[] {
  if (!Array.isArray(nfts) || nfts.length === 0) return false;
  return nfts.every(
    (nft) =>
      Boolean(nft) &&
      typeof nft === 'object' &&
      typeof (nft as NFT).contract === 'string' &&
      Boolean((nft as NFT).contract) &&
      (nft as NFT).tokenId != null &&
      String((nft as NFT).tokenId).length > 0
  );
}

async function readLikedNftsSnapshot(): Promise<{ fid: number; nfts: NFT[] } | null> {
  try {
    const parsed = await idbGetJson<{ fid?: number; nfts?: unknown; timestamp?: number }>(
      LIKED_NFTS_SNAPSHOT_KEY
    );
    if (!parsed) return null;
    if (
      typeof parsed.fid !== 'number' ||
      !parsed.fid ||
      typeof parsed.timestamp !== 'number' ||
      Date.now() - parsed.timestamp > LIKED_NFTS_SNAPSHOT_TTL ||
      !likedNftsSnapshotIsUsable(parsed.nfts)
    ) {
      return null;
    }
    return { fid: parsed.fid, nfts: parsed.nfts };
  } catch {
    return null;
  }
}

async function clearLikedNftsLocalCache(): Promise<void> {
  try {
    await Promise.all([
      idbRemove(LIKED_NFTS_SNAPSHOT_KEY),
      clearLikedMediaKeysCache(),
    ]);
  } catch {
    // Ignore quota / private-mode failures
  }
  try {
    // toggleLikeNFT still maintains this legacy misspelled key in localStorage
    // as its own like-state recovery hint, so web logout must keep clearing it
    // or the next like action reads back the previous user's mediaKeys.
    localStorage.removeItem('podplyr_liked_mediakeys');
  } catch {
    // Blocked storage (Farcaster webview) — nothing was written there anyway.
  }
}

async function writeLikedNftsSnapshot(fid: number, nfts: NFT[]): Promise<void> {
  if (!fid) return;
  try {
    if (nfts.length === 0) {
      await idbSetJson(LIKED_NFTS_SNAPSHOT_KEY, { fid, nfts: [], timestamp: Date.now() });
      return;
    }
    if (!likedNftsSnapshotIsUsable(nfts)) return;
    await idbSetJson(LIKED_NFTS_SNAPSHOT_KEY, { fid, nfts, timestamp: Date.now() });
  } catch {
    // Ignore quota / private-mode failures
  }
}

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
  const { fid, isFidReady, environment, webAuthReady, webAuthenticated } = useContext(UserFidContext);
  const openPrivyRef = useRef<() => void>(() => {});
  const bindPrivyOpen = useCallback((open: () => void) => {
    openPrivyRef.current = open;
  }, []);

  const [currentPage, setCurrentPage] = useState<PageState>(() => {
    if (typeof window === 'undefined') return { ...HOME_PAGE, isHome: false };
    if (parseProfileFid(window.location.pathname, window.location.search)) {
      return { ...HOME_PAGE, isHome: false, isUserProfile: true };
    }
    // Never paint HomeView on first frame. Shared casts often launch at
    // homeUrl (`/`); showing home here is the 5–10s flash before the player.
    // Organic launches get HomeView once the deep-link effect confirms there
    // is no embed.
    return { ...HOME_PAGE, isHome: false };
  });
  const [navigationSource, setNavigationSource] = useState<NavigationSource>({
    fromExplore: false,
    fromProfile: false
  });
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
  const [liveActive, setLiveActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isLivePath(window.location.pathname);
  });
  const [liveMaximized, setLiveMaximized] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isLivePath(window.location.pathname);
  });
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
  const likedSnapshotFidRef = useRef<number | null>(null);

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
    const prefetchTabs = () => {
      void import('./views/ExploreView');
      void import('./views/LibraryView');
      void import('./views/ProfileView');
      void import('./views/UserProfileView');
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetchTabs, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(prefetchTabs, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (environment === 'web' && hasPrivyAppId()) return;

    let cancelled = false;
    void (async () => {
      const snapshot = await readLikedNftsSnapshot();
      if (cancelled) return;
      if (snapshot) {
        likedSnapshotFidRef.current = snapshot.fid;
        setLikedNFTs(snapshot.nfts);
        setLikedNFTsLoaded(true);
        return;
      }
      try {
        const mediaKeys = await getLikedMediaKeysCache();
        if (!cancelled && mediaKeys.length > 0) {
          setLikedNFTs(mediaKeys.map((mediaKey) => ({ mediaKey } as NFT)));
        }
      } catch (error) {
        demoLogger.error('Error loading cached likes:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environment]);

  useEffect(() => {
    if (skipEmptyLikeCacheWrite.current && likedNFTs.length === 0) {
      skipEmptyLikeCacheWrite.current = false;
      return;
    }
    skipEmptyLikeCacheWrite.current = false;

    // Reading the cache is async, so the first renders still hold likedNFTs === []
    // while that read is in flight. skipEmptyLikeCacheWrite only absorbs one such
    // render, and `fid` resolving re-runs this effect — so without this guard we'd
    // persist [] and wipe the very cache we're about to read. Only write once the
    // list is real: non-empty, or confirmed loaded as genuinely empty.
    if (likedNFTs.length === 0 && !likedNFTsLoaded) return;

    try {
      const mediaKeys = likedNFTs
        .map((nft) => nft.mediaKey || getMediaKey(nft))
        .filter((key): key is string => Boolean(key));
      void setLikedMediaKeysCache(mediaKeys); // fire-and-forget cache write
    } catch {
      // getMediaKey can throw on a malformed NFT — never break the effect.
    }
    if (!fid) return;
    void writeLikedNftsSnapshot(fid, likedNFTs); // fire-and-forget cache write
  }, [likedNFTs, fid, likedNFTsLoaded]);

  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (isLoadingLikedNFTsRef.current) return;

      if (environment === 'web' && hasPrivyAppId()) {
        if (!webAuthReady) return;
        if (!webAuthenticated) {
          skipEmptyLikeCacheWrite.current = true;
          likedSnapshotFidRef.current = null;
          setLikedNFTs([]);
          setLikedNFTsLoaded(true);
          void clearLikedNftsLocalCache();
          return;
        }
        if (!fid) return;
      }

      if (!fid) {
        setLikedNFTsLoaded(true);
        return;
      }

      if (likedSnapshotFidRef.current != null && likedSnapshotFidRef.current !== fid) {
        likedSnapshotFidRef.current = null;
        setLikedNFTs([]);
        setLikedNFTsLoaded(false);
      } else {
        const snapshot = await readLikedNftsSnapshot();
        if (snapshot && snapshot.fid === fid) {
          likedSnapshotFidRef.current = fid;
          setLikedNFTs(snapshot.nfts);
          setLikedNFTsLoaded(true);
        } else if (likedSnapshotFidRef.current !== fid) {
          setLikedNFTsLoaded(false);
        }
      }

      isLoadingLikedNFTsRef.current = true;
      try {
        const liked = (await getLikedNFTs(fid)).filter(isPlayableMediaNFT);
        likedSnapshotFidRef.current = fid;
        setLikedNFTs(liked);
        void writeLikedNftsSnapshot(fid, liked);
        applyConfirmedPlayback(liked, (updated) => {
          setLikedNFTs(updated);
          void writeLikedNftsSnapshot(fid, updated);
        });
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
  }, [fid, isFidReady, environment, webAuthReady, webAuthenticated]);

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

  // Only subscribe while ExploreView is actually visible — it's the only consumer
  // of recentSearches, and opening a Firestore listener for it on home-screen mount
  // wastes one of the three cold-start network slots for data that may never be seen.
  useEffect(() => {
    if (!fid || !currentPage.isExplore) return;

    const unsubscribe = subscribeToRecentSearches(fid, (searches) => {
      setRecentSearches(searches);
    });

    return unsubscribe;
  }, [fid, currentPage.isExplore]);

  const releaseVideoResources = useCallback(() => {
    const currentId = currentPlayingNFT
      ? `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}`
      : null;

    document.querySelectorAll('video').forEach((video) => {
      if (video.dataset.podplayrLive === '1') return;
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
    const unique = deduplicateNFTsByMediaKey(nfts.map((n) => withFeaturedPlayback(n)));
    setUserNFTs(unique);
    setUserNftsLoading(false);
    applyConfirmedPlayback(unique, setUserNFTs);
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
    return likedNFTs.some((likedNFT) => sameLikedTrack(likedNFT, nft));
  }, [likedNFTs]);

  const onLikeToggle = useCallback(async (nft: NFT): Promise<boolean> => {
    if (!fid) {
      demoLogger.warn('No FID available for like toggle');
      throw new Error('No FID available for like toggle');
    }

    const wasLiked = likedNFTs.some((likedNFT) => sameLikedTrack(likedNFT, nft));
    const likedAt = Date.now();
    const likedNft: NFT = {
      ...nft,
      mediaKey: getMediaKey(nft),
      likedTimestamp: likedAt,
      likedAt: new Date(likedAt).toISOString(),
    };

    // Flip local state first — toggleLikeNFT waits on several Firestore
    // round-trips (legacy merge, variant lookup, writes, then verify reads)
    // so the heart used to sit unchanged until that finished.
    if (wasLiked) {
      setLikedNFTs((prev) => prev.filter((likedNFT) => !sameLikedTrack(likedNFT, nft)));
    } else if (isPlayableMediaNFT(nft)) {
      setLikedNFTs((prev) => [
        likedNft,
        ...prev.filter((existing) => !sameLikedTrack(existing, nft)),
      ]);
    }
    // The heart flips above, but InfoPanel's like *number* reads global_likes
    // and would otherwise lag the icon by the same round-trips.
    emitLikeCountBump(likedNft.mediaKey || getMediaKey(nft), wasLiked ? -1 : 1);

    try {
      const newLikeState = await toggleLikeNFT(nft, fid);
      setLikedNFTs((prev) => {
        if (newLikeState) {
          if (!isPlayableMediaNFT(nft)) return prev;
          if (prev.some((likedNFT) => sameLikedTrack(likedNFT, nft))) return prev;
          return [likedNft, ...prev];
        }
        return prev.filter((likedNFT) => !sameLikedTrack(likedNFT, nft));
      });
      return newLikeState;
    } catch (likeError) {
      setLikedNFTs((prev) => {
        if (wasLiked) {
          if (prev.some((likedNFT) => sameLikedTrack(likedNFT, nft))) return prev;
          return [likedNft, ...prev];
        }
        return prev.filter((likedNFT) => !sameLikedTrack(likedNFT, nft));
      });
      emitLikeCountBump(likedNft.mediaKey || getMediaKey(nft), wasLiked ? 1 : -1);
      demoLogger.error('Error toggling like:', likeError);
      throw likeError;
    }
  }, [fid, likedNFTs]);

  const openLive = useCallback(() => {
    if (isPlaying) handlePlayPause();
    setLiveActive(true);
    setLiveMaximized(true);
  }, [isPlaying, handlePlayPause]);

  const handlePlayNFT = useCallback(async (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => {
    setLiveActive(false);
    setLiveMaximized(false);

    const sameTrack = currentPlayingNFT
      ? getMediaKey(currentPlayingNFT) === getMediaKey(nft)
      : currentlyPlaying === `${nft.contract}-${nft.tokenId}`;

    if (!sameTrack) {
      setIsPlayerMinimized(context?.queueType !== 'suggested-music-videos');
    }

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
    const nextLiked = !isNFTLiked(nft);
    showNotification(nextLiked ? 'like' : 'unlike', nft);
    try {
      await onLikeToggle(nft);
    } catch {
      // Logged inside onLikeToggle; heart already reverted on failure.
    }
  }, [onLikeToggle, showNotification, isNFTLiked]);

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

  const loadNftFromDeepLink = useCallback(async (contract: string, tokenId: string) => {
    try {
      // Claim the screen for the player BEFORE any await. Hosts that launch
      // at homeUrl and hand us the cast URL via location.embed have already
      // rendered HomeView by now (the initial currentPage check only sees
      // window.location), so waiting until the NFT resolves shows the home
      // page and then yanks it away.
      setCurrentPage((prev) => (prev.isHome ? { ...prev, isHome: false } : prev));
      setIsPlayerMinimized(false);
      setLiveActive(false);
      setLiveMaximized(false);

      // Normalize malformed tokenIds from the URL (e.g. "0x0xccf50ef6" → "0xccf50ef6").
      // These arise when the on-chain hex tokenId already has a 0x prefix and the
      // app's owned-NFT pipeline accidentally prepends another one.
      const normalizedTokenId = tokenId.replace(/^(0x){2,}/i, '0x');

      // Exact Featured match first, for ANY contract — some curated entries
      // use a real contract with a placeholder hex tokenId that Alchemy
      // misreads as a different token entirely (see findFeaturedNftByIdentity).
      let nft: NFT | null = findFeaturedNftByIdentity(contract, normalizedTokenId) || null;

      // The NFT page already resolved this on the server (same request as
      // generateMetadata). Reuse it so we don't wait on /api/nft again.
      if (!nft) {
        const boot = readNftBootstrap();
        if (
          boot &&
          boot.contract?.toLowerCase() === contract.toLowerCase() &&
          (normalizeNftTokenId(boot.tokenId) === normalizeNftTokenId(normalizedTokenId) ||
            String(boot.tokenId) === normalizedTokenId)
        ) {
          nft = withFeaturedPlayback(boot);
        }
      }

      // Bootstrap can have a cover + name without playback (the OG card still
      // unfurls). Don't skip /api/nft in that case or the tap dies on HomeView.
      if ((!nft || !isPlayableMediaNFT(nft)) && contract !== 'pending') {
        // URL alone doesn't carry network — race Base and Ethereum and take
        // the first playable result instead of waiting on them in series.
        const fetchNetwork = async (network: 'base' | 'ethereum'): Promise<NFT | null> => {
          try {
            const res = await fetch(
              `/api/nft?contract=${encodeURIComponent(contract)}&tokenId=${encodeURIComponent(normalizedTokenId)}&network=${network}`
            );
            if (!res.ok) return null;
            const data = (await res.json()) as NFT;
            const enriched = withFeaturedPlayback(data);
            if (data?.contract && isPlayableMediaNFT(enriched)) return enriched;
          } catch {
            // try the other network
          }
          return null;
        };
        const fetched = await firstNonNull([fetchNetwork('base'), fetchNetwork('ethereum')]);
        if (fetched) nft = fetched;
      }

      if (!nft) {
        demoLogger.warn('No NFT found for deep link:', contract, tokenId);
        setCurrentPage(HOME_PAGE);
        return;
      }

      const playable = withFeaturedPlayback(nft);
      if (!isPlayableMediaNFT(playable)) {
        demoLogger.warn('Deep-linked NFT is not playable:', contract, tokenId);
        setCurrentPage(HOME_PAGE);
        return;
      }

      // No user gesture at page-load time, so browsers block autoplay outright
      // (NotAllowedError) — load the track paused and let the user's first
      // tap on the play button provide the gesture instead of showing a
      // stuck/"frozen" player.
      await handlePlayAudio(playable, { autoplay: false });
      // Home sits under the maximized player so minimize is the real app,
      // not an empty purple shell. Do this AFTER play is queued or HomeView
      // paints in the gap before currentPlayingNFT exists.
      setCurrentPage(HOME_PAGE);
    } catch (error) {
      demoLogger.error('Error loading NFT from deep link:', error);
      setCurrentPage(HOME_PAGE);
    } finally {
      // The splash is waiting on this so the cast opens straight into the
      // player — release it as soon as the player is queued.
      markDeepLinkSettled();
    }
  }, [handlePlayAudio]);

  // loadNftFromDeepLink's identity changes on every handlePlayAudio call
  // (handlePlayAudio depends on currentlyPlaying/isPlaying, which it sets
  // itself) — depending on it directly re-fires this effect forever: it
  // starts playback, that changes currentlyPlaying, handlePlayAudio gets a
  // new reference, the effect re-runs, sees the NFT already "playing" and
  // calls handlePlayPause() to toggle it, isPlaying flips, another new
  // reference, repeat. Grab the latest fn via a ref and run this exactly
  // once per mount instead.
  const loadNftFromDeepLinkRef = useRef(loadNftFromDeepLink);
  loadNftFromDeepLinkRef.current = loadNftFromDeepLink;
  const deepLinkHandledRef = useRef(false);
  const liveLaunchHandledRef = useRef(
    typeof window !== 'undefined' && isLivePath(window.location.pathname)
  );

  useEffect(() => {
    if (deepLinkHandledRef.current) return;

    // Primary source: window.location (works when Farcaster loads the app at
    // the exact embed URL, which is the spec behaviour for launch_miniapp).
    // Fallback: sdk.context.location.embed / cast.embeds (hosts that open
    // homeUrl and pass the shared NFT URL through launch context).
    const deepLink = parseNftDeepLinkFromLaunch(
      window.location.pathname,
      window.location.search,
      farcasterLocation
    );

    if (!deepLink) {
      // No deep link in the URL. Wait for miniapp context before giving up —
      // a shared cast often lands at homeUrl with location.embed a beat later.
      if (!isFidReady) return;
      if ((environment === 'farcaster' || environment === 'coinbase') && !farcasterLocation) {
        return;
      }
      setCurrentPage(HOME_PAGE);
      markDeepLinkSettled();
      return;
    }
    deepLinkHandledRef.current = true;
    setCurrentPage((prev) => (prev.isHome ? { ...prev, isHome: false } : prev));
    setIsPlayerMinimized(false);
    // handlePlayAudio uses flushSync internally, which React forbids while
    // still inside a lifecycle/commit phase (this effect). Defer to a fresh
    // macrotask so it runs after React is done committing this render.
    // Do not clear this timer on cleanup — farcasterLocation arriving a
    // moment later would cancel the load and leave /nft/:id on a blank
    // page (HomeView is held back until loadNftFromDeepLink's finally).
    window.setTimeout(() => {
      void loadNftFromDeepLinkRef.current(deepLink!.contract, deepLink!.tokenId);
    }, 0);
  }, [farcasterLocation, isFidReady, environment]);

  useEffect(() => {
    if (liveLaunchHandledRef.current) return;
    const fromNotification =
      farcasterLocation?.type === 'notification' &&
      String(farcasterLocation.notification?.notificationId || '').startsWith('live-');
    if (
      !fromNotification &&
      !isLiveLaunch(
        window.location.pathname,
        window.location.search,
        farcasterLocation?.embed
      )
    ) return;
    liveLaunchHandledRef.current = true;
    setLiveActive(true);
    setLiveMaximized(true);
  }, [farcasterLocation]);

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
          onOpenLive={openLive}
          livePlayerActive={liveActive}
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
      {hasPrivyAppId() && environment === 'web' ? (
        <WebPrivyController onOpenReady={bindPrivyOpen} />
      ) : null}
      <BottomNav
        currentView={currentViewKey}
        onViewChange={handleViewChange}
        isPlayerActive={liveActive || !!currentPlayingNFT}
        isPlayerMinimized={liveActive ? !liveMaximized : isPlayerMinimized}
        isAdPlaying={showAd}
        enableProfileDoubleTap={environment === 'web' && hasPrivyAppId()}
        onProfileDoubleTap={() => openPrivyRef.current()}
      />
      {selectedUser && (
        <UserDataLoader
          userFid={selectedUser.fid}
          onNFTsLoaded={handleNFTsLoaded}
          onError={handleUserDataError}
        />
      )}
      {liveActive && (
        <LivePlayer
          isMinimized={!liveMaximized}
          onMinimizeToggle={() => setLiveMaximized((open) => !open)}
        />
      )}
      {(showAd || currentPlayingNFT) && !liveActive && (
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
