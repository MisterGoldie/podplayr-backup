'use client';

import React, { useEffect, useState, useRef, useMemo, useContext } from 'react';
import { useToast } from '../../hooks/useToast';
import Image from 'next/image';
import type { NFT, FarcasterUser } from '../../types/user';
import type { FarcasterUserContext, FarcasterClientContext, FarcasterLocationContext } from '../../app/providers';
import { getLikedNFTs, getFollowersCount, getFollowingCount } from '../../lib/firebase';
import { uploadProfileBackground } from '../../firebase';
import { optimizeImage } from '../../utils/imageOptimizer';
import { getMediaKey } from '../../utils/media';
import { filterPlayableMediaNFTs, applyConfirmedPlayback, isPlayableMediaNFT } from '../../utils/isMediaNFT';
import { useUserImages } from '../../contexts/UserImageContext';
import FollowsModal from '../FollowsModal';
import PrivacyPolicyModal from '../PrivacyPolicyModal';
import { useNFTNotification } from '../../context/NFTNotificationContext';
// Remove this import since we're not using the cache
// import { useNFTCache } from '../../contexts/NFTCacheContext';
import { UserProfileNFTGrid } from '../nft/UserProfileNFTGrid';
import { isAcylMember, isOfficialAccount, isPodMember } from '../../constants/community';
import { getBioText } from '../../utils/format';
import { UserFidContext } from '../../app/providers';
import { BaseAppSignIn } from '../auth/BaseAppSignIn';
import { ShareProfileButton } from '../ShareProfileButton';

interface ProfileViewProps {
  farcasterContext: {
    isFarcaster: boolean;
    user: FarcasterUserContext | null;
    client: FarcasterClientContext | null;
    location: FarcasterLocationContext | null;
  };
  nfts: NFT[];
  handlePlayAudio: (nft: NFT, context?: { queue?: NFT[]; queueType?: string }) => Promise<void>;
  isPlaying: boolean;
  currentlyPlaying: string | null;
  handlePlayPause: () => void;
  onNFTsLoaded: (nfts: NFT[]) => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT) => boolean;
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

// Shared playable-media filter (same rules as Alchemy listing)
const filterMediaNFTs = (nfts: NFT[]) => {
  if (!nfts || nfts.length === 0) return [];
  const filtered = filterPlayableMediaNFTs(nfts);
  return filtered;
};

