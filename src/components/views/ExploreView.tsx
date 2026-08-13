'use client';

import React, { useState, useEffect } from 'react';
import { SearchBar } from '../search/SearchBar';
import Image from 'next/image';
import { NFT, FarcasterUser, SearchedUser } from '../../types/user';
import { getDoc, doc } from 'firebase/firestore';
import { db, trackUserSearch, isUserFollowed, toggleFollowUser } from '../../lib/firebase';
import { useContext } from 'react';
import { UserFidContext } from '../../app/providers';
import NotificationHeader from '../NotificationHeader';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import NFTNotification from '../NFTNotification';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';

// Hardcoded list of FIDs for users who should have "thepod" badge
const POD_MEMBER_FIDS = [15019, 7472, 14871, 414859, 235025, 892616, 323867, 892130];

// PODPLAYR official account FID
const PODPLAYR_OFFICIAL_FID = 1014485;

interface ExploreViewProps {
  onSearch: (query: string) => void;
  isPlaying: boolean;
  searchResults: FarcasterUser[];
  isSearching: boolean;
  recentSearches: SearchedUser[];
  handleDirectUserSelect: (user: FarcasterUser) => void;
  onReset: () => void;
  userFid?: number;
}

const ExploreView: React.FC<ExploreViewProps> = (props) => {
  // Get FID from context, but prioritize the one passed in props if available
  const { fid: contextFid } = useContext(UserFidContext);
  
  // Use the FID from props if available, otherwise use the one from context
  const effectiveUserFid = props.userFid || contextFid || 0;

  const {
    onSearch,
    isPlaying,
    searchResults,
    isSearching,
    recentSearches,
    handleDirectUserSelect,
    onReset,
  } = props;

  // Track followed users for the search-results / recent-searches follow buttons
  const [followedUsers, setFollowedUsers] = useState<Record<number, boolean>>({});
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const { visibleItems: visibleSearchResults, hasMore: hasMoreSearch, sentinelRef: searchSentinelRef } = usePagedItems(searchResults, {
    pageSize: PAGE_SIZE,
    resetKey: searchResults.map((user) => user.fid).join(','),
    scrollRoot,
  });
  const { visibleItems: visibleRecentSearches, hasMore: hasMoreRecent, sentinelRef: recentSentinelRef } = usePagedItems(recentSearches, {
    pageSize: PAGE_SIZE,
    resetKey: recentSearches.map((user) => user.fid).join(','),
    scrollRoot,
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

  // Add state for image error handling
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  // Add state for loading images with timeout
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  
  // Enhanced helper function to get safe image URL
  const getSafeImageUrl = (user: any) => {
  console.log('getSafeImageUrl called for user:', user.username, 'isENS:', user.isENS, 'pfp_url:', user.pfp_url);
  
  // For ENS users without pfp_url, always use defaultens.png
  if (user.isENS && !user.pfp_url) {
    console.log('ENS user without pfp_url, using defaultens.png');
    return '/defaultens.png';
  }
  
  const originalUrl = user.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`);
  
  // If this image has failed before, use fallback immediately
  if (failedImages.has(originalUrl)) {
    const fallback = user.isENS ? 
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiM3QzNBRUQiLz4KPHRleHQgeD0iMzIiIHk9IjM4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiPkVOUzwvdGV4dD4KPC9zdmc+' : 
      '/default-avatar.png';
    console.log('Image failed before, using fallback:', fallback);
    return fallback;
  }
  
  return originalUrl;
  };
  
  // Enhanced image error handler
  const handleImageError = (imageUrl: string) => {
  setFailedImages(prev => new Set([...prev, imageUrl]));
  setLoadingImages(prev => {
  const newSet = new Set(prev);
  newSet.delete(imageUrl);
  return newSet;
  });
  };
  
  // Add timeout for slow-loading images
  useEffect(() => {
  const timeouts: NodeJS.Timeout[] = [];
  
  recentSearches.forEach(user => {
  const imageUrl = user.pfp_url;
  if (imageUrl && !failedImages.has(imageUrl) && !loadingImages.has(imageUrl)) {
  setLoadingImages(prev => new Set([...prev, imageUrl]));
  
  // Set timeout for 3 seconds
  const timeout = setTimeout(() => {
  setFailedImages(prev => new Set([...prev, imageUrl]));
  setLoadingImages(prev => {
  const newSet = new Set(prev);
  newSet.delete(imageUrl);
  return newSet;
  });
  }, 3000);
  
  timeouts.push(timeout);
  }
  });
  
  return () => {
  timeouts.forEach(timeout => clearTimeout(timeout));
  };
  }, [recentSearches, failedImages, loadingImages]);
  

  // Check if users are followed when search results or selected user changes
  useEffect(() => {
    const checkFollowStatuses = async () => {
      if (!effectiveUserFid) return;
      
      // Check follow status for search results
      if (searchResults && searchResults.length > 0) {
        for (const user of searchResults) {
          if (user.fid) {
            const isFollowed = await isUserFollowed(effectiveUserFid, user.fid);
            setFollowedUsers(prev => ({
              ...prev,
              [user.fid]: isFollowed
            }));
          }
        }
      }
      
      // Check follow status for recent searches
      if (recentSearches && recentSearches.length > 0) {
        for (const user of recentSearches) {
          if (user.fid) {
            const isFollowed = await isUserFollowed(effectiveUserFid, user.fid);
            setFollowedUsers(prev => ({
              ...prev,
              [user.fid]: isFollowed
            }));
          }
        }
      }
    };
    
    checkFollowStatuses();
  }, [effectiveUserFid, searchResults, recentSearches]);
  
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
      
      console.log(`User ${isNowFollowed ? 'followed' : 'unfollowed'}: ${user.username}`);
    } catch (error) {
      console.error('Error toggling follow status:', error);
    }
  };
  
  // Get the NFT notification context
  const { hideNotification } = useNFTNotification();

  // Add a comprehensive cleanup effect that runs when component unmounts or page changes
  useEffect(() => {
    // Return cleanup function
    return () => {
      console.log('🚮 ExploreView unmounting - cleaning up ALL state');
      // Hide any active NFT notifications
      hideNotification();
      
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
      
      {/* Main content with adjusted padding */}
      <div 
        ref={setScrollRoot}
        className={`space-y-8 pt-20 pb-48 overflow-y-auto overscroll-y-contain min-h-screen bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082] ${
          isPlaying ? 'h-[calc(100vh-130px)] md:h-[calc(100vh-150px)]' : 'h-screen'
        }`}
      >
        {/* Search interface */}
        <div>
          <SearchBar 
            onSearch={onSearch} 
            isSearching={isSearching} 
            handleUserSelect={handleDirectUserSelect} 
          />
        </div>

        {/* Search Results */}
        {searchResults.length > 0 ? (
              <div className="mt-8">
                <h2 className="text-2xl font-semibold mb-4 font-mono text-green-400">Search Results</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleSearchResults.map((user) => (
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
                        
                        // FIX: Use handleDirectUserSelect to navigate to UserProfileView
                        handleDirectUserSelect(user);
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
                                src={getSafeImageUrl(user)}
                                alt={user.display_name || user.username}
                                className="object-cover"
                                fill
                                sizes="64px"
                                unoptimized={user.isENS && !user.pfp_url}
                                onError={(e) => {
                                  console.log('Image error for user:', user.username, 'isENS:', user.isENS, 'src:', e.currentTarget.src);
                                  const fallbackUrl = user.isENS ? 
                                    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiM3QzNBRUQiLz4KPHRleHQgeD0iMzIiIHk9IjM4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiPkVOUzwvdGV4dD4KPC9zdmc+' : 
                                    '/default-avatar.png';
                                  handleImageError(e.currentTarget.src);
                                  // Force the fallback image
                                  e.currentTarget.src = fallbackUrl;
                                }}
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
                {hasMoreSearch && <div ref={searchSentinelRef} className="h-8" aria-hidden="true" />}
              </div>
            ) : null}

            {/* Recently Searched Users Section - with cleaner, more distinct styling */}
            {!searchResults.length && recentSearches.length > 0 && (
              <div className="mb-8 px-4">
                <h2 className="text-xl font-mono text-green-400 mb-4">
                  {effectiveUserFid ? "Recently Searched Users" : "Popular Users"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {visibleRecentSearches.map((user) => (
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
                          pfp_url: user.pfp_url || userData?.pfp_url || (user.isENS ? '/defaultens.png' : `https://avatar.vercel.sh/${user.username}`),
                          follower_count: user.follower_count || 0,
                          following_count: user.following_count || 0,
                          custody_address: userData?.custody_address,
                          verified_addresses: userData?.verified_addresses,
                          isENS: user.isENS || userData?.isENS || false,
                          // ✅ Add profile with bio
                          profile: {
                            bio: userData?.bio || ''
                          }
                        };
                        
                        console.log('Selected user with addresses:', farcasterUser);
                        
                        // Track the search based on user type
                        console.log('=== EXPLORE: Tracking search ===');
                        try {
                          if (user.isENS || userData?.isENS) {
                            // For ENS users, create a new search entry
                            // ... ENS tracking logic
                          } else {
                            // Only track Farcaster users
                            await trackUserSearch(user.username, effectiveUserFid);
                            console.log('Search tracked successfully');
                          }
                        } catch (error) {
                          console.error('Error tracking search:', error);
                        }
                        
                        // CRITICAL: ALWAYS use handleDirectUserSelect for consistent profile loading
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
                                src={getSafeImageUrl(user)}
                                alt={user.display_name || user.username}
                                className="object-cover"
                                fill
                                sizes="64px"
                                unoptimized={user.isENS && !user.pfp_url}
                                onError={(e) => {
                                  console.log('Image error for user:', user.username, 'isENS:', user.isENS, 'src:', e.currentTarget.src);
                                  const fallbackUrl = user.isENS ? 
                                    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiM3QzNBRUQiLz4KPHRleHQgeD0iMzIiIHk9IjM4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9ImJvbGQiPkVOUzwvdGV4dD4KPC9zdmc+' : 
                                    '/default-avatar.png';
                                  handleImageError(e.currentTarget.src);
                                  // Force the fallback image
                                  e.currentTarget.src = fallbackUrl;
                                }}
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
                {hasMoreRecent && <div ref={recentSentinelRef} className="h-8" aria-hidden="true" />}
              </div>
            )}
      </div>
      {/* NFTNotification component now handles all notification types */}
      <NFTNotification onReset={onReset} />
    </>
  );
};

export default ExploreView;