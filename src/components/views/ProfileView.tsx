'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useToast } from '../../hooks/useToast';
import Image from 'next/image';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import type { NFT, FarcasterUser } from '../../types/user';
import type { FarcasterUserContext, FarcasterClientContext, FarcasterLocationContext } from '../../app/providers';
import { getLikedNFTs, getFollowersCount, getFollowingCount, updatePodplayrFollowerCount } from '../../lib/firebase';
import { uploadProfileBackground } from '../../firebase';
import { optimizeImage } from '../../utils/imageOptimizer';
import { getMediaKey } from '../../utils/media';
import { useUserImages } from '../../contexts/UserImageContext';
import NotificationHeader from '../NotificationHeader';
import FollowsModal from '../FollowsModal';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
// Remove this import since we're not using the cache
// import { useNFTCache } from '../../contexts/NFTCacheContext';
import { UserProfileNFTGrid } from '../nft/UserProfileNFTGrid';

interface ProfileViewProps {
  farcasterContext: {
    isFarcaster: boolean;
    user: FarcasterUserContext | null;
    client: FarcasterClientContext | null;
    location: FarcasterLocationContext | null;
  };
  nfts: NFT[];
  handlePlayAudio: (nft: NFT) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  onReset: () => void;
  onNFTsLoaded: (nfts: NFT[]) => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
  onUserProfileClick?: (user: FarcasterUser) => void;
}

// Helper function to deduplicate NFTs based on mediaKey
// Remove this entire function (lines 40-54)
// const deduplicateNFTsByMediaKey = (nfts: NFT[]): NFT[] => {
//   const uniqueNFTs = new Map<string, NFT>();
//   
//   nfts.forEach(nft => {
//     const mediaKey = getMediaKey(nft);
//     if (!uniqueNFTs.has(mediaKey) || 
//         (!uniqueNFTs.get(mediaKey)?.metadata && nft.metadata)) {
//       uniqueNFTs.set(mediaKey, nft);
//     }
//   });
//   
//   return Array.from(uniqueNFTs.values());
// };

