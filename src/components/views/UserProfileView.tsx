'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Image from 'next/image';
import type { NFT, FarcasterUser } from '../../types/user';
import { getFollowersCount, getFollowingCount, isUserFollowed, toggleFollowUser, getUserTotalPlays, getUserLikedNFTsCount } from '../../lib/firebase';
import FollowsModal from '../FollowsModal';
import FollowNotification from '../FollowNotification';
import { useFollowNotification } from '../../hooks/useFollowNotification';
import { filterPlayableMediaNFTs } from '../../utils/isMediaNFT';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import { logger } from '../../utils/logger';
import { useUserProfileBackground } from '../../hooks/useUserProfileBackground';
import UserInfoPanel from '../user/UserInfoPanel';
import { isENSUserObject } from '../../utils/ensUtils';
import { officialAccountDisplayName } from '../../constants/community';
import { CommunityPills } from '../user/CommunityPills';
import { getBioText } from '../../utils/format';
import { ShareProfileButton } from '../ShareProfileButton';

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
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT) => boolean;
}

// Create logger for NFT filtering in profile view
const nftLogger = logger.getModuleLogger('ProfileNFTs');

function formatCount(value?: number) {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

let userProfileDataCache = new Map<string, {
  userData: FarcasterUser;
  followerCount: number;
  followingCount: number;
  totalPlays: number;
  likedNFTsCount: number;
  isFollowed: boolean;
  timestamp: number;
}>();

const USER_PROFILE_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes

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
  const [appFollowerCount, setAppFollowerCount] = useState<number>(0);
  const [appFollowingCount, setAppFollowingCount] = useState<number>(0);
  const [totalPlays, setTotalPlays] = useState<number>(0);
  const [likedNFTsCount, setLikedNFTsCount] = useState<number>(0);
  const [isFollowed, setIsFollowed] = useState<boolean>(false);
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
  
  // Add loading state for user data
  const [isUserStatsLoading, setIsUserStatsLoading] = useState<boolean>(false);
  const [isNFTsLoading, setIsNFTsLoading] = useState<boolean>(false);
  // Track if we've completed at least one full load cycle
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState<boolean>(false);
  
  // Filter NFTs to only show playable media (shared detector)
  const filteredNFTs = useMemo(() => {
    if (!nfts || nfts.length === 0) return [];
    const filtered = filterPlayableMediaNFTs(nfts);
    nftLogger.info(`Showing ${filtered.length} media NFTs out of ${nfts.length} total NFTs on profile`);
    return filtered;
  }, [nfts]);
  
  // Use a ref to track the current user FID for cancellation
  const currentLoadingFidRef = useRef<number | null>(null);
  
  // Reset state when user changes
  useEffect(() => {
    // Set both loading states when user changes
    setIsUserStatsLoading(true);
    setIsNFTsLoading(true);
    
    // If user FID changed, reset all state values
    if (user?.fid !== prevUserFidRef.current) {
      // Store the new FID
      prevUserFidRef.current = user?.fid || null;
      
      // Update the current loading FID to the new user
      currentLoadingFidRef.current = user?.fid || null;
      
      // Reset all counts and states
      setAppFollowerCount(0);
      setAppFollowingCount(0);
      setTotalPlays(0);
      setLikedNFTsCount(0);
      setIsFollowed(false);
      
 
    }
  }, [user?.fid, user?.username]);

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

  // Load follower and following counts
  useEffect(() => {
    // Store the current FID we're loading for
    const targetFid = user?.fid;
    if (!targetFid) return;
    
    // Update the current loading FID
    currentLoadingFidRef.current = targetFid;
    
    // Set user stats loading state
    setIsUserStatsLoading(true);
    
    const loadFollowCounts = async () => {
      // If the user has changed since we started loading, abort
      if (targetFid !== currentLoadingFidRef.current) {
        return;
      }
      
      try {
        // getFollowersCount now reads a cached counter (O(1) after the first
        // computation) for every user, PODPlayr included — no more special-cased
        // full recount on every profile view.
        const followerCount = await getFollowersCount(targetFid);
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          return;
        }
        
        const followingCount = await getFollowingCount(targetFid);
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          return;
        }
        
        // Get the user's total play count and liked NFTs count
        const plays = await getUserTotalPlays(targetFid);
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          return;
        }
        
        const liked = await getUserLikedNFTsCount(targetFid);
        
        // Final check if user changed during any async operation
        if (targetFid !== currentLoadingFidRef.current) {
          return;
        }
        
        // Only update state if this is still the current user
        setAppFollowerCount(followerCount);
        setAppFollowingCount(followingCount);
        setTotalPlays(plays);
        setLikedNFTsCount(liked);
        
      } catch (error) {
        // Only show error if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          console.error(`Error loading follow counts for ${user?.username} (FID: ${targetFid}):`, error);
        }
      } finally {
        // Only update loading state if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          setIsUserStatsLoading(false);
        }
      }
    };

    // Check if current user follows this user
    const checkFollowStatus = async () => {
      const targetFid = user?.fid;
      if (!currentUserFid || !targetFid || currentUserFid === targetFid) return;
      
      try {
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          return;
        }
        
        const followed = await isUserFollowed(currentUserFid, targetFid);
        
        // Only update state if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          setIsFollowed(followed);
        }
      } catch (error) {
        // Only show error if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          console.error(`Error checking follow status for ${user?.username} (FID: ${targetFid}):`, error);
        }
      }
    };

    // Start loading data
    loadFollowCounts();
    checkFollowStatus();
  }, [user?.fid, currentUserFid, user?.username]);

  // Handle follow/unfollow
  const handleFollowToggle = async () => {
    if (!currentUserFid || !user || currentUserFid === user.fid) return;
    
    setIsFollowingLoading(true);
    try {
      const newStatus = await toggleFollowUser(currentUserFid, user);
      setIsFollowed(newStatus);
      
      // Update follower count immediately in UI
      setAppFollowerCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
      
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
    // Update follower count if this is the viewed user
    if (user?.fid === targetFid) {
      setAppFollowerCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
    }
    
    // If the current user is viewed, update their following count
    if (currentUserFid === user?.fid) {
      setAppFollowingCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
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
      
      {/* Loading Overlay - show when either user stats OR NFTs are loading */}
      {(isUserStatsLoading || isNFTsLoading) && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 border-t-4 border-l-4 border-purple-500 rounded-full animate-spin"></div>
            <p className="mt-4 text-purple-300 font-mono">
              Loading {isNFTsLoading ? 'NFTs' : 'profile'}...
            </p>
          </div>
        </div>
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
        </div>
      </div>
    </>
  );
};

export default UserProfileView;
