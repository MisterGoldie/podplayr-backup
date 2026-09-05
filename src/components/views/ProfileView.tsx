'use client';

import React, { useEffect, useState, useRef, useMemo, useContext } from 'react';
import { useToast } from '../../hooks/useToast';
import Image from 'next/image';
import type { NFT, FarcasterUser } from '../../types/user';
import type { FarcasterUserContext, FarcasterClientContext, FarcasterLocationContext } from '../../app/providers';
import dynamic from 'next/dynamic';
import { getFollowCounts } from '../../lib/firebase/follows';
import { optimizeImage } from '../../utils/imageOptimizer';
import { getMediaKey } from '../../utils/media';
import { filterPlayableMediaNFTs } from '../../utils/isMediaNFT';
import { clearHiddenNfts, getHiddenNftCount, isNftHidden, subscribeToHiddenNfts } from '../../utils/hiddenNfts';
import { useUserImages } from '../../contexts/UserImageContext';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import { UserProfileNFTGrid } from '../nft/UserProfileNFTGrid';
import { getBioText } from '../../utils/format';
import { UserFidContext } from '../../app/providers';
import { BaseAppSignIn } from '../auth/BaseAppSignIn';
import { ShareProfileButton } from '../ShareProfileButton';
import { CommunityPills } from '../user/CommunityPills';

const FollowsModal = dynamic(() => import('../FollowsModal'), { ssr: false });
const PrivacyPolicyModal = dynamic(() => import('../PrivacyPolicyModal'), { ssr: false });

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
  onLikeToggle: (nft: NFT) => Promise<boolean | void>;
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
  followerCount: number;
  followingCount: number;
  countsReady: boolean;
  timestamp: number;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const ProfileView: React.FC<ProfileViewProps> = ({
  farcasterContext,
  handlePlayAudio,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onLikeToggle,
  isNFTLiked: isNFTLikedProp,
  onUserProfileClick
}) => {
  const { walletAddress, fid: contextFid, environment, isFidReady } = useContext(UserFidContext);
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
  const loadingFollowCounts = useRef(false);

  const [allUserNFTs, setAllUserNFTs] = useState<NFT[]>([]);
  const [hiddenRevision, setHiddenRevision] = useState(0);

  useEffect(() => subscribeToHiddenNfts(() => setHiddenRevision((n) => n + 1)), []);
  
  const filteredNFTs = useMemo(() => {
    return filterMediaNFTs(allUserNFTs).filter((nft) => !isNftHidden(nft));
  }, [allUserNFTs, hiddenRevision]);

  const hiddenCount = hiddenRevision >= 0 ? getHiddenNftCount() : 0;

  const combinedError = error;

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
      
      if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        setAllUserNFTs(cached.nfts);
        if (cached.countsReady) {
          setAppFollowerCount(cached.followerCount);
          setAppFollowingCount(cached.followingCount);
        }
        setHasCompletedInitialLoad(true);
        return;
      }
      
      
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


        const nftsWithMediaKey = list.map((nft: NFT) => ({
          ...nft,
          mediaKey: getMediaKey(nft)
        }));
        
        const existing = profileDataCache.get(userFid);
        profileDataCache.set(userFid, {
          nfts: nftsWithMediaKey,
          followerCount: existing?.followerCount ?? 0,
          followingCount: existing?.followingCount ?? 0,
          countsReady: existing?.countsReady ?? false,
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

    loadNFTs();
  }, [userFid, isFidReady, canLoadCollection]);

  useEffect(() => {
    const fetchFollowCounts = async () => {
      const fid = farcasterContext?.user?.fid;
      if (!canLoadCollection || !fid || loadingFollowCounts.current) return;

      const cached = profileDataCache.get(fid);
      const now = Date.now();

      if (cached?.countsReady && (now - cached.timestamp) < CACHE_DURATION) {
        setAppFollowerCount(cached.followerCount);
        setAppFollowingCount(cached.followingCount);
        return;
      }

      loadingFollowCounts.current = true;
      try {
        const { followers, following } = await getFollowCounts(fid);
        setAppFollowerCount(followers);
        setAppFollowingCount(following);

        const existing = profileDataCache.get(fid);
        if (existing) {
          existing.followerCount = followers;
          existing.followingCount = following;
          existing.countsReady = true;
        } else {
          profileDataCache.set(fid, {
            nfts: [],
            followerCount: followers,
            followingCount: following,
            countsReady: true,
            timestamp: now
          });
        }
      } catch (error) {
        console.error('Error fetching follow counts for profile:', error);
        setAppFollowerCount(0);
        setAppFollowingCount(0);
      } finally {
        loadingFollowCounts.current = false;
      }
    };

    void fetchFollowCounts();
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
      const { uploadProfileBackground } = await import('../../firebase');
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
      {showPrivacyPolicy && (
        <PrivacyPolicyModal
          isOpen={showPrivacyPolicy}
          onClose={() => setShowPrivacyPolicy(false)}
        />
      )}
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
              <CommunityPills fid={userFid} className="pb-2" />
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
              isNFTLiked={(nft: NFT) => Boolean(isNFTLikedProp?.(nft))}
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

export default ProfileView;