'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useToast } from '../../hooks/useToast';
import Image from 'next/image';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import type { NFT, UserContext, FarcasterUser } from '../../types/user';
import { getLikedNFTs, getFollowersCount, getFollowingCount, updatePodplayrFollowerCount } from '../../lib/firebase';
import { uploadProfileBackground } from '../../firebase';
import { optimizeImage } from '../../utils/imageOptimizer';
import { getMediaKey } from '../../utils/media';
import { useUserImages } from '../../contexts/UserImageContext';
import NotificationHeader from '../NotificationHeader';
import FollowsModal from '../FollowsModal';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import { useNFTCache } from '../../contexts/NFTCacheContext';

interface ProfileViewProps {
  userContext: UserContext;
  nfts: NFT[];
  handlePlayAudio: (nft: NFT) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  onReset: () => void;
  onNFTsLoaded: (nfts: NFT[]) => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
  onUserProfileClick?: (user: FarcasterUser) => void; // New prop for navigating to user profiles
}

// Helper function to deduplicate NFTs based on mediaKey
const deduplicateNFTsByMediaKey = (nfts: NFT[]): NFT[] => {
  const uniqueNFTs = new Map<string, NFT>();
  
  // Use getMediaKey to ensure we're using the same key generation as elsewhere
  nfts.forEach(nft => {
    const mediaKey = getMediaKey(nft);
    // If this mediaKey hasn't been seen yet, or this NFT has more complete data, keep it
    if (!uniqueNFTs.has(mediaKey) || 
        (!uniqueNFTs.get(mediaKey)?.metadata && nft.metadata)) {
      uniqueNFTs.set(mediaKey, nft);
    }
  });
  
  return Array.from(uniqueNFTs.values());
};

