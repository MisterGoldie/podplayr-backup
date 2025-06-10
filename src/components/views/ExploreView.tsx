'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useVirtualizedNFTs } from '../../hooks/useVirtualizedNFTs';
import FollowsModal from '../FollowsModal';
import { SearchBar } from '../search/SearchBar';
import { VirtualizedNFTGrid } from '../nft/VirtualizedNFTGrid';
import Image from 'next/image';
import { NFT, FarcasterUser, SearchedUser } from '../../types/user';
import { getDoc, doc } from 'firebase/firestore';
import { db, trackUserSearch, isUserFollowed, toggleFollowUser, getFollowersCount, getFollowingCount } from '../../lib/firebase';
import { useContext } from 'react';
import { FarcasterContext, UserFidContext } from '../../app/providers';
import NotificationHeader from '../NotificationHeader';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import LocalConnectionNotification from '../LocalConnectionNotification';
import ConnectionHeader from '../ConnectionHeader';
import { useConnection } from '../../context/ConnectionContext';
import { useNFTLike } from '../../hooks/useNFTLike';

// Hardcoded list of FIDs for users who should have "thepod" badge
const POD_MEMBER_FIDS = [15019, 7472, 14871, 414859, 235025, 892616, 323867, 892130];

// PODPLAYR official account FID
const PODPLAYR_OFFICIAL_FID = 1014485;

interface ExploreViewProps {
  onSearch: (query: string) => void;
  selectedUser: FarcasterUser | null;
  onPlayNFT: (nft: NFT) => void;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  searchResults: FarcasterUser[];
  nfts: NFT[];
  isSearching: boolean;
  handlePlayPause: () => void;
  isLoadingNFTs: boolean;
  onBack: () => void;
  publicCollections: string[];
  addToPublicCollection?: (nft: NFT, collectionId: string) => void;
  removeFromPublicCollection?: (nft: NFT, collectionId: string) => void;
  recentSearches: SearchedUser[];
  handleUserSelect: (user: FarcasterUser) => void;
  handleDirectUserSelect: (user: FarcasterUser) => void;
  onReset: () => void;
  onLikeToggle?: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT, ignoreCurrentPage?: boolean) => boolean;
  userFid?: number;
  userNFTs: NFT[];
  searchType: string;
  searchParam: string;
  likedNFTs?: NFT[]; // Add likedNFTs to allow component to track like changes
}