// Add this helper function at the top of the ProfileView component, after the imports and before the component function
const cleanImageUrl = (url: string | undefined): string => {
  if (!url) return '/default-avatar.png';
  
  // Remove backticks, extra spaces, and trim
  return url
    .replace(/[`]/g, '') // Remove all backticks
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim(); // Remove leading/trailing whitespace
};

// Add the permissive filtering function (same as UserProfileView)
const filterMediaNFTs = (nfts: NFT[]) => {
  if (!nfts || nfts.length === 0) return [];
  
  const filtered = nfts.filter((nft) => {
    let hasMedia = false;
    
    try {
      // Check for audio in metadata - Same filtering logic as in UserProfileView
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

  console.log(`ProfileView: Showing ${filtered.length} media NFTs out of ${nfts.length} total NFTs`);
  return filtered;
};

// Add session-level caching variables at the top of the file, after imports
let profileDataCache = new Map<number, {
  nfts: NFT[];
  likedNFTs: NFT[];
  followerCount: number;
  followingCount: number;
  timestamp: number;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const ProfileView: React.FC<ProfileViewProps> = ({
  farcasterContext,
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
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
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

  // Move useRef hooks to top level of component
  const loadingLikedNFTs = useRef(false);
  const loadingFollowCounts = useRef(false);

  // Replace NFT cache with direct NFT state
  const [allUserNFTs, setAllUserNFTs] = useState<NFT[]>([]);
  
  // Apply permissive filtering to all NFTs
  const filteredNFTs = useMemo(() => {
    return filterMediaNFTs(allUserNFTs);
  }, [allUserNFTs]);

  // Remove NFT cache usage - we're not using it anymore
  // const { userNFTs: cachedNFTs, isLoading: isCacheLoading, error: cacheError, refreshUserNFTs, lastUpdated } = useNFTCache();
  
  // Combined error state that shows either local error or cache error
  const combinedError = error; // Remove cacheError since we're not using cache

  // Add this function to handle follow status changes from the modal
  const handleFollowStatusChange = (newStatus: boolean, targetFid: number) => {
    // Update follower count if this is the viewed user (current user's profile)
    if (farcasterContext?.user?.fid === targetFid) {
      setAppFollowerCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
    }
    
    // If the current user is viewing their own profile, update their following count
    if (farcasterContext?.user?.fid === farcasterContext?.user?.fid) {
      setAppFollowingCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
    }
  };
  
  // Debug farcasterContext
  useEffect(() => {
    // Remove this debug log since it's too noisy
    // console.log('🔍 FULL USER CONTEXT:', JSON.stringify(farcasterContext, null, 2));
  }, [farcasterContext]);
  
  // Add this useEffect for debugging state updates
  useEffect(() => {
    console.log('🔍 ProfileView state update:', {
      userFid: farcasterContext?.user?.fid,
      username: farcasterContext?.user?.username,
      showFollowsModal,
      followsModalType,
      appFollowerCount,
      appFollowingCount
    });
  }, [farcasterContext?.user?.fid, showFollowsModal, followsModalType, appFollowerCount, appFollowingCount]);
  
  // Helper function to check if user is truly logged in
  // Move the useRef hook to the component body (top level)
  const prevLoggedFid = useRef<number | undefined>(undefined);
  
  const isUserLoggedIn = () => {
    const user = farcasterContext.user;
    const hasFid = !!user?.fid && user.fid > 0;
    const hasUsername = !!user?.username;
    const hasDisplayName = !!user?.displayName;
    const isLoggedIn = hasFid || hasUsername || hasDisplayName;
    
    // Only log once per user change, not on every call
    // Remove the useRef call from here since it's now at component level
    if (user?.fid !== prevLoggedFid.current) {
      console.log('🔐 User login status changed:', isLoggedIn);
      prevLoggedFid.current = user?.fid;
    }
    
    return isLoggedIn;
  };

  // Add this before the useEffect
  const userFid = React.useMemo(() => farcasterContext.user?.fid, [farcasterContext.user?.fid]);

  // Replace the NFT loading useEffect with cached version:
  useEffect(() => {
    const loadNFTs = async () => {
      if (!isUserLoggedIn()) {
        console.log('🚫 No FID found in farcasterContext:', farcasterContext);
        return;
      }
      
      if (!userFid) {
        console.log('🚫 FID is undefined even though user is logged in');
        return;
      }

      // Check cache first
      const cached = profileDataCache.get(userFid);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        console.log('✅ Using cached profile data for FID:', userFid);
        setAllUserNFTs(cached.nfts);
        setLikedNFTs(cached.likedNFTs);
        setAppFollowerCount(cached.followerCount);
        setAppFollowingCount(cached.followingCount);
        setHasCompletedInitialLoad(true);
        return;
      }
      
      console.log('🔄 Loading all NFTs directly for FID:', userFid);
      
      try {
        setIsLoading(true);
        setError(null);
        
        const { fetchUserNFTsFromAlchemy } = await import('../../lib/nft');
        
        // FIX: Use the correct function from firebase.ts to get user data
        const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
        if (!neynarKey) throw new Error('Neynar API key not found');

        // Fetch user profile directly from Neynar API
        const profileResponse = await fetch(
          `https://api.neynar.com/v2/farcaster/user/bulk?fids=${userFid}`,
          {
            headers: {
              'accept': 'application/json',
              'api_key': neynarKey
            }
          }
        );

        if (!profileResponse.ok) {
          throw new Error('Failed to fetch user profile');
        }

        const profileData = await profileResponse.json();
        const userData = profileData.users?.[0];
        
        if (!userData) {
          console.log('❌ No user data found for FID:', userFid);
          setAllUserNFTs([]);
          setHasCompletedInitialLoad(true);
          return;
        }
        
        // Get addresses from user data
        const addresses: string[] = [];
        
        // Add verified addresses - FIX: Handle different address structures
        if (userData.verified_addresses?.eth_addresses) {
          addresses.push(...userData.verified_addresses.eth_addresses);
        } else if (userData.verifications) {
          addresses.push(...userData.verifications);
        }
        
        // Add custody address if available
        if (userData.custody_address) {
          addresses.push(userData.custody_address);
        }
        
        console.log(`📍 Found ${addresses.length} addresses for user:`, addresses);
        
        if (addresses.length === 0) {
          console.log('❌ No addresses found for user');
          setAllUserNFTs([]);
          setHasCompletedInitialLoad(true);
          return;
        }
        
        // Fetch all NFTs from all addresses - Use raw Alchemy data instead
        const allNFTsPromises = addresses.map(async (address) => {
          console.log(`🔍 Fetching NFTs for address: ${address}`);
          const nfts = await fetchUserNFTsFromAlchemy(address);
          console.log(`📦 Address ${address} returned ${nfts.length} NFTs`);
          return nfts;
        });
        
        const allNFTsArrays = await Promise.all(allNFTsPromises);
        const allNFTs = allNFTsArrays.flat();
        
        console.log(`🎯 Raw NFT fetch results:`, {
          totalAddresses: addresses.length,
          nftArrays: allNFTsArrays.map((arr, i) => ({ address: addresses[i], count: arr.length })),
          totalNFTs: allNFTs.length
        });
        
        // Deduplicate by contract and tokenId - FIX: Use correct property access
        const uniqueNFTs = Array.from(
          new Map(allNFTs.map(nft => [`${nft.contract}-${nft.tokenId}`, nft])).values()
        );
        
        console.log(`✅ Fetched ${allNFTs.length} total NFTs, ${uniqueNFTs.length} unique NFTs`);
        
        // Generate mediaKey for NFTs that don't have it
        const nftsWithMediaKey = uniqueNFTs.map(nft => ({
          ...nft,
          mediaKey: nft.mediaKey || getMediaKey(nft)
        }));
        
        // After successful loading, cache the results
        profileDataCache.set(userFid, {
          nfts: nftsWithMediaKey,
          likedNFTs: [], // Will be populated by liked NFTs effect
          followerCount: 0, // Will be populated by follow counts effect
          followingCount: 0, // Will be populated by follow counts effect
          timestamp: now
        });
        
        setAllUserNFTs(nftsWithMediaKey);
        setHasCompletedInitialLoad(true);
        
      } catch (err) {
        console.error('❌ Error loading NFTs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load NFTs');
        setHasCompletedInitialLoad(true);
      } finally {
        setIsLoading(false);
      }
    };

    console.log('🎯 ProfileView useEffect triggered with FID:', userFid);
    loadNFTs();
  }, [userFid]);

  // Replace liked NFTs useEffect with cached version:
  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (!farcasterContext?.user?.fid || loadingLikedNFTs.current) return;
      
      const userFid = farcasterContext.user.fid;
      const cached = profileDataCache.get(userFid);
      const now = Date.now();
      
      if (cached && cached.likedNFTs.length > 0 && (now - cached.timestamp) < CACHE_DURATION) {
        console.log('✅ Using cached liked NFTs for FID:', userFid);
        setLikedNFTs(cached.likedNFTs);
        return;
      }
      
      loadingLikedNFTs.current = true;
      try {
        const liked = await getLikedNFTs(userFid);
        console.log('Loaded liked NFTs for profile view:', liked.length);
        setLikedNFTs(liked);
        
        // Update cache
        if (cached) {
          cached.likedNFTs = liked;
        }
      } catch (error) {
        console.error('Error loading liked NFTs:', error);
      } finally {
        loadingLikedNFTs.current = false;
      }
    };

    loadLikedNFTs();
  }, [farcasterContext?.user?.fid]);

  // Replace follow counts useEffect with cached version:
  useEffect(() => {
    const fetchFollowCounts = async () => {
      const userFid = farcasterContext?.user?.fid;
      if (!userFid || loadingFollowCounts.current) return;
      
      const cached = profileDataCache.get(userFid);
      const now = Date.now();
      
      if (cached && cached.followerCount > 0 && (now - cached.timestamp) < CACHE_DURATION) {
        console.log('✅ Using cached follow counts for FID:', userFid);
        setAppFollowerCount(cached.followerCount);
        setAppFollowingCount(cached.followingCount);
        return;
      }
      
      loadingFollowCounts.current = true;
      try {
        const followerCount = await getFollowersCount(userFid);
        const followingCount = await getFollowingCount(userFid);
        setAppFollowerCount(followerCount);
        setAppFollowingCount(followingCount);
        
        // Update cache
        if (cached) {
          cached.followerCount = followerCount;
          cached.followingCount = followingCount;
        }
      } catch (error) {
        console.error('Error fetching follow counts for profile:', error);
        setAppFollowerCount(0);
        setAppFollowingCount(0);
      } finally {
        loadingFollowCounts.current = false;
      }
    };

    fetchFollowCounts();
    
    // Keep the interval for periodic updates but make it less frequent
    const interval = setInterval(fetchFollowCounts, 10 * 60 * 1000); // 10 minutes
    return () => clearInterval(interval);
  }, [farcasterContext?.user?.fid]);

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
      {farcasterContext?.user?.fid && showFollowsModal && (
        <FollowsModal
          isOpen={showFollowsModal}
          onClose={() => setShowFollowsModal(false)}
          userFid={farcasterContext.user.fid}
          type={followsModalType}
          currentUserFid={farcasterContext.user.fid}
          onFollowStatusChange={handleFollowStatusChange}
          onUserProfileClick={onUserProfileClick}
        />
      )}
      <div 
        className="space-y-8 pt-20 pb-48 overflow-y-auto h-screen overscroll-y-contain min-h-screen bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]"
      >
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
              if (!farcasterContext?.user?.fid) {
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
                const url = await uploadProfileBackground(farcasterContext.user.fid, optimized.file);
                setBackgroundImage(url);

                // Clear the input and show success state
                input.value = '';
                setShowSuccessBanner(true);
                setTimeout(() => setShowSuccessBanner(false), 3000);
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
              {farcasterContext?.user?.username ? (
                <a 
                  href={`https://warpcast.com/${farcasterContext.user.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-full transition-transform hover:scale-105 active:scale-95"
                >
                  <Image
                    src={cleanImageUrl(farcasterContext.user?.pfp) || profileImage || '/default-avatar.png'}
                    alt={farcasterContext.user?.username || 'User'}
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
                {farcasterContext?.user?.username ? `@${farcasterContext.user.username}` : 'Welcome to PODPLAYR'}
              </h2>
              
              {/* Follower and following counts */}
              {farcasterContext?.user?.fid && (
                <div className="flex items-center gap-2 mt-2 mb-1">
                  <button 
                    onClick={() => {
                      console.log('🔥 FOLLOWERS BUTTON CLICKED in ProfileView!');
                      console.log('📊 Current modal state:', { showFollowsModal, followsModalType });
                      console.log('📊 User context:', farcasterContext?.user);
                      setFollowsModalType('followers');
                      setShowFollowsModal(true);
                      console.log('📊 After setState - should show followers modal');
                    }}
                    className="bg-purple-500/20 hover:bg-purple-500/30 active:bg-purple-500/40 transition-colors rounded-full px-3 py-1 inline-flex items-center"
                  >
                    <span className="font-mono text-xs text-purple-300 font-medium">
                      {appFollowerCount} Followers
                    </span>
                  </button>
                  <button 
                    onClick={() => {
                      console.log('🔥 FOLLOWING BUTTON CLICKED in ProfileView!');
                      console.log('📊 Current modal state:', { showFollowsModal, followsModalType });
                      console.log('📊 User context:', farcasterContext?.user);
                      setFollowsModalType('following');
                      setShowFollowsModal(true);
                      console.log('📊 After setState - should show following modal');
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
                  {filteredNFTs.length} {filteredNFTs.length === 1 ? 'Media NFT' : 'Media NFTs'} found
                </p>
              )}
            </div>
          </div>
        </div>

        {/* User's NFTs - Replace with virtualized grid */}
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-green-400 mb-4">Your NFTs</h2>
          {/* Enhanced loading state check - show loading state during any uncertainty */}
          {(() => {
            const shouldShowLoading = (isLoading || (filteredNFTs.length === 0 && !hasCompletedInitialLoad));
            return shouldShowLoading;
          })() ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-6 -mt-6">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-gray-800/30 rounded-full"></div>
                <div className="absolute top-0 w-16 h-16 border-4 border-t-green-400 border-r-green-400 rounded-full animate-spin"></div>
              </div>
              <div className="text-xl font-mono text-green-400 animate-pulse">Loading your NFTs...</div>
            </div>
          ) : !isUserLoggedIn() ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-lg">ONLY AVAILABLE AS A MINI-APP ON FARCASTER/THE BASE APP</p>
            </div>
          ) : combinedError ? (
            <div className="text-center py-12">
              <h3 className="text-xl text-red-400 mb-2">Error Loading NFTs</h3>
              <p className="text-gray-400">{combinedError}</p>
            </div>
          ) : filteredNFTs.length > 0 ? (  // ✅ Check filteredNFTs instead
            <UserProfileNFTGrid 
              nfts={filteredNFTs}  // ✅ Pass filteredNFTs instead
              currentlyPlaying={currentlyPlaying}
              isPlaying={isPlaying}
              handlePlayPause={handlePlayPause}
              onPlayNFT={(nft: NFT) => {
                handlePlayAudio(nft);
              }}
              onLikeToggle={onLikeToggle}
              isNFTLiked={(nft: NFT) => likedNFTs.some(likedNFT => likedNFT.id === nft.id)}
              userFid={farcasterContext?.user?.fid}
            />
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

// Remove everything after line 896 (lines 898-940)
// The file should end with:

export default ProfileView;