const ProfileView: React.FC<ProfileViewProps> = ({
  userContext,
  nfts,
  handlePlayAudio,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onReset,
  onNFTsLoaded,
  onLikeToggle,
  onUserProfileClick
}) => {
  const [likedNFTs, setLikedNFTs] = useState<NFT[]>([]);
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { backgroundImage, profileImage, setBackgroundImage } = useUserImages();
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  
  // Add state for app-specific follower and following counts
  const [appFollowerCount, setAppFollowerCount] = useState<number>(0);
  const [appFollowingCount, setAppFollowingCount] = useState<number>(0);
  
  // State for follow modal
  const [showFollowsModal, setShowFollowsModal] = useState(false);
  const [followsModalType, setFollowsModalType] = useState<'followers' | 'following'>('followers');

  // Use the NFT cache context
  const { userNFTs: cachedNFTs, isLoading: isCacheLoading, error: cacheError, refreshUserNFTs, lastUpdated } = useNFTCache();
  
  // Combined error state that shows either local error or cache error
  const combinedError = error || cacheError;
  
  // Debug userContext
  console.log('🔍 FULL USER CONTEXT:', JSON.stringify(userContext, null, 2));
  
  // Helper function to check if user is truly logged in
  const isUserLoggedIn = () => {
    // A user is only considered logged in if they have either a valid FID or wallet address
    const hasFid = !!userContext?.user?.fid;
    const hasCustodyAddress = !!userContext?.user?.custody_address;
    const hasWarpcastAddress = !!userContext?.user?.warpcast_address;
    const hasVerifiedAddresses = !!userContext?.user?.verified_addresses?.eth_addresses?.length;
    
    // User is logged in if they have any of these identifiers
    const isLoggedIn = hasFid || hasCustodyAddress || hasWarpcastAddress || hasVerifiedAddresses;
    
    console.log('🔐 Checking if user is logged in:', 
      'Result:', isLoggedIn, 
      'Has userContext.user:', !!userContext?.user, 
      'Has FID:', hasFid, 
      'Has custody address:', hasCustodyAddress,
      'Has warpcast address:', hasWarpcastAddress,
      'Has verified addresses:', hasVerifiedAddresses
    );
    
    return isLoggedIn;
  };

  useEffect(() => {
    const loadNFTs = async () => {
      if (!isUserLoggedIn()) {
        console.log('🚫 No FID found in userContext:', userContext);
        return;
      }
      
      // Safe access to user.fid with null check
      const userFid = userContext?.user?.fid;
      if (!userFid) {
        console.log('🚫 FID is undefined even though user is logged in');
        return;
      }
      
      console.log('🔄 Checking NFT cache for FID:', userFid);
      
      // Check if we need to refresh the cache
      const needsRefresh = !lastUpdated || Date.now() - lastUpdated > 30 * 60 * 1000; // 30 minutes
      
      try {
        setIsLoading(true);
        setError(null);
        
        if (needsRefresh || cachedNFTs.length === 0) {
          console.log('📡 Cache expired or empty, refreshing NFTs...');
          await refreshUserNFTs(userFid);
        } else {
          console.log('✨ Using cached NFTs:', {
            count: cachedNFTs.length,
            lastUpdated: new Date(lastUpdated).toLocaleTimeString()
          });
        }
        
        // Deduplicate NFTs by mediaKey before passing them to the grid
        const deduplicatedNFTs = deduplicateNFTsByMediaKey(cachedNFTs);
        console.log(`Deduplicated ${cachedNFTs.length} NFTs to ${deduplicatedNFTs.length} unique NFTs`);
        
        // Use the deduplicated NFTs
        onNFTsLoaded(deduplicatedNFTs);
      } catch (err) {
        console.error('❌ Error loading NFTs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load NFTs');
      } finally {
        setIsLoading(false);
      }
    };

    console.log('🎯 ProfileView useEffect triggered with FID:', userContext.user?.fid);
    loadNFTs();
  }, [userContext.user?.fid, onNFTsLoaded, cachedNFTs, lastUpdated, refreshUserNFTs]);

  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (userContext?.user?.fid) {
        try {
          const liked = await getLikedNFTs(userContext.user.fid);
          console.log('Loaded liked NFTs for profile view:', liked.length);
          setLikedNFTs(liked);
        } catch (error) {
          console.error('Error loading liked NFTs:', error);
        }
      }
    };

    loadLikedNFTs();
  }, [userContext?.user?.fid]);
  
  // Handle follow status changes to update counts immediately
  const handleFollowStatusChange = (newFollowStatus: boolean, targetFid: number) => {
    // If viewing your own profile, update the following count
    if (userContext?.user?.fid === targetFid) return; // Don't update if the user followed themselves (shouldn't happen)
    
    if (newFollowStatus) {
      // Increment following count when a user follows someone
      setAppFollowingCount(prev => prev + 1);
    } else {
      // Decrement following count when a user unfollows someone
      setAppFollowingCount(prev => Math.max(0, prev - 1));
    }
  };
  
  // Fetch app-specific follower and following counts
  useEffect(() => {
    const fetchFollowCounts = async () => {
      if (userContext?.user?.fid) {
        try {
          // Special case for PODPLAYR account (FID: 1014485)
          // Update the follower count to reflect all users in the system
          if (userContext.user.fid === 1014485) {
            console.log('PODPlayr account detected - updating follower count');
            // Update PODPLAYR follower count based on all users in the system
            const totalUsers = await updatePodplayrFollowerCount();
            setAppFollowerCount(totalUsers);
            setAppFollowingCount(0); // PODPlayr doesn't follow anyone
            console.log(`Updated PODPlayr follower count: ${totalUsers} followers`);
          } else {
            // Regular user - get counts from our app's database
            const followerCount = await getFollowersCount(userContext.user.fid);
            const followingCount = await getFollowingCount(userContext.user.fid);
            
            // Update state with the counts
            setAppFollowerCount(followerCount);
            setAppFollowingCount(followingCount);
            
            console.log(`App follow counts for profile: ${followerCount} followers, ${followingCount} following`);
          }
        } catch (error) {
          console.error('Error fetching follow counts for profile:', error);
          // Reset counts on error
          setAppFollowerCount(0);
          setAppFollowingCount(0);
        }
      }
    };
    
    fetchFollowCounts();
    
    // Set up a refresh interval to keep counts updated
    const intervalId = setInterval(fetchFollowCounts, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(intervalId); // Clean up on unmount
  }, [userContext?.user?.fid]);

  // This function checks if an NFT is liked using the mediaKey approach
  const isNFTLiked = (nft: NFT, ignoreCurrentPage?: boolean): boolean => {
    if (likedNFTs.length === 0) return false;
    
    // Import getMediaKey function if not already imported
    const { getMediaKey } = require('../../utils/media');
    
    // Get the mediaKey for the current NFT
    const nftMediaKey = getMediaKey(nft);
    
    if (!nftMediaKey) {
      console.warn('Could not generate mediaKey for NFT:', nft);
      // Fallback to contract/tokenId comparison if mediaKey can't be generated
      return nft.contract && nft.tokenId ? likedNFTs.some(
        likedNFT => 
          likedNFT.contract === nft.contract && 
          likedNFT.tokenId === nft.tokenId
      ) : false;
    }
    
    // Primary check: Compare mediaKeys for content-based tracking
    const mediaKeyMatch = likedNFTs.some(likedNFT => {
      const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
      return likedMediaKey === nftMediaKey;
    });
    
    // Secondary check: Use contract/tokenId as fallback
    const contractTokenMatch = nft.contract && nft.tokenId ? likedNFTs.some(
      likedNFT => 
        likedNFT.contract === nft.contract && 
        likedNFT.tokenId === nft.tokenId
    ) : false;
    
    // Log for debugging
    if (mediaKeyMatch || contractTokenMatch) {
      console.log(`NFT liked state: mediaKeyMatch=${mediaKeyMatch}, contractTokenMatch=${contractTokenMatch}`, {
        mediaKey: nftMediaKey,
        name: nft.name
      });
    }
    
    // Return true if either match method succeeds
    return mediaKeyMatch || contractTokenMatch;
  };
  
  // State for like notification
  const [showLikeNotification, setShowLikeNotification] = useState(false);
  const [likedNFTName, setLikedNFTName] = useState('');
  const [isLikeAction, setIsLikeAction] = useState(true); // true = like, false = unlike
  
  // Handle like toggle with notification
  const handleNFTLikeToggle = async (nft: NFT) => {
    try {
      // Import getMediaKey function
      const { getMediaKey } = require('../../utils/media');
      
      // Determine if this is a like or unlike action before making the change
      const currentlyLiked = isNFTLiked(nft, true);
      const willBeLiked = !currentlyLiked;
      
      // Get the mediaKey for the current NFT for content-based tracking
      const nftMediaKey = getMediaKey(nft);
      
      console.log(`Toggling like for NFT: ${nft.name}, mediaKey: ${nftMediaKey}, new state: ${willBeLiked ? 'liked' : 'unliked'}`);
      
      // Immediately update the UI state for instant feedback
      if (willBeLiked) {
        // Add to liked NFTs for immediate UI update
        // Add mediaKey to the NFT for easier reference later
        setLikedNFTs(prev => [...prev, {...nft, mediaKey: nftMediaKey}]);
      } else {
        // Remove from liked NFTs for immediate UI update using both methods:
        // 1. First try to filter by mediaKey (primary method, content-based)
        // 2. Then fall back to contract/tokenId if mediaKey matching fails
        setLikedNFTs(prev => {
          // If we have a valid mediaKey, use that first (preferred method)
          if (nftMediaKey) {
            return prev.filter(item => {
              const itemMediaKey = item.mediaKey || getMediaKey(item);
              return itemMediaKey !== nftMediaKey;
            });
          } else {
            // Fall back to contract/tokenId filtering if no mediaKey
            return prev.filter(item => 
              !(item.contract === nft.contract && item.tokenId === nft.tokenId)
            );
          }
        });
      }
      
      // Set notification properties
      setIsLikeAction(willBeLiked);
      setLikedNFTName(nft.name);
      setShowLikeNotification(true);
      
      // Auto-hide notification after 3 seconds
      setTimeout(() => {
        setShowLikeNotification(false);
      }, 3000);
      
      // Call the parent's onLikeToggle function (can happen in background)
      await onLikeToggle(nft);
    } catch (error) {
      console.error('Error toggling like for NFT:', error);
      
      // If there was an error, revert the optimistic UI update
      // by refreshing the liked NFTs
      if (userContext?.user?.fid) {
        try {
          const liked = await getLikedNFTs(userContext.user.fid);
          setLikedNFTs(liked);
        } catch (e) {
          console.error('Error refreshing liked NFTs after error:', e);
        }
      }
    }
  };

  const handleBackgroundUploadSuccess = () => {
    setShowSuccessBanner(true);
    
    // Ensure banner is hidden after the duration
    setTimeout(() => {
      setShowSuccessBanner(false);
    }, 3000);
  };

  return (
    <>
      {/* Add NFTNotification component to ensure notifications work in ProfileView */}
      <NFTNotification onReset={onReset} />
      
      <NotificationHeader
        show={showSuccessBanner}
        onHide={() => setShowSuccessBanner(false)}
        type="success"
        message="Background updated successfully"
        autoHideDuration={3000}
        onReset={onReset}
        onLogoClick={onReset}
      />
      
      {/* Notifications are now handled by the global NFTNotification component */}
      
      {/* Follows Modal */}
      {userContext?.user?.fid && showFollowsModal && (
        <FollowsModal
          isOpen={showFollowsModal}
          onClose={() => setShowFollowsModal(false)}
          userFid={userContext.user.fid}
          type={followsModalType}
          currentUserFid={userContext.user.fid}
          onFollowStatusChange={handleFollowStatusChange}
          onUserProfileClick={onUserProfileClick}
        />
      )}
      <div className="space-y-8 pt-20 pb-48 overflow-y-auto h-screen overscroll-y-contain">
        {/* Profile Header */}
        <div className="relative flex flex-col items-center justify-between text-center p-8 pt-6 pb-4 rounded-3xl mx-4 w-[340px] h-[280px] mx-auto border border-purple-400/20 shadow-xl shadow-purple-900/30 overflow-hidden hover:border-indigo-400/30 transition-all duration-300"
          style={{
            background: backgroundImage 
              ? `url(${backgroundImage}) center/cover no-repeat`
              : 'linear-gradient(to bottom right, rgba(37, 99, 235, 0.4), rgba(147, 51, 234, 0.3), rgba(219, 39, 119, 0.4))'
          }}
        >
          {/* Glow effect */}
          <div className="absolute inset-0 bg-black/30"></div>
          {error && (
            <div className="absolute top-4 left-4 right-4 p-2 bg-red-500/80 text-white text-sm rounded-lg z-20">
              {error}
            </div>
          )}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={async (e) => {
              const input = e.target as HTMLInputElement;
              const files = input.files;
              
              if (!files || files.length === 0) {
                setError('No file selected');
                return;
              }

              const file = files[0];
              if (!userContext?.user?.fid) {
                setError('User not authenticated');
                return;
              }

              if (file.size > 5 * 1024 * 1024) { // 5MB limit
                setError('Image size must be less than 5MB');
                return;
              }

              if (!file.type.startsWith('image/')) {
                setError('Please select an image file');
                return;
              }

              try {
                setError(null);
                setIsUploading(true);
                console.log('Starting upload with file:', {
                  name: file.name,
                  type: file.type,
                  size: file.size
                });

                // Optimize image before upload
                const optimized = await optimizeImage(file);
                console.log('Optimized image:', {
                  width: optimized.width,
                  height: optimized.height,
                  size: optimized.size,
                  reduction: `${Math.round((1 - optimized.size / file.size) * 100)}%`
                });

                // Upload optimized background
                const url = await uploadProfileBackground(userContext.user.fid, optimized.file);
                setBackgroundImage(url);

                // Clear the input and show success state
                input.value = '';
                handleBackgroundUploadSuccess();
              } catch (err) {
                console.error('Error uploading background:', err);
                const errorMessage = err instanceof Error ? err.message : 'Failed to upload background image';
                setError(errorMessage);
                toast?.error(errorMessage);
              } finally {
                setIsUploading(false);
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`absolute top-4 right-4 p-2 rounded-full transition-colors duration-200 z-10 ${isUploading ? 'bg-purple-500/40 cursor-not-allowed' : 'bg-purple-500/20 hover:bg-purple-500/30 cursor-pointer'}`}
            disabled={isUploading}
            title="Change background"
          >
            {isUploading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            )}
          </button>
          {/* Floating music notes */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute text-2xl text-purple-400/30 animate-float-slow top-12 left-8">
              ♪
            </div>
            <div className="absolute text-3xl text-purple-400/25 animate-float-slower top-32 right-12">
              ♫
            </div>
            <div className="absolute text-2xl text-purple-400/20 animate-float-medium top-48 left-16">
              ♩
            </div>
            <div className="absolute text-2xl text-purple-400/35 animate-float-fast right-8 top-24">
              ♪
            </div>
            <div className="absolute text-3xl text-purple-400/15 animate-float-slowest left-24 top-6">
              ♫
            </div>
          </div>
          <div className="relative z-10 mb-auto">
            <div className="rounded-full ring-4 ring-purple-400/20 overflow-hidden w-[120px] h-[120px]">
              {userContext?.user?.username ? (
                <a 
                  href={`https://warpcast.com/${userContext.user.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-full transition-transform hover:scale-105 active:scale-95"
                >
                  <Image
                    src={userContext.user?.pfpUrl || '/default-avatar.png'}
                    alt={userContext.user?.username}
                    width={120}
                    height={120}
                    className="w-full h-full"
                    style={{ objectFit: 'cover' }}
                    priority={true}
                  />
                </a>
              ) : (
                <Image
                  src='/default-avatar.png'
                  alt='User'
                  width={120}
                  height={120}
                  className="w-full h-full"
                  style={{ objectFit: 'cover' }}
                  priority={true}
                />
              )}
            </div>
          </div>
          <div className="space-y-2 relative z-10">
            <div className="bg-black/70 px-3 py-2 rounded-lg inline-block">
              <h2 className="text-2xl font-mono text-purple-400 text-shadow">
                {userContext?.user?.username ? `@${userContext.user.username}` : 'Welcome to PODPLAYR'}
              </h2>
              
              {/* Follower and following counts */}
              {userContext?.user?.fid && (
                <div className="flex items-center gap-2 mt-2 mb-1">
                  <button 
                    onClick={() => {
                      setFollowsModalType('followers');
                      setShowFollowsModal(true);
                    }}
                    className="bg-purple-500/20 hover:bg-purple-500/30 active:bg-purple-500/40 transition-colors rounded-full px-3 py-1 inline-flex items-center"
                  >
                    <span className="font-mono text-xs text-purple-300 font-medium">
                      {appFollowerCount} Followers
                    </span>
                  </button>
                  <button 
                    onClick={() => {
                      setFollowsModalType('following');
                      setShowFollowsModal(true);
                    }}
                    className="bg-purple-500/20 hover:bg-purple-500/30 active:bg-purple-500/40 transition-colors rounded-full px-3 py-1 inline-flex items-center"
                  >
                    <span className="font-mono text-xs text-purple-300 font-medium">
                      {appFollowingCount} Following
                    </span>
                  </button>
                </div>
              )}
              
              {!isLoading && isUserLoggedIn() && (
                <p className="font-mono text-sm text-purple-300/60 text-shadow mt-1">
                  {nfts.length} {nfts.length === 1 ? 'NFT' : 'NFTs'} found
                </p>
              )}
            </div>
          </div>
        </div>

        {/* User's NFTs - Replace with virtualized grid */}
        <div>
          <h2 className="text-2xl font-bold text-green-400 mb-4">Your NFTs</h2>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-6 -mt-6">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-gray-800/30 rounded-full"></div>
                <div className="absolute top-0 w-16 h-16 border-4 border-t-green-400 border-r-green-400 rounded-full animate-spin"></div>
              </div>
              <div className="text-xl font-mono text-green-400 animate-pulse">Loading your NFTs...</div>
            </div>
          ) : !isUserLoggedIn() ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-lg">Double tap the Profile icon to access Profile</p>
            </div>
          ) : combinedError ? (
            <div className="text-center py-12">
              <h3 className="text-xl text-red-400 mb-2">Error Loading NFTs</h3>
              <p className="text-gray-400">{combinedError}</p>
            </div>
          ) : nfts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Custom styling to hide the "All X NFTs loaded" message */}
              <style jsx global>{`
                .grid > .col-span-full:last-child {
                  display: none;
                }
              `}</style>
              
              <VirtualizedNFTGrid 
                nfts={nfts}
                currentlyPlaying={currentlyPlaying}
                isPlaying={isPlaying}
                handlePlayPause={handlePlayPause}
                onPlayNFT={handlePlayAudio}
                publicCollections={[]}
                onLikeToggle={handleNFTLikeToggle}
                isNFTLiked={isNFTLiked}
                userFid={userContext?.user?.fid}
              />
            </div>
          ) : (
            <div className="text-center py-12">
              <h3 className="text-xl text-red-500 mb-2">No Media NFTs Found</h3>
              <p className="text-gray-400">No media NFTs found in your connected wallets</p>
            </div>
          )}
        </div>
        {/* Copyright text - positioned higher on the page */}
        <div className="text-center mt-8 mb-20 text-white/60 text-sm">
          © THEPOD 2025 ALL RIGHTS RESERVED
          <div className="mt-2">
            <button 
              onClick={() => setShowPrivacyPolicy(prev => !prev)} 
              className="text-purple-400/80 hover:text-purple-400 underline text-xs"
            >
              Privacy Policy
            </button>
          </div>
          
          {/* Privacy Policy Modal */}
          {showPrivacyPolicy && (
            <div className="fixed inset-0 bg-black/95 z-50 overflow-y-auto" onClick={() => setShowPrivacyPolicy(false)}>
              <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-3 flex justify-center z-10" onClick={e => e.stopPropagation()}>
                <button 
                  onClick={() => setShowPrivacyPolicy(false)}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-full"
                >
                  Close
                </button>
              </div>
              <div className="max-w-2xl mx-auto bg-gray-900 rounded-lg p-4 my-2 mb-20 overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-gray-900 z-10 border-b border-gray-800 pb-2 mb-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-purple-400">PRIVACY POLICY FOR PODPLAYR</h2>
                    <button 
                      onClick={() => setShowPrivacyPolicy(false)}
                      className="text-white/60 hover:text-white p-2"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="text-left text-sm text-white/80 space-y-4 pr-2">
                  <p className="text-white/60 italic">Effective Date: April 18, 2025</p>
                  
                  <p>POD, LLC ("PODPLAYR," "we," "us," or "our") respects your privacy and is committed to protecting it through our compliance with this Privacy Policy. This Policy describes how we collect, use, disclose, retain, and protect your information when you access or use the PODPLAYR platform (the "Service").</p>
                  
                  <p>By accessing or using the Service, you acknowledge that you have read and understood this Privacy Policy and agree to the collection and use of your information in accordance with it.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">1. Information We Collect</h3>
                  <p>We collect the following types of information:</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(a) Wallet-Linked and Blockchain Data:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Public wallet address and associated NFT/token holdings (on-chain lookups only).</li>
                    <li>Transaction histories, balances, and interactions with the Service linked to your wallet address.</li>
                  </ul>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(b) Technical and Usage Data:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>IP address, browser type, device information, operating system, and access times.</li>
                    <li>Log data, page views, clicks, and session duration.</li>
                    <li>Metadata about NFT content streamed, viewed, or shared.</li>
                  </ul>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(c) Optional Profile and Account Data (if applicable):</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Display name, avatar, bio, preferences, linked social handles.</li>
                  </ul>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(d) Communication and Feedback Data:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Customer support messages, surveys, bug reports, and user-submitted feedback.</li>
                  </ul>
                  
                  <h3 className="text-purple-400 font-bold mt-4">2. How We Use Information</h3>
                  <p>Your data is used to:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Operate, maintain, and improve the functionality of the Service.</li>
                    <li>Personalize content and advertising based on interaction history.</li>
                    <li>Detect and prevent fraudulent activity, abuse, or security breaches.</li>
                    <li>Comply with legal and regulatory obligations.</li>
                    <li>Communicate with users for service-related updates.</li>
                  </ul>
                  
                  <p className="mt-3">We may also use anonymized and aggregated data for statistical, research, or commercial purposes.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">3. Disclosure of Information</h3>
                  <p>We do not sell your personal information. However, we may disclose or share information about you under the following limited circumstances:</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(a) Service Providers and Contractors:</h4>
                  <p>We may disclose personal information to trusted third-party service providers and contractors who perform services on our behalf, such as cloud hosting, data analytics, technical support, customer service, marketing assistance, or security monitoring. These parties are contractually obligated to use your information only as necessary to provide services to us and are prohibited from using or disclosing it for any other purpose.</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(b) Legal Obligations and Government Requests:</h4>
                  <p>We may disclose your information if required to do so by law or in good faith belief that such action is necessary to:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Comply with a legal obligation, court order, or subpoena.</li>
                    <li>Cooperate with regulatory investigations or law enforcement inquiries.</li>
                    <li>Protect and defend our rights, interests, or property, or that of our users or others.</li>
                    <li>Prevent or investigate possible wrongdoing in connection with the Service.</li>
                    <li>Enforce our Terms of Service, or protect against legal liability.</li>
                  </ul>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(c) Business Transfers:</h4>
                  <p>If PODPLAYR is involved in a merger, acquisition, reorganization, sale of assets, or bankruptcy proceeding, your information may be transferred or disclosed as part of that transaction. You will be notified by email and/or a prominent notice on our Service if such a transaction materially affects the way your information is handled.</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(d) Affiliates and Corporate Group:</h4>
                  <p>We may disclose your information to our current or future affiliates, subsidiaries, or other related entities that are under common control or ownership, provided they are subject to this Privacy Policy or privacy protections that are at least as protective.</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(e) Aggregated and De-Identified Information:</h4>
                  <p>We may share aggregated, anonymized, or de-identified data that cannot reasonably be used to identify you. This information may be used for industry analysis, research, marketing, or other business purposes.</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(f) With Your Consent:</h4>
                  <p>We may disclose your personal information to third parties when we have obtained your explicit consent to do so, such as in connection with integrations with external platforms (e.g., wallets, marketplaces) or participation in promotional activities.</p>
                  
                  <p>In all cases, we limit disclosure to the minimum necessary to achieve the intended purpose and ensure, where applicable, that recipients are bound by confidentiality and data protection obligations consistent with this Privacy Policy and applicable laws.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">4. Use of Public Blockchain Data</h3>
                  <p>As a Web3-native platform, PODPLAYR interacts with public blockchains such as Ethereum and other decentralized networks. These blockchains are by design transparent and immutable. Any data recorded on a public blockchain—including your wallet address, transactions, token or NFT ownership, and interaction history—is publicly accessible and cannot be altered or deleted by us.</p>
                  
                  <p>We do not collect or store your private keys, and we never have access to your crypto assets. However, we may read and process publicly available blockchain data for the following purposes:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>To facilitate the delivery of core platform functionality, including playback of NFTs associated with your wallet address.</li>
                    <li>To identify, aggregate, and analyze ownership of digital media content streamed via PODPLAYR.</li>
                    <li>To support search, display, and content personalization features.</li>
                    <li>To prevent abuse, enforce security measures, and support compliance checks.</li>
                  </ul>
                  
                  <p>We may also associate publicly visible wallet activity with non-wallet user data (such as IP address, browser metadata, or account preferences) for personalization, analytics, and platform enhancement purposes. Where this occurs, we treat that associated data as personal data, subject to the rest of this Privacy Policy.</p>
                  
                  <p>It is important to understand that we cannot erase, modify, or restrict access to data stored on decentralized public networks. If you are concerned about the privacy implications of blockchain technology, you should carefully evaluate the risks before linking a wallet to the Service.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">5. Cookies and Tracking Technologies</h3>
                  <p>We use a variety of tracking technologies—including cookies, local storage, web beacons, and similar tools—to collect and store certain information about your interaction with the Service. These technologies help us deliver essential functionality, analyze usage patterns, and improve overall user experience.</p>
                  
                  <h4 className="text-purple-300 font-semibold mt-3">(a) Types of Tracking Technologies We Use:</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Strictly Necessary Cookies: These are required for the operation of the Service and include technologies that enable you to log in, navigate pages, and access secure areas.</li>
                    <li>Functional Cookies: These enable us to remember choices you make, such as your region or language, and provide enhanced functionality.</li>
                    <li>Performance and Analytics Cookies: These collect aggregated data on how users interact with the Service, including which pages are visited most often. This data helps us improve performance and design.</li>
                    <li>Targeting or Advertising Cookies: These may be set by us or third-party advertising partners to build a profile of your interests and show you relevant advertisements across other sites or services.</li>
                  </ul>
                  
                  <h3 className="text-purple-400 font-bold mt-4">6. Data Retention</h3>
                  <p>We retain personal data for as long as it is necessary to fulfill the purposes for which it was collected, as outlined in this Privacy Policy, unless a longer or shorter retention period is required or permitted by applicable law.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">7. Data Security</h3>
                  <p>We take the security of your personal data seriously and are committed to safeguarding it through the implementation of appropriate technical, administrative, and organizational measures. These measures are designed to protect your information against accidental loss, unauthorized access, disclosure, alteration, misuse, or destruction.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">8. Children's Privacy</h3>
                  <p>The Service is not directed at children under 13 (or 16 in some jurisdictions). We do not knowingly collect personal data from children. If we learn that a child has submitted personal information, we will take steps to delete it.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">9. User Rights and Controls</h3>
                  <p>Depending on your jurisdiction, you may have rights under data protection laws, including:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Accessing your information.</li>
                    <li>Correcting inaccurate or incomplete data.</li>
                    <li>Requesting deletion of your data.</li>
                    <li>Objecting to processing or limiting use.</li>
                    <li>Porting your data to another service.</li>
                  </ul>
                  <p>To exercise these rights, contact us at dan41085@gmail.com. We may request identity verification.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">10. International Users and Data Transfers</h3>
                  <p>Our servers may be located in the United States or other jurisdictions where data protection laws may differ from those of your country of residence. By using the Service, you consent to the transfer, storage, and processing of your information in such countries.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">11. Third-Party Services and Links</h3>
                  <p>The PODPLAYR Service may contain links to or integrations with third-party services, platforms, tools, and applications—including but not limited to Farcaster, blockchain wallet providers, NFT marketplaces, content hosts, social platforms, analytics vendors, and advertising networks (collectively, "Third-Party Services"). These Third-Party Services operate independently of PODPLAYR and may have their own privacy policies and terms of use.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">12. Updates to This Policy</h3>
                  <p>We may revise this Privacy Policy at any time. Changes are effective upon posting. We will notify you of material changes via the Service or by email, if applicable.</p>
                  
                  <h3 className="text-purple-400 font-bold mt-4">13. Contact Us</h3>
                  <p>If you have questions or concerns about our data practices, contact us at:</p>
                  <p>Email: dan41085@gmail.com</p>
                  
                  <div className="h-10"></div> {/* Extra space at bottom for mobile */}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ProfileView;