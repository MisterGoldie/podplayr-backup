'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import type { NFT, FarcasterUser } from '../../types/user';
import { getFollowCounts, isUserFollowed, toggleFollowUser } from '../../lib/firebase/follows';
import FollowNotification from '../FollowNotification';
import { useFollowNotification } from '../../hooks/useFollowNotification';
import { filterPlayableMediaNFTs } from '../../utils/isMediaNFT';
import { withFeaturedPlayback } from '../../data/featuredNfts';
import { clearHiddenNfts, getHiddenNftCount, isNftHidden, subscribeToHiddenNfts } from '../../utils/hiddenNfts';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import { useUserProfileBackground } from '../../hooks/useUserProfileBackground';
import { isENSUserObject } from '../../utils/ensUtils';
import { officialAccountDisplayName } from '../../constants/community';
import { CommunityPills } from '../user/CommunityPills';
import { getBioText } from '../../utils/format';
import { ShareProfileButton } from '../ShareProfileButton';
import { USER_PLAY_RECORDED } from '../../lib/playCountEvents';

const FollowsModal = dynamic(() => import('../FollowsModal'), { ssr: false });
const UserInfoPanel = dynamic(() => import('../user/UserInfoPanel'), { ssr: false });

interface UserProfileViewProps {
  user: FarcasterUser;
  nfts: NFT[];
  nftsLoading?: boolean;
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  onUserProfileClick?: (user: FarcasterUser) => void;
  onBack: () => void;
  currentUserFid: number;
  onLikeToggle: (nft: NFT) => Promise<boolean | void>;
  isNFTLiked?: (nft: NFT) => boolean;
}

