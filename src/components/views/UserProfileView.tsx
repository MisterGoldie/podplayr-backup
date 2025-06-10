'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useToast } from '../../hooks/useToast';
import Image from 'next/image';
import type { NFT, UserContext, FarcasterUser, NFTFile } from '../../types/user';
import { getFollowersCount, getFollowingCount, isUserFollowed, toggleFollowUser, updatePodplayrFollowerCount, PODPLAYR_ACCOUNT, getUserTotalPlays, getUserLikedNFTsCount } from '../../lib/firebase';
import { optimizeImage } from '../../utils/imageOptimizer';
import NotificationHeader from '../NotificationHeader';
import FollowsModal from '../FollowsModal';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import { getMediaKey } from '../../utils/media';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import { logger } from '../../utils/logger';
import { useUserProfileBackground } from '../../hooks/useUserProfileBackground';
import UserInfoPanel from '../user/UserInfoPanel';

interface UserProfileViewProps {
  user: FarcasterUser;
  nfts: NFT[];
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  onReset: () => void;
  onUserProfileClick?: (user: FarcasterUser) => void;
  onBack: () => void;
  currentUserFid: number;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT) => boolean;
}

// Create logger for NFT filtering in profile view
const nftLogger = logger.getModuleLogger('ProfileNFTs');