const ExploreView: React.FC<ExploreViewProps> = (props) => {
  // Get FID from context, but prioritize the one passed in props if available
  const { isFarcaster } = useContext(FarcasterContext);
  const { fid: contextFid } = useContext(UserFidContext);
  
  // Use the FID from props if available, otherwise use the one from context
  const effectiveUserFid = props.userFid || contextFid || 0;

  // Get NFT notification context
  const nftNotification = useNFTNotification();

  const {
    onSearch,
    selectedUser,
    onPlayNFT,
    currentlyPlaying,
    isPlaying,
    searchResults,
    nfts,
    isSearching,
    handlePlayPause,
    isLoadingNFTs,
    onBack,
    publicCollections,
    addToPublicCollection,
    removeFromPublicCollection,
    recentSearches,
    handleUserSelect,
    handleDirectUserSelect,
    onReset,
    onLikeToggle,
    isNFTLiked,
    userNFTs,
    searchType,
    searchParam,
    likedNFTs,
  } = props;

  // Add state variable for shared NFTs count
  const [sharedNFTsCount, setSharedNFTsCount] = useState(0);
  const checkCompleted = useRef(false);

  // Add this state variable
  const [hasLikedNFTs, setHasLikedNFTs] = useState(false);

  // Add this code at the top of your ExploreView component, near other state variables
  const [hasSharedNFTs, setHasSharedNFTs] = useState(false);
  const [username, setUsername] = useState('');

  // Remove the old showBanner state as we're using the NFTNotification system now
  // Add state to force refresh of grid when like status changes
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Add state to track followed users
  const [followedUsers, setFollowedUsers] = useState<Record<number, boolean>>({});
  
  // Add state for app-specific follower and following counts
  const [appFollowerCount, setAppFollowerCount] = useState<number>(0);
  const [appFollowingCount, setAppFollowingCount] = useState<number>(0);
  
  // State for follows modal
  const [showFollowsModal, setShowFollowsModal] = useState(false);
  const [followsModalType, setFollowsModalType] = useState<'followers' | 'following'>('followers');
  
  // Fetch app-specific follower and following counts when a user is selected
  useEffect(() => {
    const fetchFollowCounts = async () => {
      if (selectedUser && selectedUser.fid) {
        try {
          // Get the counts from our app's database
          const followerCount = await getFollowersCount(selectedUser.fid);
          const followingCount = await getFollowingCount(selectedUser.fid);
          
          // Update state with the counts
          setAppFollowerCount(followerCount);
          setAppFollowingCount(followingCount);
          
          // Special logging for PODPlayr - this is our primary PODPlayr account
          if (selectedUser.username === 'podplayr') {
            console.log(`App follow counts for ${selectedUser.username}: ${followerCount} followers (total app users), ${followingCount} following`);
          } else {
            console.log(`App follow counts for ${selectedUser.username}: ${followerCount} followers, ${followingCount} following`);
          }
        } catch (error) {
          console.error('Error fetching follow counts:', error);
          // Reset counts on error
          setAppFollowerCount(0);
          setAppFollowingCount(0);
        }
      } else {
        // Reset counts when no user is selected
        setAppFollowerCount(0);
        setAppFollowingCount(0);
      }
    };
    
    fetchFollowCounts();
  }, [selectedUser]);

  // This effect was for the old banner system, which has been replaced with the NFTNotification system

  // Add effect to check for shared NFTs when viewing a profile
  useEffect(() => {
    console.log("BANNER DEBUG - searchType:", searchType);
    console.log("BANNER DEBUG - searchParam:", searchParam);
    console.log("BANNER DEBUG - nfts count:", nfts?.length);
    console.log("BANNER DEBUG - userNFTs count:", userNFTs?.length);
    
    // Only proceed if we have the data we need
    if (!nfts || !userNFTs || nfts.length === 0 || userNFTs.length === 0) {
      console.log("BANNER DEBUG - Missing data, not showing banner");
      return;
    }
    
    // Count shared NFTs with explicit logging
    let matches = 0;
    const userNFTKeys = userNFTs
      .filter(nft => nft?.contract && nft?.tokenId)
      .map(nft => `${nft.contract.toLowerCase()}-${nft.tokenId}`);
    
    console.log("BANNER DEBUG - User has", userNFTKeys.length, "valid NFT keys");
    
    for (const nft of nfts) {
      if (nft?.contract && nft?.tokenId) {
        const key = `${nft.contract.toLowerCase()}-${nft.tokenId}`;
        if (userNFTKeys.includes(key)) {
          matches++;
          console.log("BANNER DEBUG - Match found:", nft.name);
        }
      }
    }
    
    console.log("BANNER DEBUG - Total matches found:", matches);
    setSharedNFTsCount(matches);
  }, [nfts, userNFTs, searchType, searchParam]);

  // Add this effect to check if ANY NFT is liked
  useEffect(() => {
    if (searchType === 'user' && nfts.length > 0 && isNFTLiked) {
      // Check each NFT to see if ANY of them are liked
      let foundLiked = false;
      
      for (const nft of nfts) {
        if (isNFTLiked(nft)) {
          console.log(`FOUND LIKED NFT: ${nft.name}`);
          foundLiked = true;
          break; // Stop checking once we find at least one
        }
      }
      
      console.log(`Has liked NFTs from this creator: ${foundLiked}`);
      setHasLikedNFTs(foundLiked);
    }
  }, [nfts, isNFTLiked, searchType]);

  // Add this useEffect that runs ONLY when NFTs load or username changes
  useEffect(() => {
    // Reset the check flag when user changes
    if (searchParam) {
      checkCompleted.current = false;
      setSharedNFTsCount(0);
    }
    
    // Only run this if we have NFTs and haven't checked yet
    if (searchType === 'user' && nfts.length > 0 && !checkCompleted.current) {
      console.log(`🔍 CHECKING ${nfts.length} NFTs FOR LIKED STATUS...`);
      
      // Delay the check slightly to ensure everything is loaded
      setTimeout(() => {
        let likedCount = 0;
        
        // Check each NFT
        for (const nft of nfts) {
          // Make sure isNFTLiked is available and the NFT is valid
          if (isNFTLiked && nft && nft.contract && nft.tokenId) {
            const isLiked = isNFTLiked(nft);
            if (isLiked) {
              console.log(`✅ FOUND LIKED NFT: ${nft.name}`);
              likedCount++;
            }
          }
        }
        
        console.log(`📊 FINAL COUNT: ${likedCount} liked NFTs from ${searchParam}`);
        setSharedNFTsCount(likedCount);
        
        // Mark that we've completed this check
        checkCompleted.current = true;
      }, 1000); // 1 second delay
    }
  }, [nfts, searchParam, searchType, isNFTLiked]);

  // Add this useEffect to reset hasSharedNFTs when loading starts
  useEffect(() => {
    // Reset hasSharedNFTs whenever loading starts
    if (isLoadingNFTs) {
      setHasSharedNFTs(false);
    }
  }, [isLoadingNFTs]);

  const generateUniqueNFTKey = (nft: NFT, index: number) => {
    return `${nft.contract}-${nft.tokenId}-${index}`;
  };

  const clearSearch = () => {
    onSearch(""); // Clear the search query
  };

  // Use the NFT like hook
  const { handleLike, handleUnlike } = useNFTLike({
    onLikeToggle: onLikeToggle || (async () => {
      // If no onLikeToggle is provided, use the default behavior
      if (!effectiveUserFid) return;
      // You can add default like behavior here if needed
    }),
    setIsLiked: (liked) => {
      // Force a refresh of the grid when like status changes
      setRefreshTrigger(prev => prev + 1);
    }
  });

  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-gray-800/30 rounded-full"></div>
          <div className="absolute top-0 w-16 h-16 border-4 border-t-green-400 border-r-green-400 rounded-full animate-spin"></div>
        </div>
        <div className="text-xl font-mono text-green-400 animate-pulse">Searching...</div>
      </div>
    );
  }

  // Update the handleLikeToggle function to use the hook
  const handleLikeToggle = async (nft: NFT) => {
    if (!effectiveUserFid) return;
    
    if (isNFTLiked && isNFTLiked(nft)) {
      await handleUnlike(nft);
    } else {
      await handleLike(nft);
    }
  };

  // Add effect to force re-render when liked NFTs change
  useEffect(() => {
    if (likedNFTs) {
      console.log('ExploreView: likedNFTs changed, triggering refresh');
      setRefreshTrigger(prev => prev + 1);
    }
  }, [likedNFTs]);
  
  // Check if users are followed when search results or selected user changes
  useEffect(() => {
    const checkFollowStatus = async () => {
      if (!effectiveUserFid) return;
      
      const newFollowedUsers: Record<number, boolean> = {};
      
      // Check follow status for search results
      if (searchResults && searchResults.length > 0) {
        for (const user of searchResults) {
          if (user.fid) {
            const isFollowed = await isUserFollowed(effectiveUserFid, user.fid);
            newFollowedUsers[user.fid] = isFollowed;
          }
        }
      }
      
      // Check follow status for selected user
      if (selectedUser && selectedUser.fid) {
        const isFollowed = await isUserFollowed(effectiveUserFid, selectedUser.fid);
        newFollowedUsers[selectedUser.fid] = isFollowed;
      }
      
      // Check follow status for recent searches
      if (recentSearches && recentSearches.length > 0) {
        for (const user of recentSearches) {
          if (user.fid) {
            const isFollowed = await isUserFollowed(effectiveUserFid, user.fid);
            newFollowedUsers[user.fid] = isFollowed;
          }
        }
      }
      
      setFollowedUsers(newFollowedUsers);
    };
    
    checkFollowStatus();
  }, [searchResults, selectedUser, recentSearches, effectiveUserFid]);
  
  // Handle follow/unfollow button click
  const handleFollowToggle = async (user: FarcasterUser, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!effectiveUserFid || !user.fid) return;
    
    // Prevent users from following themselves
    if (effectiveUserFid === user.fid) {
      console.log('Cannot follow yourself');
      return;
    }
    
    try {
      const isNowFollowed = await toggleFollowUser(effectiveUserFid, user);
      
      // Update local state for follow button
      setFollowedUsers(prev => ({
        ...prev,
        [user.fid]: isNowFollowed
      }));
      
      // Immediately update follower/following counts in the UI
      if (selectedUser && selectedUser.fid === user.fid) {
        // If this is the selected user, update their follower count
        setAppFollowerCount(prev => isNowFollowed ? prev + 1 : Math.max(0, prev - 1));
      }
      
      // If the current user is selected, update their following count
      if (selectedUser && selectedUser.fid === effectiveUserFid) {
        setAppFollowingCount(prev => isNowFollowed ? prev + 1 : Math.max(0, prev - 1));
      }
      
      console.log(`User ${isNowFollowed ? 'followed' : 'unfollowed'}: ${user.username}`);
      console.log('Updated follower/following counts in UI');
    } catch (error) {
      console.error('Error toggling follow status:', error);
    }
  };
  
  // Get the NFT notification context
  const { showConnectionNotification, hideNotification } = useNFTNotification();
  
  // Get the connection context for direct control
  const { setShowConnectionHeader, setConnectionUsername, setConnectionLikedCount } = useConnection();
  
  // Track previous selected user to prevent infinite loops
  const prevSelectedUserRef = useRef<number | null>(null);
  
  // Reset connection state when search starts or user changes
  useEffect(() => {
    // Always reset when search starts or user changes
    console.log('🔄 Reset connection header - search state or user changed');
    setShowConnectionHeader(false);
    setConnectionUsername('');
    setConnectionLikedCount(0);
    
    // Also clean up any global window variables
    if (typeof window !== 'undefined') {
      // These might be causing persistence issues
      if ((window as any).__hideConnectionNotification) {
        console.log('🧹 Cleaning up global notification handler');
        (window as any).__hideConnectionNotification();
      }
    }
  }, [selectedUser, isSearching]);
  
  // Add this effect to detect connections
  useEffect(() => {
    // CRITICAL: Reset connection state FIRST to prevent stale notifications
    setShowConnectionHeader(false);
    setConnectionUsername('');
    setConnectionLikedCount(0);
    
    // Only run this effect when we have a user and NFTs are loaded
    if (selectedUser && !isLoadingNFTs && nfts.length > 0 && isNFTLiked) {
      console.log(`🔍 Checking for connections with ${selectedUser.username}`);
      
      // Count liked NFTs
      let count = 0;
      for (const nft of nfts) {
        if (isNFTLiked(nft, true)) {
          count++;
        }
      }
      
      // Show connection ONLY if we have liked NFTs
      if (count > 0) {
        console.log(`✅ Found ${count} liked NFTs for ${selectedUser.username}`);
        setConnectionUsername(selectedUser.username);
        setConnectionLikedCount(count);
        setShowConnectionHeader(true);
      } else {
        console.log(`❌ No connections found for ${selectedUser.username}`);
      }
    }
  }, [selectedUser, isLoadingNFTs, nfts, isNFTLiked, setShowConnectionHeader, setConnectionUsername, setConnectionLikedCount]);

  // Add a comprehensive cleanup effect that runs when component unmounts or page changes
  useEffect(() => {
    // Return cleanup function
    return () => {
      console.log('🚮 ExploreView unmounting - cleaning up ALL state');
      // Hide any active NFT notifications
      hideNotification();
      
      // Reset connection state completely
      setShowConnectionHeader(false);
      setConnectionUsername('');
      setConnectionLikedCount(0);
      
      // Clean up global window variables
      if (typeof window !== 'undefined') {
        if ((window as any).__hideConnectionNotification) {
          (window as any).__hideConnectionNotification();
        }
      }
    };
  }, [hideNotification]);

  return (
    <>
      {/* Logo header that shows when no notification is visible */}
      <NotificationHeader 
        show={false}
        message=""
        onReset={onReset}
      />
      
      {/* NFT Notification for like/unlike actions */}
      <NFTNotification onReset={onReset} />
      
      {/* Connection Header - controlled by ConnectionContext */}
      <ConnectionHeader />
      
      {/* Main content with adjusted padding */}
      <div className="space-y-8 pt-20 pb-48 overflow-y-auto h-screen">
        {selectedUser && (
          <div className="px-4 mb-8">
            {/* Back button - redesigned for better visibility */}
            <button 
              onClick={() => {
                // Reset any active notifications
                hideNotification();
                console.log('🗑 Reset notifications on back button click');
                
                // Use our special forced animation mode that guarantees completion
                if (window && (window as any).__FORCE_CONNECTION_ANIMATION_DELAY) {
                  console.log('🚀 Using guaranteed animation system');
                  // This will delay navigation until animation completes
                  (window as any).__FORCE_CONNECTION_ANIMATION_DELAY(() => {
                    console.log('✅ Animation completed, now triggering navigation');
                    // Only call onBack after animation finishes
                    onBack();
                  });
                } else {
                  // Fallback if our system isn't available
                  console.log('⚠️ Fallback: forced animation system not available');
                  onBack();
                }
              }}
              className="mb-6 flex items-center gap-3 text-green-400 hover:text-green-300 transition-all px-5 py-3 rounded-lg
                       bg-gradient-to-br from-gray-900/90 to-gray-800/80 hover:from-gray-800/90 hover:to-gray-700/80
                       shadow-lg shadow-black/40 border border-green-500/20 transform hover:scale-[1.02] active:scale-[0.98] duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                <path d="M400-80 0-480l400-400 56 57-343 343 343 343-56 57Z"/>
              </svg>
              <span className="font-mono text-sm tracking-wide font-medium">Back to Search</span>
            </button>

            {/* User Profile Header - Redesigned with app theme colors */}
            <div className="flex flex-col rounded-2xl bg-gradient-to-b from-gray-900/90 to-black/90 border border-green-500/30 shadow-xl shadow-black/50 overflow-hidden">
              {/* Top section with gradient accent */}
              <div className="h-3 w-full bg-gradient-to-r from-purple-500/60 via-green-400/60 to-purple-500/60"></div>
              
              {/* Content section */}
              <div className="flex items-center gap-6 p-6">
                <div className="relative">
                  <a 
                    href={`https://warpcast.com/${selectedUser.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(`https://warpcast.com/${selectedUser.username}`, '_blank');
                    }}
                    className="block transition-transform hover:scale-105 active:scale-95 duration-200"
                  >
                    <div className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 relative ring-3 ring-purple-500/40 shadow-lg shadow-black/50">
                      <Image
                        src={selectedUser.pfp_url || `https://avatar.vercel.sh/${selectedUser.username}`}
                        alt={selectedUser.display_name || selectedUser.username}
                        className="object-cover"
                        fill
                        sizes="80px"
                      />
                    </div>
                  </a>
                  <div 
                    onClick={(e) => handleFollowToggle(selectedUser, e)}
                    className={`absolute -bottom-1 -right-1 w-7 h-7 ${followedUsers[selectedUser.fid] ? 'bg-green-600 hover:bg-green-500' : 'bg-purple-600 hover:bg-purple-500'} rounded-full flex items-center justify-center shadow-lg border-2 ${followedUsers[selectedUser.fid] ? 'border-green-400/30' : 'border-purple-400/30'} transition-all duration-200 cursor-pointer transform hover:scale-110 active:scale-95`}
                  >
                    {followedUsers[selectedUser.fid] ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                  <h2 className="text-2xl font-mono text-green-400 truncate">@{selectedUser.username}</h2>
                  
                  {/* App-specific follower and following counts */}
                  <div className="flex items-center gap-2 mb-2">
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
                  
                  {/* NFT count */}
                  {!isLoadingNFTs && (
                    <div className="flex items-center">
                      <div className="bg-green-500/20 rounded-full px-3 py-1 inline-flex items-center">
                        <span className="font-mono text-sm text-green-300 font-medium">
                          {nfts.length} Media NFTs
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!selectedUser ? (
          <>
            {/* Search interface */}
            <div>
              <SearchBar 
                onSearch={onSearch} 
                isSearching={isSearching} 
                handleUserSelect={handleDirectUserSelect} 
              />
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && !selectedUser ? (
              <div className="mt-8">
                <h2 className="text-2xl font-semibold mb-4 font-mono text-green-400">Search Results</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.map((user) => (
                    <div
                      key={user.fid}
                      onClick={() => {
                        console.log('=== EXPLORE: Direct wallet search from search results ===');
                        console.log('Selected user:', user);
                        
                        // IMPORTANT: We only track the search when the user actually visits the profile
                        // This prevents the recently searched list from being populated just by typing
                        if (effectiveUserFid) {
                          // Only track the search if the user actually clicks to view the profile
                          console.log('Tracking search for user:', user.username);
                          trackUserSearch(user.username, effectiveUserFid);
                        }
                        
                        // Directly initiate wallet search without showing intermediate profile view
                        handleUserSelect(user);
                      }}
                      className="group relative bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg shadow-black/30 hover:shadow-green-900/20 transition-all duration-300 cursor-pointer border border-gray-700/40 hover:border-green-400/40"
                    >
                      {/* Card content with improved layout */}
                      <div className="flex flex-col h-full">
                        {/* Top colored accent bar */}
                        <div className="h-1 w-full bg-gradient-to-r from-purple-500/60 via-green-400/40 to-purple-500/60"></div>
                        
                        {/* User info section */}
                        <div className="p-4 flex items-center gap-4">
                          <div className="relative">
                            {/* Profile image with improved styling */}
                            <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 relative ring-2 ring-purple-500/30 group-hover:ring-green-400/40 transition-all duration-300 shadow-md shadow-black/20">
                              <Image
                                src={user.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`)}
                                alt={user.display_name || user.username}
                                className="object-cover"
                                fill
                                sizes="64px"
                              />
                            </div>
                            
                            {/* Follow/unfollow button */}
                            <div 
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleFollowToggle(user, e);
                              }}
                              className={`absolute -bottom-1 -right-1 w-7 h-7 ${followedUsers[user.fid] ? 'bg-green-600 hover:bg-green-500' : 'bg-purple-600 hover:bg-purple-500'} rounded-full flex items-center justify-center shadow-lg border-2 ${followedUsers[user.fid] ? 'border-green-400/30' : 'border-purple-400/30'} transition-all duration-200 cursor-pointer transform hover:scale-110 active:scale-95`}
                            >
                              {followedUsers[user.fid] ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                          
                          {/* User details with improved typography */}
                          <div className="space-y-1 flex-1 min-w-0">
                            <h3 className="font-mono text-lg text-green-400 truncate group-hover:text-green-300 transition-colors">
                              {user.display_name || user.username}
                            </h3>
                            <div className="flex items-center gap-2">
                              {user.isENS ? (
                                <p className="font-mono text-blue-400 text-sm truncate flex items-center">
                                  <span className="mr-1.5">⬡</span>
                                  {user.username}
                                </p>
                              ) : (
                                <p className="font-mono text-gray-400 text-sm truncate">@{user.username}</p>
                              )}
                            </div>
                            
                            {/* Stats row */}
                            <div className="flex items-center gap-2 mt-1">
                              {followedUsers[user.fid] && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Following
                                </span>
                              )}
                              {user.isENS && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full flex items-center">
                                  ENS
                                </span>
                              )}
                              {POD_MEMBER_FIDS.includes(user.fid) && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full flex items-center">
                                  thepod
                                </span>
                              )}
                              {user.fid === PODPLAYR_OFFICIAL_FID && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-purple-800/40 text-purple-300 rounded-full flex items-center font-semibold">
                                  Official
                                </span>
                              )}
                              {[7472, 14871, 414859, 356115, 296462, 195864, 1020224, 1020659].includes(user.fid) && (
                                <span className="text-xs font-mono px-2 py-0.5 rounded-full flex items-center font-semibold" 
                                      style={{ 
                                        background: 'linear-gradient(90deg, rgba(255,0,0,0.2) 0%, rgba(255,154,0,0.2) 25%, rgba(208,222,33,0.2) 50%, rgba(79,220,74,0.2) 75%, rgba(63,218,216,0.2) 100%)', 
                                        color: '#f0f0f0',
                                        textShadow: '0 0 2px rgba(0,0,0,0.5)'
                                      }}>
                                  ACYL
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Recently Searched Users Section - with cleaner, more distinct styling */}
            {!searchResults.length && !selectedUser && recentSearches.length > 0 && (
              <div className="mb-8 px-4">
                <h2 className="text-xl font-mono text-green-400 mb-4">
                  {effectiveUserFid ? "Recently Searched Users" : "Popular Users"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {recentSearches.map((user) => (
                    <button
                      key={`recent-search-${user.fid}-${user.username}`}
                      onClick={async () => {
                        // Get the full user data from searchedusers collection
                        console.log('=== EXPLORE: User selected from recent searches ===');
                        console.log('Getting full user data for FID:', user.fid);
                        console.log('Current userFid:', effectiveUserFid);
                        console.log('Is ENS user:', user.isENS ? 'Yes' : 'No');
                        
                        const userDoc = await getDoc(doc(db, 'searchedusers', user.fid.toString()));
                        const userData = userDoc.data();
                        console.log('User data from searchedusers:', userData);
                        
                        const farcasterUser: FarcasterUser = {
                          fid: user.fid,
                          username: user.username,
                          display_name: user.display_name || user.username,
                          pfp_url: user.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`),
                          follower_count: user.follower_count || 0,
                          following_count: user.following_count || 0,
                          custody_address: userData?.custody_address,
                          verified_addresses: userData?.verified_addresses,
                          isENS: user.isENS || userData?.isENS || false // Preserve ENS status
                        };
                        
                        console.log('Selected user with addresses:', farcasterUser);
                        
                        // Track the search based on user type
                        console.log('=== EXPLORE: Tracking search ===');
                        if (user.isENS || userData?.isENS) {
                          // Don't try to track ENS users twice, they're already tracked 
                          console.log('ENS user already tracked');
                        } else {
                          // Only track Farcaster users
                          await trackUserSearch(user.username, effectiveUserFid);
                          console.log('Search tracked successfully');
                        }
                        
                        // CRITICAL: ALWAYS use handleDirectUserSelect for consistent profile loading
                        // This ensures we're going directly to UserProfileView when a user is clicked
                        if (handleDirectUserSelect) {
                          console.log('Using handleDirectUserSelect for recently searched user:', farcasterUser.username);
                          handleDirectUserSelect(farcasterUser);
                        } else {
                          console.error('ERROR: handleDirectUserSelect is not available - profile may not load correctly');
                        }
                      }}
                      className="w-full text-left"
                    >
                      {/* Card with improved layout */}
                      <div className="group relative bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg shadow-black/30 hover:shadow-green-900/20 transition-all duration-300 cursor-pointer border border-gray-700/40 hover:border-green-400/40">
                        {/* Top colored accent bar */}
                        <div className="h-1 w-full bg-gradient-to-r from-purple-500/60 via-green-400/40 to-purple-500/60"></div>
                        
                        {/* User info section */}
                        <div className="p-4 flex items-center gap-4">
                          <div className="relative">
                            {/* Profile image with improved styling */}
                            <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 relative ring-2 ring-purple-500/30 group-hover:ring-green-400/40 transition-all duration-300 shadow-md shadow-black/20">
                              <Image
                                src={user.pfp_url || (user.isENS ? '/defaultens.png' : '/default-nft.png')}
                                alt={user.display_name || user.username}
                                className="object-cover"
                                fill
                                sizes="64px"
                              />
                            </div>
                            
                            {/* Follow/unfollow button */}
                            <div 
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleFollowToggle(user, e);
                              }}
                              className={`absolute -bottom-1 -right-1 w-7 h-7 ${followedUsers[user.fid] ? 'bg-green-600 hover:bg-green-500' : 'bg-purple-600 hover:bg-purple-500'} rounded-full flex items-center justify-center shadow-lg border-2 ${followedUsers[user.fid] ? 'border-green-400/30' : 'border-purple-400/30'} transition-all duration-200 cursor-pointer transform hover:scale-110 active:scale-95`}
                            >
                              {followedUsers[user.fid] ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                          
                          {/* User details with improved typography */}
                          <div className="space-y-1 flex-1 min-w-0">
                            <h3 className="font-mono text-lg text-green-400 truncate group-hover:text-green-300 transition-colors">
                              {user.display_name || user.username}
                            </h3>
                            <div className="flex items-center gap-2">
                              {user.isENS ? (
                                <p className="font-mono text-blue-400 text-sm truncate flex items-center">
                                  <span className="mr-1.5">⬡</span>
                                  {user.username}
                                </p>
                              ) : (
                                <p className="font-mono text-gray-400 text-sm truncate">@{user.username}</p>
                              )}
                            </div>
                            
                            {/* Stats row */}
                            <div className="flex items-center gap-2 mt-1">
                              {followedUsers[user.fid] && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Following
                                </span>
                              )}
                              {user.isENS && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full flex items-center">
                                  ENS
                                </span>
                              )}
                              {POD_MEMBER_FIDS.includes(user.fid) && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full flex items-center">
                                  thepod
                                </span>
                              )}
                              {user.fid === PODPLAYR_OFFICIAL_FID && (
                                <span className="text-xs font-mono px-2 py-0.5 bg-purple-800/40 text-purple-300 rounded-full flex items-center font-semibold">
                                  Official
                                </span>
                              )}
                              {[7472, 14871, 414859, 356115, 296462, 195864, 1020224, 1020659].includes(user.fid) && (
                                <span className="text-xs font-mono px-2 py-0.5 rounded-full flex items-center font-semibold" 
                                      style={{ 
                                        background: 'linear-gradient(90deg, rgba(255,0,0,0.2) 0%, rgba(255,154,0,0.2) 25%, rgba(208,222,33,0.2) 50%, rgba(79,220,74,0.2) 75%, rgba(63,218,216,0.2) 100%)', 
                                        color: '#f0f0f0',
                                        textShadow: '0 0 2px rgba(0,0,0,0.5)'
                                      }}>
                                  ACYL
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {isLoadingNFTs ? (
                <div className="col-span-full flex flex-col items-center justify-center py-16 space-y-6">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-gray-800/30 rounded-full"></div>
                    <div className="absolute top-0 w-16 h-16 border-4 border-t-green-400 border-r-green-400 rounded-full animate-spin"></div>
                  </div>
                  <div className="space-y-2 text-center">
                    <p className="text-xl font-mono text-green-400">Searching wallet</p>
                    <p className="font-mono text-gray-400 text-sm">Looking for media NFTs...</p>
                  </div>
                </div>
              ) : nfts.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <p className="font-mono text-gray-400">No media NFTs found</p>
                </div>
              ) : (
                <>
                  {/* Use virtualized loading for NFTs */}
                  <VirtualizedNFTGrid 
                    nfts={nfts}
                    currentlyPlaying={currentlyPlaying}
                    isPlaying={isPlaying}
                    handlePlayPause={handlePlayPause}
                    onPlayNFT={onPlayNFT}
                    publicCollections={publicCollections}
                    addToPublicCollection={addToPublicCollection}
                    removeFromPublicCollection={removeFromPublicCollection}
                    onLikeToggle={onLikeToggle}
                    isNFTLiked={isNFTLiked}
                    userFid={effectiveUserFid}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {/* NFTNotification component now handles all notification types */}
      <NFTNotification onReset={onReset} />
      {/* Follows Modal */}
      {showFollowsModal && selectedUser && (
        <FollowsModal
          isOpen={showFollowsModal}
          onClose={() => setShowFollowsModal(false)}
          userFid={selectedUser.fid}
          type={followsModalType}
          currentUserFid={effectiveUserFid}
          onFollowStatusChange={(newStatus: boolean, targetFid: number) => {
            // Update UI immediately when follow status changes in modal
            setFollowedUsers(prev => ({
              ...prev,
              [targetFid]: newStatus
            }));
            
            // Update follower/following counts if this is the selected user
            if (selectedUser && selectedUser.fid === targetFid) {
              setAppFollowerCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
            }
            
            // If the current user is selected, update their following count
            if (selectedUser && selectedUser.fid === effectiveUserFid) {
              setAppFollowingCount(prev => newStatus ? prev + 1 : Math.max(0, prev - 1));
            }
          }}
        />
      )}
    </>
  );
};

export default ExploreView;