function formatCount(value?: number) {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

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
  onNFTsLoaded,
  onLikeToggle,
  isNFTLiked: isNFTLikedProp,
  onUserProfileClick
}) => {
  const { walletAddress, fid: contextFid, environment, isFidReady } = useContext(UserFidContext);
  const [likedNFTs, setLikedNFTs] = useState<NFT[]>([]);
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { backgroundImage, profileImage, setBackgroundImage } = useUserImages();
  const { showBanner } = useNFTNotification();
  
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
    
    // Any follow/unfollow triggered from this modal is always the current user
    // acting on targetFid, so their own following count always changes.
    setAppFollowingCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
  };
  
  // Debug farcasterContext
  useEffect(() => {
    // Remove this debug log since it's too noisy
    // console.log('🔍 FULL USER CONTEXT:', JSON.stringify(farcasterContext, null, 2));
  }, [farcasterContext]);
  
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
  const userFid = React.useMemo(
    () => farcasterContext.user?.fid || contextFid,
    [farcasterContext.user?.fid, contextFid]
  );

  const canLoadCollection =
    isFidReady &&
    environment !== 'web' &&
    isUserLoggedIn() &&
    Boolean(userFid && userFid > 0);

  useEffect(() => {
    const loadNFTs = async () => {
      if (!isFidReady) return;

      if (!canLoadCollection) {
        setIsLoading(false);
        setHasCompletedInitialLoad(true);
        return;
      }
      
      if (!userFid) {
        setIsLoading(false);
        setHasCompletedInitialLoad(true);
        return;
      }

      // Check cache first
      const cached = profileDataCache.get(userFid);
      const now = Date.now();
      
      if (cached && cached.nfts.length > 0 && (now - cached.timestamp) < CACHE_DURATION) {
        console.log('✅ Using cached profile data for FID:', userFid);
        setAllUserNFTs(cached.nfts);
        setLikedNFTs(cached.likedNFTs.filter(isPlayableMediaNFT));
        setAppFollowerCount(cached.followerCount);
        setAppFollowingCount(cached.followingCount);
        setHasCompletedInitialLoad(true);
        return;
      }
      
      console.log('🔄 Loading all NFTs directly for FID:', userFid);
      
      try {
        setIsLoading(true);
        setError(null);

        const nftsResponse = await fetch(`/api/nfts/by-fid?fid=${userFid}`);
        if (!nftsResponse.ok) {
          const errorText = await nftsResponse.text();
          throw new Error(errorText || 'Failed to fetch NFTs');
        }

        const uniqueNFTs = await nftsResponse.json();
        const list = Array.isArray(uniqueNFTs) ? uniqueNFTs : [];

        console.log(`✅ Fetched ${list.length} unique media NFTs`);

        const nftsWithMediaKey = list.map((nft: NFT) => ({
          ...nft,
          mediaKey: nft.mediaKey || getMediaKey(nft)
        }));
        
        if (nftsWithMediaKey.length > 0) {
          profileDataCache.set(userFid, {
            nfts: nftsWithMediaKey,
            likedNFTs: [],
            followerCount: 0,
            followingCount: 0,
            timestamp: now
          });
        }

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
  }, [userFid, isFidReady, canLoadCollection]);

  // Replace liked NFTs useEffect with cached version:
  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (!canLoadCollection || !farcasterContext?.user?.fid || loadingLikedNFTs.current) return;
      
      const userFid = farcasterContext.user.fid;
      const cached = profileDataCache.get(userFid);
      const now = Date.now();
      
      if (cached && cached.likedNFTs.length > 0 && (now - cached.timestamp) < CACHE_DURATION) {
        console.log('✅ Using cached liked NFTs for FID:', userFid);
        setLikedNFTs(cached.likedNFTs.filter(isPlayableMediaNFT));
        return;
      }
      
      loadingLikedNFTs.current = true;
      try {
        const liked = await getLikedNFTs(userFid);
        console.log('Loaded liked NFTs for profile view:', liked.length);
        setLikedNFTs(liked);
        applyConfirmedPlayback(liked, setLikedNFTs);
        
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
  }, [farcasterContext?.user?.fid, canLoadCollection]);

  // Replace follow counts useEffect with cached version:
  useEffect(() => {
    const fetchFollowCounts = async () => {
      const userFid = farcasterContext?.user?.fid;
      if (!canLoadCollection || !userFid || loadingFollowCounts.current) return;
      
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
    
    if (!canLoadCollection) return;

    const interval = setInterval(fetchFollowCounts, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [farcasterContext?.user?.fid, canLoadCollection]);

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
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

    if (file.size > 5 * 1024 * 1024) {
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
      const optimized = await optimizeImage(file);
      const url = await uploadProfileBackground(farcasterContext.user.fid, optimized.file);
      setBackgroundImage(url);
      input.value = '';
      showBanner('success', 'Background updated successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload background image';
      setError(errorMessage);
      toast?.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
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
      <PrivacyPolicyModal
        isOpen={showPrivacyPolicy}
        onClose={() => setShowPrivacyPolicy(false)}
      />
      <div 
        ref={setScrollRoot}
        className="page-scroll pt-16 pb-48 bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082]"
      >
        <div className="relative w-full h-[200px] sm:h-[240px] overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: backgroundImage
                ? `url(${backgroundImage})`
                : undefined,
            }}
          />
          {!backgroundImage && (
            <div className="absolute inset-0 bg-gradient-to-br from-purple-800 via-fuchsia-800 to-indigo-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#1E1525] via-[#1E1525]/35 to-black/20" />
          {isUploading && <div className="absolute inset-0 bg-black/40" />}

          {userFid ? (
            <div className="absolute top-3 right-4 z-10">
              <ShareProfileButton fid={userFid} username={farcasterContext.user?.username} />
            </div>
          ) : null}

          {error && (
            <div className="absolute top-4 left-4 right-16 p-2 bg-red-500/80 text-white text-sm rounded-lg z-20">
              {error}
            </div>
          )}

          {canLoadCollection ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleBackgroundUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`absolute bottom-4 right-4 z-10 px-3 py-2 rounded-full flex items-center gap-2 text-sm text-white border border-white/20 backdrop-blur-md touch-manipulation ${
                  isUploading ? 'bg-black/50 cursor-not-allowed' : 'bg-black/45 active:bg-black/70'
                }`}
                disabled={isUploading}
                aria-label="Change background"
              >
                {isUploading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {backgroundImage ? 'Edit cover' : 'Add cover'}
              </button>
            </>
          ) : null}
        </div>

        <div className="relative px-4 -mt-14 mb-8">
          <div className="flex items-end gap-4">
            <div className="rounded-full ring-4 ring-[#1E1525] overflow-hidden w-[112px] h-[112px] bg-purple-900/40 flex-shrink-0 shadow-xl">
              {farcasterContext?.user?.username ? (
                <a
                  href={`https://warpcast.com/${farcasterContext.user.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-full active:scale-95"
                >
                  <Image
                    src={cleanImageUrl(farcasterContext.user?.pfp) || profileImage || '/default-avatar.png'}
                    alt={farcasterContext.user?.username || 'User'}
                    width={112}
                    height={112}
                    className="w-full h-full object-cover"
                    priority
                  />
                </a>
              ) : (
                <Image
                  src="/default-avatar.png"
                  alt="User"
                  width={112}
                  height={112}
                  className="w-full h-full object-cover"
                  priority
                />
              )}
            </div>
            {userFid ? (
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                {isPodMember(userFid) && (
                  <span className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full">thepod</span>
                )}
                {isOfficialAccount(userFid) && (
                  <span className="text-[10px] px-2 py-0.5 bg-purple-800/40 text-purple-200 rounded-full">Official</span>
                )}
                {isAcylMember(userFid) && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full text-white/90"
                    style={{
                      background: 'linear-gradient(90deg, rgba(255,0,0,0.25) 0%, rgba(255,154,0,0.25) 40%, rgba(79,220,74,0.25) 100%)',
                    }}
                  >
                    ACYL
                  </span>
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-3">
            <h2 className="text-xl font-semibold text-white truncate">
              {farcasterContext?.user?.displayName || farcasterContext?.user?.username || 'Welcome to PODPLAYR'}
            </h2>
            {farcasterContext?.user?.username && (
              <p className="text-white/50 truncate">@{farcasterContext.user.username}</p>
            )}
            {!farcasterContext?.user?.username && walletAddress && (
              <p className="text-white/50 font-mono text-sm truncate">
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </p>
            )}
            {getBioText(farcasterContext?.user?.bio) ? (
              <p className="text-sm text-white/60 mt-2 line-clamp-3">{getBioText(farcasterContext.user?.bio)}</p>
            ) : null}
            <BaseAppSignIn variant="profile" />
          </div>

          {userFid ? (
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
              {!isLoading && isUserLoggedIn() && (
                <span className="text-xs text-white/45 px-1">
                  {filteredNFTs.length} {filteredNFTs.length === 1 ? 'media NFT' : 'media NFTs'}
                </span>
              )}
            </div>
          ) : null}
        </div>

        <div className="container mx-auto px-4">
          {canLoadCollection ? (
            <h2 className="text-lg font-semibold text-white/90 mb-4">Your collection</h2>
          ) : null}
          {canLoadCollection && (isLoading || !hasCompletedInitialLoad) ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-6 -mt-6">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-purple-900/40 rounded-full"></div>
                <div className="absolute top-0 w-16 h-16 border-4 border-t-purple-400 border-r-purple-400 rounded-full animate-spin"></div>
              </div>
              <div className="text-lg text-purple-200">Loading your collection…</div>
            </div>
          ) : environment === 'web' || !isUserLoggedIn() ? (
            <div className="text-center py-16 px-6">
              <p className="text-lg text-white mb-2">Only available as a mini-app on Farcaster / the Base App</p>
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
                handlePlayAudio(nft, { queue: filteredNFTs, queueType: 'profile' });
              }}
              onLikeToggle={onLikeToggle}
              isNFTLiked={(nft: NFT) => {
                if (isNFTLikedProp) return isNFTLikedProp(nft);
                const mediaKey = getMediaKey(nft);
                return likedNFTs.some(likedNFT => (likedNFT.mediaKey || getMediaKey(likedNFT)) === mediaKey);
              }}
              userFid={farcasterContext?.user?.fid}
              scrollRoot={scrollRoot}
              resetKey={farcasterContext?.user?.fid}
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
          © THEPOD 2026 ALL RIGHTS RESERVED
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPrivacyPolicy(true)}
              className="text-purple-300/80 hover:text-purple-300 underline text-xs touch-manipulation"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// Remove everything after line 896 (lines 898-940)
// The file should end with:

export default ProfileView;