const UserProfileView: React.FC<UserProfileViewProps> = ({
  user,
  nfts,
  handlePlayAudio,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onReset,
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
  const toast = useToast();
  const nftNotification = useNFTNotification();
  
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
  
  // Add loading state for user data
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);
  // Track if we've completed at least one full load cycle
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState<boolean>(false);
  
  // Filter NFTs to only show media (audio/video) NFTs - moved outside the render function
  const filteredNFTs = useMemo(() => {
    if (!nfts || nfts.length === 0) return [];
    
    const filtered = nfts.filter((nft) => {
      let hasMedia = false;
      
      try {
        // Check for audio in metadata - Same filtering logic as in ExploreView
        const hasAudio = Boolean(nft.hasValidAudio || 
          nft.audio || 
          (nft.metadata?.animation_url && (
            nft.metadata.animation_url.toLowerCase().endsWith('.mp3') ||
            nft.metadata.animation_url.toLowerCase().endsWith('.wav') ||
            nft.metadata.animation_url.toLowerCase().endsWith('.m4a') ||
            // Check for common audio content types
            nft.metadata.animation_url.toLowerCase().includes('audio/') ||
            // Some NFTs store audio in IPFS
            nft.metadata.animation_url.toLowerCase().includes('ipfs')
          )));

        // Check for video in metadata
        const hasVideo = Boolean(nft.isVideo || 
          (nft.metadata?.animation_url && (
            nft.metadata.animation_url.toLowerCase().endsWith('.mp4') ||
            nft.metadata.animation_url.toLowerCase().endsWith('.webm') ||
            nft.metadata.animation_url.toLowerCase().endsWith('.mov') ||
            // Check for common video content types
            nft.metadata.animation_url.toLowerCase().includes('video/')
          )));

        // Also check properties.files if they exist
        const hasMediaInProperties = nft.metadata?.properties?.files?.some((file: any) => {
          if (!file) return false;
          const fileUrl = (file.uri || file.url || '').toLowerCase();
          const fileType = (file.type || file.mimeType || '').toLowerCase();
          
          return fileUrl.endsWith('.mp3') || 
                fileUrl.endsWith('.wav') || 
                fileUrl.endsWith('.m4a') ||
                fileUrl.endsWith('.mp4') || 
                fileUrl.endsWith('.webm') || 
                fileUrl.endsWith('.mov') ||
                fileType.includes('audio/') ||
                fileType.includes('video/');
        }) ?? false;

        hasMedia = hasAudio || hasVideo || hasMediaInProperties;
      } catch (error) {
        console.error('Error checking media types:', error);
      }

      return hasMedia;
    });

    nftLogger.info(`Showing ${filtered.length} media NFTs out of ${nfts.length} total NFTs on profile`);
    return filtered;
  }, [nfts]);
  
  // Use a ref to track the current user FID for cancellation
  const currentLoadingFidRef = useRef<number | null>(null);
  
  // Reset state when user changes
  useEffect(() => {
    // Always set loading state to true when user changes, even if it's null
    // This ensures we show the loading state between user transitions
    setIsDataLoading(true);
    
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
      
      console.log(`User profile changed to: ${user?.username} (FID: ${user?.fid})`); 
    }
  }, [user?.fid, user?.username]);
  
  // Handle NFTs loading completion
  useEffect(() => {
    // If we have a definitive answer about NFTs (either loaded or empty)
    if (nfts !== undefined) {
      // Make sure we're still looking at the same user
      if (user?.fid === currentLoadingFidRef.current) {
        // CRITICAL: Only turn off loading state if we have NFTs or if we're absolutely sure there are none
        // This prevents the "No NFTs" message from showing prematurely
        if (nfts.length > 0) {
          // If we have NFTs, add a small delay to ensure they're fully processed
          setTimeout(() => {
            // Double-check we're still on the same user after the timeout
            if (user?.fid === currentLoadingFidRef.current) {
              setIsDataLoading(false);
              setHasCompletedInitialLoad(true);
              console.log(`${nfts.length} NFTs loaded for ${user?.username} (FID: ${user?.fid}), setting loading state to false and hasCompletedInitialLoad to true`);
            }
          }, 500); // 500ms delay to ensure NFTs have time to fully process
        } else {
          // If there are no NFTs, wait even longer to be absolutely certain
          setTimeout(() => {
            // Triple-check we're still on the same user after the timeout
            if (user?.fid === currentLoadingFidRef.current) {
              setIsDataLoading(false);
              setHasCompletedInitialLoad(true);
              console.log(`No NFTs found for ${user?.username} (FID: ${user?.fid}), setting loading state to false and hasCompletedInitialLoad to true after extended delay`);
            }
          }, 1000); // 1 second delay for empty NFT arrays to be absolutely certain
        }
      }
    }
  }, [nfts, user?.fid, user?.username]);
  
  // Add a safety timeout to prevent infinite loading
  useEffect(() => {
    if (isDataLoading && user?.fid) {
      // Store the current user we're setting the timeout for
      const timeoutFid = user.fid;
      
      // Set a timeout to force loading to false after 5 seconds
      const timeoutId = setTimeout(() => {
        // Only update if we're still on the same user
        if (timeoutFid === currentLoadingFidRef.current) {
          console.log(`Loading timeout reached for ${user.username} (FID: ${user.fid}), forcing loading state to false`);
          setIsDataLoading(false);
          setHasCompletedInitialLoad(true);
        }
      }, 5000); // 5 second timeout
      
      return () => clearTimeout(timeoutId);
    }
  }, [isDataLoading, user?.fid, user?.username]);
  
  // Load follower and following counts
  useEffect(() => {
    // Store the current FID we're loading for
    const targetFid = user?.fid;
    if (!targetFid) return;
    
    // Update the current loading FID
    currentLoadingFidRef.current = targetFid;
    
    // Set loading state
    setIsDataLoading(true);
    
    const loadFollowCounts = async () => {
      // If the user has changed since we started loading, abort
      if (targetFid !== currentLoadingFidRef.current) {
        console.log(`Aborting load for previous user ${user?.username} (FID: ${targetFid}), new user selected`);
        return;
      }
      
      try {
        let followerCount;
        
        // Special handling for PODPlayr account
        if (targetFid === PODPLAYR_ACCOUNT.fid) {
          // Update and get the accurate follower count for PODPlayr
          followerCount = await updatePodplayrFollowerCount();
        } else {
          // Regular follower count for other users
          followerCount = await getFollowersCount(targetFid);
        }
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          console.log(`User changed during follower count fetch, aborting`);
          return;
        }
        
        const followingCount = await getFollowingCount(targetFid);
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          console.log(`User changed during following count fetch, aborting`);
          return;
        }
        
        // Get the user's total play count and liked NFTs count
        const plays = await getUserTotalPlays(targetFid);
        
        // Check if user changed during this async operation
        if (targetFid !== currentLoadingFidRef.current) {
          console.log(`User changed during play count fetch, aborting`);
          return;
        }
        
        const liked = await getUserLikedNFTsCount(targetFid);
        
        // Final check if user changed during any async operation
        if (targetFid !== currentLoadingFidRef.current) {
          console.log(`User changed during liked NFTs count fetch, aborting`);
          return;
        }
        
        // Only update state if this is still the current user
        setAppFollowerCount(followerCount);
        setAppFollowingCount(followingCount);
        setTotalPlays(plays);
        setLikedNFTsCount(liked);
        
        console.log(`App stats for ${user?.username} (FID: ${targetFid}): ${followerCount} followers, ${followingCount} following, ${plays} total plays, ${liked} liked NFTs`);
      } catch (error) {
        // Only show error if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          console.error(`Error loading follow counts for ${user?.username} (FID: ${targetFid}):`, error);
        }
      } finally {
        // Only update loading state if this is still the current user
        if (targetFid === currentLoadingFidRef.current) {
          setIsDataLoading(false);
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
          console.log(`User changed before follow status check, aborting`);
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
      
      // Use showConnectionNotification for user-related notifications
      nftNotification.showConnectionNotification(
        newStatus ? `You are now following @${user.username}` : `You unfollowed @${user.username}`
      );
    } catch (error) {
      console.error('Error toggling follow:', error);
      // Use showConnectionNotification for user-related notifications
      nftNotification.showConnectionNotification('Failed to update follow status');
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
      <NotificationHeader 
        show={true}
        type="profile"
        message={user?.username ? `@${user.username}` : 'User profile'}
        autoHideDuration={3000}
        onReset={onReset}
        onLogoClick={onReset}
      />
      
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
      
      {/* Loading Overlay - only show when data is actually loading */}
      {isDataLoading && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 border-t-4 border-l-4 border-purple-500 rounded-full animate-spin"></div>
            <p className="mt-4 text-purple-300 font-mono">Loading {user?.username}'s profile...</p>
          </div>
        </div>
      )}
      <div className="space-y-8 pt-20 pb-48 overflow-y-auto h-screen overscroll-y-contain">
        {/* Profile Header with Back Button */}
        <div 
          className="border-b border-purple-500/20 shadow-md relative" 
          style={{
            background: extendedUser?.backgroundImage 
              ? `url(${extendedUser.backgroundImage}) center/cover no-repeat` 
              : 'linear-gradient(to bottom, rgba(126, 34, 206, 0.5), #000)'
          }}
        >
          {/* No overlay for better background image visibility */}
          <div className="container mx-auto px-4 py-6 relative z-10">
            {/* Top navigation bar with back button and info button */}
            <div className="flex justify-between items-center mb-4">
              {/* Back button */}
              <button 
                onClick={onBack}
                className="flex items-center text-purple-300 hover:text-purple-100 transition-colors bg-black/60 px-3 py-1 rounded-full"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L4.414 9H17a1 1 0 110 2H4.414l5.293 5.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
                Back
              </button>
              
              {/* Info button */}
              <button 
                onClick={() => setShowInfoPanel(true)}
                className="bg-black/70 hover:bg-black/80 active:bg-black/90 transition-colors rounded-full p-2 inline-flex items-center justify-center"
                aria-label="Show user info"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor" className="text-purple-300">
                  <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
                </svg>
              </button>
            </div>

            <div className="flex items-start md:items-center flex-col md:flex-row gap-6">
              <div className="relative">
                <div className="w-28 h-28 rounded-full overflow-hidden flex-shrink-0 relative ring-4 ring-purple-500/50 shadow-xl shadow-black/50 border-2 border-white/10">
                  <Image
                    src={user?.pfp_url || `/default-avatar.png`}
                    alt={user?.display_name || user?.username || 'User'}
                    className="object-cover"
                    fill
                    sizes="80px"
                  />
                </div>
                
                {/* Linked Identity Indicator */}
                {user?.linkedIdentity && (
                  <div 
                    className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center cursor-pointer shadow-md border-2 border-blue-400/30 hover:bg-blue-400 transition-all duration-200"
                    onClick={() => {
                      // Navigate to the linked identity profile
                      if (user.linkedIdentity?.type === 'farcaster') {
                        // Use the onUserProfileClick prop to navigate to the linked Farcaster profile
                        const linkedUser: FarcasterUser = {
                          fid: user.linkedIdentity.fid,
                          username: user.linkedIdentity.username,
                          display_name: user.linkedIdentity.display_name,
                          follower_count: 0,
                          following_count: 0
                        };
                        onUserProfileClick?.(linkedUser);
                      }
                    }}
                    title={`View linked ${user.linkedIdentity.type === 'farcaster' ? 'Farcaster' : 'ENS'} profile`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                    </svg>
                  </div>
                )}
                {currentUserFid !== user?.fid && (
                  <div 
                    onClick={handleFollowToggle}
                    className={`absolute -bottom-1 -right-1 w-7 h-7 ${isFollowed ? 'bg-green-600 hover:bg-green-500' : 'bg-purple-600 hover:bg-purple-500'} rounded-full flex items-center justify-center shadow-lg border-2 ${isFollowed ? 'border-green-400/30' : 'border-purple-400/30'} transition-all duration-200 cursor-pointer transform hover:scale-110 active:scale-95`}
                  >
                    {isFollowingLoading ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : isFollowed ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                <div className="bg-black/70 px-3 py-2 rounded-lg inline-block">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-mono text-green-400 truncate">@{user?.username}</h2>
                    {/* Show ENS badge if username or display_name ends with .eth */}
                    {(user?.username?.toLowerCase().endsWith('.eth') || user?.display_name?.toLowerCase().endsWith('.eth')) && (
                      <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full font-mono shadow-glow-sm animate-pulse-subtle flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 293.5 293.5" className="w-3 h-3 mr-1 fill-current">
                          <path d="M147.1 0C65.9 0 0 65.9 0 147.1s65.9 147.1 147.1 147.1 147.1-65.9 147.1-147.1S228.3 0 147.1 0zm0 270.9c-68.4 0-123.8-55.4-123.8-123.8S78.7 23.3 147.1 23.3s123.8 55.4 123.8 123.8-55.4 123.8-123.8 123.8z"/>
                          <path d="M147.1 52.9 41.9 146.3l105.2 62.2 105.2-62.2z"/>
                        </svg>
                        ENS
                      </span>
                    )}
                  </div>
                  {user?.display_name && (
                    <p className="text-lg text-white font-semibold">{user.display_name}</p>
                  )}
                </div>
                
                {/* App-specific follower and following counts */}
                <div className="flex items-center gap-2 mb-2">
                  <button 
                    onClick={() => {
                      setFollowsModalType('followers');
                      setShowFollowsModal(true);
                    }}
                    className="bg-black/60 hover:bg-purple-900/60 active:bg-purple-900/80 transition-all duration-200 rounded-full px-4 py-1.5 inline-flex items-center border border-purple-500/20 shadow-md hover:shadow-purple-500/10 transform hover:scale-105 active:scale-100"
                  >
                    <span className="font-mono text-xs text-purple-200 font-medium">
                      {appFollowerCount} Followers
                    </span>
                  </button>
                  <button 
                    onClick={() => {
                      setFollowsModalType('following');
                      setShowFollowsModal(true);
                    }}
                    className="bg-black/60 hover:bg-purple-900/60 active:bg-purple-900/80 transition-all duration-200 rounded-full px-4 py-1.5 inline-flex items-center border border-purple-500/20 shadow-md hover:shadow-purple-500/10 transform hover:scale-105 active:scale-100"
                  >
                    <span className="font-mono text-xs text-purple-200 font-medium">
                      {appFollowingCount} Following
                    </span>
                  </button>
                </div>
                

                
                {/* User Info Panel */}
                {showInfoPanel && (
                  <UserInfoPanel
                    user={{
                      ...user,
                      // Ensure user always has a profile object with bio
                      profile: user.profile || { bio: "" }
                    }}
                    totalPlays={totalPlays}
                    likedNFTsCount={likedNFTsCount}
                    nftCount={nfts ? nfts.filter(nft => {
                      // Apply the same media filter to the count
                      let hasMedia = false;
                      try {
                        const hasAudio = Boolean(nft.hasValidAudio || 
                          nft.audio || 
                          (nft.metadata?.animation_url && (
                            nft.metadata.animation_url.toLowerCase().endsWith('.mp3') ||
                            nft.metadata.animation_url.toLowerCase().endsWith('.wav') ||
                            nft.metadata.animation_url.toLowerCase().endsWith('.m4a') ||
                            nft.metadata.animation_url.toLowerCase().includes('audio/') ||
                            nft.metadata.animation_url.toLowerCase().includes('ipfs')
                          )));
                        const hasVideo = Boolean(nft.isVideo || 
                          (nft.metadata?.animation_url && (
                            nft.metadata.animation_url.toLowerCase().endsWith('.mp4') ||
                            nft.metadata.animation_url.toLowerCase().endsWith('.webm') ||
                            nft.metadata.animation_url.toLowerCase().endsWith('.mov') ||
                            nft.metadata.animation_url.toLowerCase().includes('video/')
                          )));
                        const hasMediaInProperties = nft.metadata?.properties?.files?.some((file: any) => {
                          if (!file) return false;
                          const fileUrl = (file.uri || file.url || '').toLowerCase();
                          const fileType = (file.type || file.mimeType || '').toLowerCase();
                          return fileUrl.endsWith('.mp3') || fileUrl.endsWith('.wav') || fileUrl.endsWith('.m4a') ||
                                fileUrl.endsWith('.mp4') || fileUrl.endsWith('.webm') || fileUrl.endsWith('.mov') ||
                                fileType.includes('audio/') || fileType.includes('video/');
                        }) ?? false;
                        hasMedia = hasAudio || hasVideo || hasMediaInProperties;
                      } catch (error) {
                        console.error('Error checking media types in count:', error);
                      }
                      return hasMedia;
                    }).length : 0}
                    onClose={() => setShowInfoPanel(false)}
                  />
                )}
                
                {/* Badges in a separate container */}
                <div className="bg-black/70 px-3 py-2 rounded-lg inline-block">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* THEPOD badge */}
                    {user?.fid && [15019, 7472, 14871, 414859, 235025, 892616, 323867, 892130].includes(user.fid) && (
                      <span className="text-xs font-mono px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full flex items-center">
                        thepod
                      </span>
                    )}
                    
                    {/* ACYL badge */}
                    {user?.fid && [7472, 14871, 414859, 356115, 296462, 195864, 1020224, 1020659].includes(user.fid) && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full flex items-center font-semibold" 
                            style={{ 
                              background: 'linear-gradient(90deg, rgba(255,0,0,0.2) 0%, rgba(255,154,0,0.2) 25%, rgba(208,222,33,0.2) 50%, rgba(79,220,74,0.2) 75%, rgba(63,218,216,0.2) 100%)', 
                              color: '#f0f0f0',
                              textShadow: '0 0 2px rgba(0,0,0,0.5)'
                            }}>
                        ACYL
                      </span>
                    )}
                    
                    {/* Official badge for PODPlayr account */}
                    {user?.fid === PODPLAYR_ACCOUNT.fid && (
                      <span className="text-xs font-mono px-2 py-0.5 bg-purple-800/40 text-purple-300 rounded-full flex items-center font-semibold">
                        Official
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* NFT Gallery */}
        <div className="container mx-auto px-4">
          <h3 className="text-xl font-semibold mb-3 font-mono text-green-400">
            Media NFTs
          </h3>
          
          {/* Display filtered media NFTs */}
          {/* Enhanced loading state check - show loading state during any uncertainty */}
          {isDataLoading || nfts === undefined || nfts === null || (nfts.length === 0 && !hasCompletedInitialLoad) ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto border-t-4 border-l-4 border-purple-500 rounded-full animate-spin"></div>
              <p className="mt-4 text-purple-300 font-mono">Loading NFTs...</p>
            </div>
          ) : nfts.length > 0 && filteredNFTs.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Custom styling to hide the "All X NFTs loaded" message */}
              <style jsx global>{`
                .grid > .col-span-full:last-child {
                  display: none;
                }
              `}</style>
              
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