function formatCount(value?: number) {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

type UserProfileCache = {
  followerCount: number;
  followingCount: number;
  countsReady: boolean;
  isFollowed: boolean;
  followReady: boolean;
  totalPlays: number;
  likedNFTsCount: number;
  statsReady: boolean;
  timestamp: number;
};

let userProfileDataCache = new Map<number, UserProfileCache>();

const USER_PROFILE_CACHE_DURATION = 5 * 60 * 1000;

function getCachedProfile(fid: number) {
  const cached = userProfileDataCache.get(fid);
  if (!cached) return null;
  if (Date.now() - cached.timestamp >= USER_PROFILE_CACHE_DURATION) return null;
  return cached;
}

function writeProfileCache(fid: number, patch: Partial<UserProfileCache>) {
  const existing = userProfileDataCache.get(fid);
  userProfileDataCache.set(fid, {
    followerCount: existing?.followerCount ?? 0,
    followingCount: existing?.followingCount ?? 0,
    countsReady: existing?.countsReady ?? false,
    isFollowed: existing?.isFollowed ?? false,
    followReady: existing?.followReady ?? false,
    totalPlays: existing?.totalPlays ?? 0,
    likedNFTsCount: existing?.likedNFTsCount ?? 0,
    statsReady: existing?.statsReady ?? false,
    ...patch,
    timestamp: Date.now(),
  });
}

const UserProfileView: React.FC<UserProfileViewProps> = ({
  user,
  nfts,
  nftsLoading = false,
  handlePlayAudio,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onUserProfileClick,
  onBack,
  currentUserFid,
  onLikeToggle,
  isNFTLiked
}) => {
  const initialCache = user?.fid ? getCachedProfile(user.fid) : null;
  const [appFollowerCount, setAppFollowerCount] = useState<number>(initialCache?.followerCount ?? 0);
  const [appFollowingCount, setAppFollowingCount] = useState<number>(initialCache?.followingCount ?? 0);
  const [totalPlays, setTotalPlays] = useState<number>(initialCache?.totalPlays ?? 0);
  const [likedNFTsCount, setLikedNFTsCount] = useState<number>(initialCache?.likedNFTsCount ?? 0);
  const [isFollowed, setIsFollowed] = useState<boolean>(initialCache?.isFollowed ?? false);
  const [isFollowingLoading, setIsFollowingLoading] = useState<boolean>(false);
  const [showInfoPanel, setShowInfoPanel] = useState<boolean>(false);
  const { notification, showNotification } = useFollowNotification();
  
  // Fetch the viewed user's background image directly
  const { backgroundImage } = useUserProfileBackground(user?.fid);

  // Extend user with background image if available
  const extendedUser = useMemo(() => {
    return {
      ...user,
      backgroundImage: backgroundImage
    };
  }, [user, backgroundImage]);

  // State for follows modal
  const [showFollowsModal, setShowFollowsModal] = useState(false);
  const [followsModalType, setFollowsModalType] = useState<'followers' | 'following'>('followers');

  // Track previous user FID to detect changes
  const prevUserFidRef = useRef<number | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  
  const [isNFTsLoading, setIsNFTsLoading] = useState<boolean>(false);
  // Track if we've completed at least one full load cycle
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState<boolean>(false);
  const [hiddenRevision, setHiddenRevision] = useState(0);

  useEffect(() => subscribeToHiddenNfts(() => setHiddenRevision((n) => n + 1)), []);
  
  // Filter NFTs to only show playable media (shared detector)
  const filteredNFTs = useMemo(() => {
    if (!nfts || nfts.length === 0) return [];
    const hydrated = nfts.map((n) => withFeaturedPlayback(n));
    return filterPlayableMediaNFTs(hydrated).filter((nft) => !isNftHidden(nft));
  }, [nfts, hiddenRevision]);
  const hiddenCount = getHiddenNftCount();
  
  // Use a ref to track the current user FID for cancellation
  const currentLoadingFidRef = useRef<number | null>(null);
  
  useEffect(() => {
    const nextFid = user?.fid || null;
    if (nextFid === prevUserFidRef.current) return;

    prevUserFidRef.current = nextFid;
    currentLoadingFidRef.current = nextFid;
    setIsNFTsLoading(true);
    setHasCompletedInitialLoad(false);

    const cached = nextFid ? getCachedProfile(nextFid) : null;
    setAppFollowerCount(cached?.followerCount ?? 0);
    setAppFollowingCount(cached?.followingCount ?? 0);
    setTotalPlays(cached?.totalPlays ?? 0);
    setLikedNFTsCount(cached?.likedNFTsCount ?? 0);
    setIsFollowed(cached?.isFollowed ?? false);
  }, [user?.fid]);

  // Handle NFTs loading completion
  useEffect(() => {
    if (nfts === undefined || user?.fid !== currentLoadingFidRef.current) return;

    if (nfts.length > 0) {
      setIsNFTsLoading(false);
      setHasCompletedInitialLoad(true);
      return;
    }

    if (nftsLoading) {
      setIsNFTsLoading(true);
      setHasCompletedInitialLoad(false);
      return;
    }

    const isENSUser = Boolean(user?.fid && user.fid < 0);
    const waitTime = isENSUser ? 10000 : 400;
    const timer = setTimeout(() => {
      if (user?.fid === currentLoadingFidRef.current) {
        setIsNFTsLoading(false);
        setHasCompletedInitialLoad(true);
      }
    }, waitTime);

    return () => clearTimeout(timer);
  }, [nfts, nftsLoading, user?.fid, user?.username]);

  useEffect(() => {
    const targetFid = user?.fid;
    if (!targetFid) return;

    currentLoadingFidRef.current = targetFid;
    const cached = getCachedProfile(targetFid);
    const stillCurrent = () => targetFid === currentLoadingFidRef.current;

    const loadFollowCounts = async () => {
      if (cached?.countsReady) {
        setAppFollowerCount(cached.followerCount);
        setAppFollowingCount(cached.followingCount);
        return;
      }

      try {
        const { followers, following } = await getFollowCounts(targetFid);
        if (!stillCurrent()) return;
        setAppFollowerCount(followers);
        setAppFollowingCount(following);
        writeProfileCache(targetFid, {
          followerCount: followers,
          followingCount: following,
          countsReady: true,
          timestamp: Date.now(),
        });
      } catch (error) {
        if (stillCurrent()) {
          console.error(`Error loading follow counts for ${user?.username} (FID: ${targetFid}):`, error);
        }
      }
    };

    const checkFollowStatus = async () => {
      if (!currentUserFid || currentUserFid === targetFid) return;
      if (cached?.followReady) {
        setIsFollowed(cached.isFollowed);
        return;
      }

      try {
        const followed = await isUserFollowed(currentUserFid, targetFid);
        if (!stillCurrent()) return;
        setIsFollowed(followed);
        writeProfileCache(targetFid, {
          isFollowed: followed,
          followReady: true,
        });
      } catch (error) {
        if (stillCurrent()) {
          console.error(`Error checking follow status for ${user?.username} (FID: ${targetFid}):`, error);
        }
      }
    };

    void loadFollowCounts();
    void checkFollowStatus();
  }, [user?.fid, currentUserFid, user?.username]);

  useEffect(() => {
    const targetFid = user?.fid;
    if (!showInfoPanel || !targetFid) return;

    const cached = getCachedProfile(targetFid);
    if (cached?.statsReady) {
      setTotalPlays(cached.totalPlays);
      setLikedNFTsCount(cached.likedNFTsCount);
    }

    let cancelled = false;
    const loadInfoStats = async () => {
      try {
        const [{ getUserTotalPlays }, { getUserLikedNFTsCount }] = await Promise.all([
          import('../../lib/firebase/plays'),
          import('../../lib/firebase/likes'),
        ]);
        const [plays, liked] = await Promise.all([
          getUserTotalPlays(targetFid),
          getUserLikedNFTsCount(targetFid),
        ]);
        if (cancelled || targetFid !== currentLoadingFidRef.current) return;
        setTotalPlays(plays);
        setLikedNFTsCount(liked);
        writeProfileCache(targetFid, {
          totalPlays: plays,
          likedNFTsCount: liked,
          statsReady: true,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(`Error loading profile stats for ${user?.username} (FID: ${targetFid}):`, error);
        }
      }
    };

    void loadInfoStats();

    const onUserPlay = (event: Event) => {
      const playedFid = String(
        (event as CustomEvent<{ fid?: string }>).detail?.fid || ''
      );
      if (!playedFid || playedFid !== String(targetFid)) return;
      void loadInfoStats();
    };
    window.addEventListener(USER_PLAY_RECORDED, onUserPlay);

    return () => {
      cancelled = true;
      window.removeEventListener(USER_PLAY_RECORDED, onUserPlay);
    };
  }, [showInfoPanel, user?.fid, user?.username]);

  // Handle follow/unfollow
  const handleFollowToggle = async () => {
    if (!currentUserFid || !user || currentUserFid === user.fid) return;
    
    setIsFollowingLoading(true);
    try {
      const newStatus = await toggleFollowUser(currentUserFid, user);
      setIsFollowed(newStatus);
      setAppFollowerCount(prev => {
        const next = newStatus ? prev + 1 : Math.max(0, prev - 1);
        writeProfileCache(user.fid, {
          isFollowed: newStatus,
          followReady: true,
          followerCount: next,
          countsReady: true,
        });
        return next;
      });
      
      if (newStatus) {
        showNotification(`Now following @${user.username}`);
      } else {
        showNotification(`Unfollowed @${user.username}`, 'info');
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
      showNotification('Failed to update follow status', 'error');
    } finally {
      setIsFollowingLoading(false);
    }
  };

  // Handle follow status changes from follows modal
  const handleFollowStatusChange = (newStatus: boolean, targetFid: number) => {
    if (user?.fid === targetFid) {
      setAppFollowerCount(prev => {
        const next = newStatus ? prev + 1 : Math.max(0, prev - 1);
        writeProfileCache(targetFid, { followerCount: next, countsReady: true });
        return next;
      });
    }

    if (currentUserFid === user?.fid) {
      setAppFollowingCount(prev => {
        const next = newStatus ? prev + 1 : Math.max(0, prev - 1);
        writeProfileCache(user.fid, { followingCount: next, countsReady: true });
        return next;
      });
    }
  };

  return (
    <>
      {/* Follows Modal */}
      {user?.fid && showFollowsModal && (
        <FollowsModal
          isOpen={showFollowsModal}
          onClose={() => setShowFollowsModal(false)}
          userFid={user.fid}
          type={followsModalType}
          currentUserFid={currentUserFid}
          onFollowStatusChange={handleFollowStatusChange}
          onUserProfileClick={onUserProfileClick}
        />
      )}
      
      {/* Follow/unfollow toast (distinct from the NFT like/unlike header banner) */}
      {notification.isVisible && (
        <FollowNotification
          message={notification.message}
          type={notification.type}
          isVisible={notification.isVisible}
        />
      )}
      
      <div ref={setScrollRoot} className="page-scroll pt-16 pb-48 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]">
        <div className="relative w-full h-[200px] sm:h-[240px] overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: extendedUser?.backgroundImage
                ? `url(${extendedUser.backgroundImage})`
                : undefined,
            }}
          />
          {!extendedUser?.backgroundImage && (
            <div className="absolute inset-0 bg-gradient-to-br from-purple-800 via-fuchsia-800 to-indigo-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#1E1525] via-[#1E1525]/35 to-black/20" />

          <div className="absolute top-3 left-4 right-4 z-10 flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center text-white bg-black/45 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-full touch-manipulation"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L4.414 9H17a1 1 0 110 2H4.414l5.293 5.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Back
            </button>
            <div className="flex items-center gap-2">
              <ShareProfileButton fid={user?.fid} username={user?.username} />
              <button
                type="button"
                onClick={() => setShowInfoPanel(true)}
                className="bg-black/45 backdrop-blur-md border border-white/15 rounded-full p-2 touch-manipulation"
                aria-label="Show user info"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" width="22" fill="currentColor" className="text-white">
                  <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="relative px-4 -mt-14 mb-8">
          <div className="flex items-end gap-4">
            <div className="relative flex-shrink-0">
              <div className="w-[112px] h-[112px] rounded-full overflow-hidden relative ring-4 ring-[#1E1525] bg-purple-900/40 shadow-xl">
                <Image
                  src={user?.pfp_url || '/default-avatar.png'}
                  alt={officialAccountDisplayName(user?.fid ?? 0, user?.display_name) || user?.username || 'User'}
                  className="object-cover"
                  fill
                  sizes="112px"
                />
              </div>
              {user?.linkedIdentity && (
                <button
                  type="button"
                  className="absolute -top-1 -right-1 bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center border-2 border-[#1E1525] touch-manipulation"
                  onClick={() => {
                    if (user.linkedIdentity?.type === 'farcaster') {
                      const linkedUser: FarcasterUser = {
                        fid: user.linkedIdentity.fid,
                        username: user.linkedIdentity.username,
                        display_name: user.linkedIdentity.display_name,
                        follower_count: 0,
                        following_count: 0,
                      };
                      onUserProfileClick?.(linkedUser);
                    }
                  }}
                  aria-label={`View linked ${user.linkedIdentity.type === 'farcaster' ? 'Farcaster' : 'ENS'} profile`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                </button>
              )}
              {currentUserFid !== user?.fid && (
                <button
                  type="button"
                  onClick={handleFollowToggle}
                  className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-[#1E1525] touch-manipulation ${
                    isFollowed ? 'bg-green-600' : 'bg-purple-600'
                  }`}
                  aria-label={isFollowed ? 'Unfollow' : 'Follow'}
                >
                  {isFollowingLoading ? (
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : isFollowed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pb-2 min-w-0">
              <CommunityPills fid={user?.fid} isEns={isENSUserObject(user)} />
            </div>
          </div>

          <div className="mt-3">
            <h2 className="text-xl font-semibold text-white truncate">
              {officialAccountDisplayName(user?.fid ?? 0, user?.display_name) || user?.username || 'User'}
            </h2>
            {user?.username && (
              <p className={`truncate ${isENSUserObject(user) ? 'text-blue-300' : 'text-white/50'}`}>
                {isENSUserObject(user) ? user.username : `@${user.username}`}
              </p>
            )}
            {getBioText(user?.profile?.bio) ? (
              <p className="text-sm text-white/60 mt-2 line-clamp-3">{getBioText(user?.profile?.bio)}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                setFollowsModalType('followers');
                setShowFollowsModal(true);
              }}
              className="bg-black/40 active:bg-purple-500/20 border border-purple-400/20 rounded-full px-3 py-1.5 touch-manipulation"
            >
              <span className="text-xs text-white/80">
                <span className="text-white font-medium">{formatCount(appFollowerCount)}</span> Followers
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFollowsModalType('following');
                setShowFollowsModal(true);
              }}
              className="bg-black/40 active:bg-purple-500/20 border border-purple-400/20 rounded-full px-3 py-1.5 touch-manipulation"
            >
              <span className="text-xs text-white/80">
                <span className="text-white font-medium">{formatCount(appFollowingCount)}</span> Following
              </span>
            </button>
            {!isNFTsLoading && (
              <span className="text-xs text-white/45 px-1">
                {filteredNFTs.length} {filteredNFTs.length === 1 ? 'media NFT' : 'media NFTs'}
              </span>
            )}
          </div>
        </div>

        {showInfoPanel && (
          <UserInfoPanel
            user={{
              ...user,
              profile: user.profile || { bio: '' },
            }}
            totalPlays={totalPlays}
            likedNFTsCount={likedNFTsCount}
            nftCount={filteredNFTs.length}
            onClose={() => setShowInfoPanel(false)}
          />
        )}

        <div className="container mx-auto px-4">
          <h3 className="text-lg font-semibold mb-3 text-white/90">
            Collection
          </h3>
          
          {/* Display filtered media NFTs */}
          {/* Enhanced loading state check - show loading state during any uncertainty */}
          {nfts === undefined || nfts === null || (nfts.length === 0 && !hasCompletedInitialLoad) ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto border-t-4 border-l-4 border-purple-500 rounded-full animate-spin"></div>
              <p className="mt-4 text-purple-300 font-mono">Loading NFTs...</p>
            </div>
          ) : nfts.length > 0 && filteredNFTs.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <VirtualizedNFTGrid 
                nfts={filteredNFTs}
                onPlayNFT={(nft: NFT) => {
                  // Only allow playing NFTs that belong to this user
                  // Double-check ownership using both the ref and the NFT's ownerFid property
                  if (user?.fid === prevUserFidRef.current && (!nft.ownerFid || nft.ownerFid === user?.fid)) {
                    handlePlayAudio(nft, { queue: filteredNFTs, queueType: 'user' });
                  } else {
                    console.warn('User changed or NFT ownership mismatch, ignoring play request');
                  }
                }}
                currentlyPlaying={currentlyPlaying}
                isPlaying={isPlaying}
                handlePlayPause={handlePlayPause}
                isNFTLiked={isNFTLiked}
                onLikeToggle={onLikeToggle}
                userFid={currentUserFid}
                publicCollections={[]}
                scrollRoot={scrollRoot}
                resetKey={user?.fid}
                showLibraryBadge
              />
            </div>
          ) : nfts.length > 0 && filteredNFTs.length === 0 ? (
            <div className="text-center py-12">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-purple-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p className="mt-4 text-purple-300 font-mono">No media NFTs found</p>
              <p className="mt-2 text-gray-400 text-sm">This user has NFTs but none with audio or video content</p>
            </div>
          ) : nfts && nfts.length === 0 ? (
            <div className="text-center py-12">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-purple-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <p className="mt-4 text-purple-300 font-mono">No NFTs found</p>
              <p className="mt-2 text-gray-400 text-sm">{user?.username || 'This user'} doesn't have any NFTs</p>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto border-t-4 border-l-4 border-purple-500 rounded-full animate-spin"></div>
              <p className="mt-4 text-purple-300 font-mono">Loading NFTs...</p>
            </div>
          )}
          {hiddenCount > 0 ? (
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => clearHiddenNfts()}
                className="text-xs text-white/50 hover:text-white/80 underline touch-manipulation"
              >
                Restore {hiddenCount} hidden {hiddenCount === 1 ? 'NFT' : 'NFTs'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default UserProfileView;
