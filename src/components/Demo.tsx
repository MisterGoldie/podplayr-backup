'use client';

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { FarcasterContext, UserFidContext } from '~/app/providers';
import { PlayerWithAds } from './player/PlayerWithAds';
import { getMediaKey } from '~/utils/media';
import { FEATURED_NFTS } from './sections/FeaturedSection';
import { BottomNav } from './navigation/BottomNav';
import HomeView from './views/HomeView';
import ExploreView from './views/ExploreView';
import LibraryView from './views/LibraryView';
import ProfileView from './views/ProfileView';
import UserProfileView from './views/UserProfileView';
import RecentlyPlayed from './RecentlyPlayed';
import TermsOfService from './TermsOfService';
import { useTerms } from '../context/TermsContext';
import Image from 'next/image';
import { processMediaUrl } from '../utils/media';
import {
  getRecentSearches,
  getTopPlayedNFTs,
  trackUserSearch,
  trackNFTPlay,
  fetchNFTDetails,
  getLikedNFTs,
  searchUsers,
  subscribeToRecentSearches,
  toggleLikeNFT,
  fetchUserNFTs
} from '../lib/firebase';
import { fetchUserNFTsFromAlchemy } from '../lib/alchemy';
import type { NFT, FarcasterUser, SearchedUser, UserContext, LibraryViewProps, ProfileViewProps, NFTFile, NFTPlayData, GroupedNFT } from '../types/user';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useTopPlayedNFTs } from '../hooks/useTopPlayedNFTs';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  DocumentData,
  QueryDocumentSnapshot,
  doc,
  setDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserDataLoader } from './data/UserDataLoader';
import { VideoSyncManager } from './media/VideoSyncManager';
import { videoPerformanceMonitor } from '../utils/videoPerformanceMonitor';
import { AnimatePresence, motion } from 'framer-motion';
import NotificationHeader from './NotificationHeader';
import NFTNotification from './NFTNotification';
import { shouldDelayOperation } from '../utils/videoFirstMode';
import { logger } from '../utils/logger';

const NFT_CACHE_KEY = 'podplayr_nft_cache_';
const TWO_HOURS = 2 * 60 * 60 * 1000;

// Create module-specific loggers for different parts of the Demo component
const demoLogger = logger.getModuleLogger('demo');
const playerLogger = logger.getModuleLogger('player');
const nftLogger = logger.getModuleLogger('nft');

// Detect development environment
const IS_DEV = process.env.NODE_ENV !== 'production';

interface DemoProps {
  fid?: number;
}

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

const pageTransition = {
  duration: 0.3,
  ease: [0.43, 0.13, 0.23, 0.96]
};

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

const DemoBase: React.FC = () => {
  // CRITICAL: Force ENABLE all logs for debugging
  logger.setDebugMode(true);
  logger.enableLevel('debug', true);
  logger.enableLevel('info', true);
  logger.enableLevel('warn', true);
  logger.enableLevel('error', true);
  logger.enableModule('firebase', true);
  
  // 1. Context Hooks
  const { isFarcaster } = useContext(FarcasterContext);
  const { fid } = useContext(UserFidContext);
  const { hasAcceptedTerms, acceptTerms } = useTerms();
  
  // Use a ref to track if this is the first render
  const isFirstRender = useRef(true);
  
  // Only log initialization on the first render
  useEffect(() => {
    if (isFirstRender.current) {
      demoLogger.info('Demo component initialized with userFid:', fid, typeof fid);
      isFirstRender.current = false;
    }
  }, [fid]);
  
  // 2. State Hooks
  const [currentPage, setCurrentPage] = useState<PageState>({
    isHome: true,
    isExplore: false,
    isLibrary: false,
    isProfile: false,
    isUserProfile: false
  });
  
  // Track where the user navigated from when going to a user profile
  const [navigationSource, setNavigationSource] = useState<NavigationSource>({
    fromExplore: false,
    fromProfile: false
  });
  
  // Add state to track the current NFT queue for proper next/previous navigation
  const [currentNFTQueue, setCurrentNFTQueue] = useState<NFT[]>([]);
  const [currentQueueType, setCurrentQueueType] = useState<string>('');

  const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
  const [isInitialPlay, setIsInitialPlay] = useState(false);

  const [recentlyPlayedNFTs, setRecentlyPlayedNFTs] = useState<NFT[]>([]);
  // Track the most recently played NFT to prevent duplicates from Firebase subscription
  const recentlyAddedNFT = useRef<string | null>(null);
  
  // Automatically deduplicate the recently played NFTs whenever they change
  // Use a ref to track the previous NFTs array to avoid unnecessary processing
  const prevRecentlyPlayedRef = useRef<string>('');
  
  useEffect(() => {
    // Create a fingerprint of the current array to compare with previous
    const currentFingerprint = recentlyPlayedNFTs
      .map(nft => `${nft.contract}-${nft.tokenId}`.toLowerCase())
      .sort()
      .join('|');
      
    // Skip processing if the array hasn't changed in a meaningful way
    if (currentFingerprint === prevRecentlyPlayedRef.current) {
      return;
    }
    
    // Store the new fingerprint
    prevRecentlyPlayedRef.current = currentFingerprint;
    
    // Add a short delay to allow both updates to come in
    const timeoutId = setTimeout(() => {
      // Deduplicate NFTs based on contract and tokenId
      const uniqueNFTs = recentlyPlayedNFTs.reduce((acc: NFT[], nft) => {
        const key = `${nft.contract}-${nft.tokenId}`.toLowerCase();
        const exists = acc.some(item => 
          `${item.contract}-${item.tokenId}`.toLowerCase() === key
        );
        if (!exists) {
          acc.push(nft);
        }
        return acc;
      }, []);
      
      // Only update if we found duplicates
      if (uniqueNFTs.length !== recentlyPlayedNFTs.length) {
        demoLogger.debug('Deduplicating NFTs', {
          before: recentlyPlayedNFTs.length,
          after: uniqueNFTs.length
        });
        setRecentlyPlayedNFTs(uniqueNFTs);
      }
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [recentlyPlayedNFTs]);
  
  const { topPlayed: topPlayedNFTs, loading: topPlayedLoading } = useTopPlayedNFTs();
  const [searchResults, setSearchResults] = useState<FarcasterUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [userNFTs, setUserNFTs] = useState<NFT[]>([]);
  const [filteredNFTs, setFilteredNFTs] = useState<NFT[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedNFTs, setLikedNFTs] = useState<NFT[]>([]);
  const [recentSearches, setRecentSearches] = useState<SearchedUser[]>([]);
  const [isLiked, setIsLiked] = useState(false);
  const [userData, setUserData] = useState<FarcasterUser | null>(null);
  const videoRef = useRef<HTMLVideoElement>(document.createElement('video'));

  // Add this near your other state variables
  const [permanentlyRemovedNFTs, setPermanentlyRemovedNFTs] = useState<Set<string>>(new Set());
  const [likeSyncComplete, setLikeSyncComplete] = useState<boolean>(false);

  // Load liked NFTs and recent searches when user changes
  useEffect(() => {
    let unsubscribeSearches: (() => void) | undefined;

    const loadUserData = async () => {
      if (fid) {
        logger.info(`[demo] 🔄 Starting initial liked NFTs load for userFid: ${fid}`);
        try {
          // Load liked NFTs
          const freshLikedNFTs = await getLikedNFTs(fid);
          
          // Filter out permanently removed NFTs
          const filteredLiked = freshLikedNFTs.filter(item => {
            const mediaKey = getMediaKey(item);
            return !permanentlyRemovedNFTs.has(mediaKey);
          });
          
          logger.info(`[demo] 📊 Found ${filteredLiked.length} liked NFTs during initial load`);
          setLikedNFTs(filteredLiked);
          
          // Create a set of liked media keys for efficient lookups
          const likedMediaKeys = new Set(filteredLiked.map(nft => getMediaKey(nft)));
          
          // Update window.nftList for the current page
          if (currentPage.isLibrary) {
            window.nftList = filteredLiked;
          } else if (currentPage.isHome) {
            // Update recentlyPlayedNFTs and topPlayedNFTs with correct like states
            const updatedRecentlyPlayed = recentlyPlayedNFTs.map(nft => {
              const mediaKey = getMediaKey(nft);
              return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
            });
            
            const updatedTopPlayed = topPlayedNFTs.map(item => {
              const mediaKey = getMediaKey(item.nft);
              return { ...item, nft: { ...item.nft, isLiked: likedMediaKeys.has(mediaKey) } };
            });
            
            window.nftList = [...updatedRecentlyPlayed, ...updatedTopPlayed.map(item => item.nft)];
          } else if (currentPage.isProfile) {
            // Update userNFTs with correct like states
            window.nftList = userNFTs.map(nft => {
              const mediaKey = getMediaKey(nft);
              return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
            });
          } else if (currentPage.isExplore) {
            // Update filteredNFTs with correct like states
            window.nftList = filteredNFTs.map(nft => {
              const mediaKey = getMediaKey(nft);
              return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
            });
          }
          
          // Dispatch a custom event to notify all components about the initial like state
          logger.info(`[demo] 📢 Broadcasting initial like states to all components`);
          
          // Use setTimeout to ensure this happens after rendering completes
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent('globalLikeStateRefresh', {
              detail: {
                likedMediaKeys: Array.from(likedMediaKeys),
                timestamp: Date.now(),
                source: 'initial-load'
              }
            }));
            
            // Also update DOM elements directly for immediate visual feedback
            likedMediaKeys.forEach(mediaKey => {
              document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
                element.setAttribute('data-liked', 'true');
                element.setAttribute('data-is-liked', 'true');
              });
            });
          }, 500); // Give components time to render
          
          // Load recent searches
          const searches = await getRecentSearches(fid);
          setRecentSearches(searches);

          // Subscribe to real-time updates for recent searches
          unsubscribeSearches = subscribeToRecentSearches(fid, (searches) => {
            setRecentSearches(searches);
          });
        } catch (error) {
          logger.error('Error loading user data:', error);
        }
      }
    };

    loadUserData();

    return () => {
      if (unsubscribeSearches) {
        unsubscribeSearches();
      }
    };
  }, [fid]);

  // Add a dedicated effect for force-synchronizing like states after initial load
  // This ensures liked NFTs are properly displayed without requiring navigation
  useEffect(() => {
    // Only run this effect when likedNFTs are loaded and not during loading state
    if (fid && likedNFTs.length > 0 && !isLoading) {
      logger.info(`[demo] 🔄 Force synchronizing like states for ${likedNFTs.length} liked NFTs`);
      
      // Create a set of liked media keys for efficient lookups
      const likedMediaKeys = new Set(likedNFTs.map(nft => getMediaKey(nft)));
      
      // Broadcast like states to all components multiple times with increasing delays
      // This ensures all components receive the updates even if they mount at different times
      const broadcastLikeStates = () => {
        logger.info(`[demo] 📢 Broadcasting like states for ${likedMediaKeys.size} mediaKeys`);
        
        document.dispatchEvent(new CustomEvent('globalLikeStateRefresh', {
          detail: {
            likedMediaKeys: Array.from(likedMediaKeys),
            timestamp: Date.now(),
            source: 'force-sync'
          }
        }));
        
        // Also update DOM elements directly
        likedMediaKeys.forEach(mediaKey => {
          document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
            element.setAttribute('data-liked', 'true');
            element.setAttribute('data-is-liked', 'true');
          });
        });
      };
      
      // Schedule multiple broadcasts with increasing delays
      // This catches components that mount at different times and improves reliability
      broadcastLikeStates(); // Immediate broadcast
      const timeoutIds: NodeJS.Timeout[] = [];
      
      // Additional broadcasts with delays
      [100, 500, 1000, 2000].forEach(delay => {
        const id = setTimeout(() => {
          broadcastLikeStates();
        }, delay);
        timeoutIds.push(id);
      });
      
      // Clean up timeouts
      return () => {
        timeoutIds.forEach(id => clearTimeout(id));
      };
    }
  }, [fid, likedNFTs, isLoading]);

  const {
    isPlaying,
    currentPlayingNFT,
    currentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause,
    handleSeek,
    audioRef
  } = useAudioPlayer({ 
    fid: fid,
    setRecentlyPlayedNFTs,
    recentlyAddedNFT 
  });

  useEffect(() => {
    setIsPlayerMinimized(true);
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      demoLogger.info('🔄 Starting initial data load with userFid:', fid);
      
      try {
        // Load recent searches regardless of FID
        const recentSearches = await getRecentSearches();
        demoLogger.info('📜 Recent searches loaded:', recentSearches.length);
        
        // Only load user-specific data if we have a FID
        if (fid) {
          const likedNFTs = await getLikedNFTs(fid);
          demoLogger.info('❤️ Liked NFTs loaded:', likedNFTs.length);
        } else {
          demoLogger.warn('⚠️ No userFid available for initial data load');
        }
      } catch (error) {
        demoLogger.error('❌ Error loading initial data:', error);
      }
    };

    loadInitialData();
  }, [fid]);

  // User data loading is now handled by UserDataLoader component

  useEffect(() => {
    const filterMediaNFTs = () => {
      const filtered = userNFTs.filter((nft) => {
        let hasMedia = false;
        
        try {
          // Check for audio in metadata
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
          const hasMediaInProperties = nft.metadata?.properties?.files?.some((file: NFTFile) => {
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
          
          // Log detailed checks for debugging media detection issues
          nftLogger.debug('Checking NFT for media:', {
            name: nft.name,
            audio: nft.audio,
            animation_url: nft.metadata?.animation_url,
            hasValidAudio: nft.hasValidAudio,
            isVideo: nft.isVideo
          });
          
          if (hasMedia) {
            nftLogger.debug('Found media NFT:', {
              name: nft.name,
              hasAudio,
              hasVideo,
              hasMediaInProperties,
              animation_url: nft.metadata?.animation_url
            });
          }
        } catch (error) {
          logger.error('Error checking media types:', error);
        }

        return hasMedia;
      });

      setFilteredNFTs(filtered);
      nftLogger.info(`Found ${filtered.length} media NFTs out of ${userNFTs.length} total NFTs`);
    };

    filterMediaNFTs();
  }, [userNFTs]);

  // Video synchronization is now handled by VideoSyncManager component

  useEffect(() => {
    if (isInitialPlay) {
      playerLogger.info('Minimizing player due to initial play');
      setIsPlayerMinimized(true);
    }
  }, [isInitialPlay]);

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const findAdjacentNFT = (direction: 'next' | 'previous'): NFT | null => {
    if (!currentPlayingNFT) return null;
    
    // Determine which list to use based on the current context
    let currentList: NFT[] = [];
    
    // Check if we're playing from top played section
    if (topPlayedNFTs.some(item => 
      getMediaKey(item.nft) === getMediaKey(currentPlayingNFT)
    )) {
      currentList = topPlayedNFTs.map(item => item.nft);
      playerLogger.debug('Playing from Top Played section');
    }
    // Check if we're playing from featured section
    else if (FEATURED_NFTS.some((nft: NFT) => 
      getMediaKey(nft) === getMediaKey(currentPlayingNFT)
    )) {
      currentList = FEATURED_NFTS;
      playerLogger.debug('Playing from Featured section');
    }
    // Otherwise use the window.nftList for other views
    else if (window.nftList) {
      currentList = window.nftList;
      playerLogger.debug('Playing from main list');
    }
    
    if (!currentList.length) {
      playerLogger.debug('No NFTs in current list');
      return null;
    }

    // Find the current NFT in the list using mediaKey for consistent matching
    const currentMediaKey = getMediaKey(currentPlayingNFT);
    const currentIndex = currentList.findIndex(nft => getMediaKey(nft) === currentMediaKey);

    if (currentIndex === -1) {
      playerLogger.debug('Current NFT not found in list');
      return null;
    }

    const adjacentIndex = direction === 'next' ? 
      currentIndex + 1 : 
      currentIndex - 1;

    // Handle wrapping around the playlist
    if (adjacentIndex < 0) {
      return currentList[currentList.length - 1];
    } else if (adjacentIndex >= currentList.length) {
      return currentList[0];
    }

    return currentList[adjacentIndex];
  };

  const togglePictureInPicture = async () => {
    try {
      if ('pictureInPictureElement' in document && document.pictureInPictureElement) {
        if ('exitPictureInPicture' in document) {
          await document.exitPictureInPicture();
        }
      } else if (videoRef.current && 'requestPictureInPicture' in videoRef.current) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (error) {
      logger.error('PiP error:', error);
    }
  };

  // Create a debug function with the same CUSTOM FILTER TAG as in likes.ts
  const superDebug = (message: string, data: any = {}) => {
    // Use consistent PODPLAYR-DEBUG tag that can be filtered in Chrome DevTools
    // Just type "PODPLAYR-DEBUG" in the console filter box to see only these messages
    console.log('PODPLAYR-DEBUG', `DEMO: ${message}`, data);
    
    // Also log as error to make it appear in the error console tab
    console.error('PODPLAYR-DEBUG', `DEMO: ${message}`, data);
  };

  const handleLikeToggle = async (nft: NFT) => {
    // Use our custom filter tag for debugging
    superDebug('LIKE BUTTON CLICKED', {
      nft_name: nft.name,
      nft_contract: nft.contract,
      nft_tokenId: nft.tokenId,
      timestamp: new Date().toISOString(),
      mediaKey: nft.mediaKey || 'calculating...'
    });
    
    // FOR TESTING: Use a default test FID if none is provided
    // This allows us to test liking functionality in demo mode
    const effectiveUserFid = fid || 1234; // Use dummy FID for testing
    superDebug('USER FID', { fid: effectiveUserFid, isTestFid: !fid });
    
    if (!effectiveUserFid || effectiveUserFid <= 0) {
      superDebug('ERROR: INVALID USER FID', { fid: effectiveUserFid });
      logger.error('❌ Cannot toggle like: Invalid userFid', effectiveUserFid);
      setError('Login required to like NFTs');
      return;
    }
    
    try {
      // Get mediaKey for content-first approach - this is critical
      const mediaKey = getMediaKey(nft);
      superDebug('MEDIA KEY (CONTENT-FIRST ID)', { 
        mediaKey, 
        contract: nft.contract,
        tokenId: nft.tokenId,
        audio: nft.audio?.slice(0, 30) + '...' 
      });
      
      if (!mediaKey) {
        superDebug('ERROR: INVALID MEDIA KEY', { nft: nft.name });
        logger.error('❌ Invalid mediaKey for NFT:', nft);
        return;
      }
      
      superDebug('TOGGLING LIKE FOR NFT', { 
        nftName: nft.name, 
        mediaKey: mediaKey,
        timestamp: new Date().toISOString()
      });
      logger.info(`Toggling like for NFT: ${nft.name}, mediaKey: ${mediaKey}`);
      
      // Check current like status
      const isCurrentlyLiked = isNFTLiked(nft, true);
      superDebug('CURRENT LIKE STATUS', { 
        status: isCurrentlyLiked ? 'LIKED' : 'NOT LIKED',
        nftName: nft.name,
        mediaKey: mediaKey
      });
      
      // In library view, we're ALWAYS unliking
      // In other views, check if the NFT is already liked
      const isUnliking = currentPage.isLibrary || isCurrentlyLiked;
      superDebug('LIKE ACTION', { 
        action: isUnliking ? 'UNLIKE' : 'LIKE',
        inLibraryView: currentPage.isLibrary,
        currentlyLiked: isCurrentlyLiked,
        nftName: nft.name
      });
      
      // IMMEDIATE UI UPDATE for better UX
      if (isUnliking) {
        // Remove all NFTs with the same mediaKey (content-first approach)
        const filteredNFTs = likedNFTs.filter(item => {
          const itemMediaKey = getMediaKey(item);
          return itemMediaKey !== mediaKey;
        });
        
        // Add to permanently removed NFTs using mediaKey (content-first approach)
        setPermanentlyRemovedNFTs(prev => {
          const newSet = new Set(prev);
          newSet.add(mediaKey); // Using mediaKey instead of contract-tokenId
          return newSet;
        });
        
        // Update state immediately
        setLikedNFTs(filteredNFTs);
        setIsLiked(false);
        
        // Show notification in library view
        if (libraryViewRef.current) {
          libraryViewRef.current.setState({
            showUnlikeNotification: true,
            unlikedNFTName: nft.name
          });
          
          // Auto-hide notification after 3 seconds
          setTimeout(() => {
            if (libraryViewRef.current) {
              libraryViewRef.current.setState({ showUnlikeNotification: false });
            }
          }, 3000);
        }
      }
      
      // Enhanced console logging with styling
      superDebug('PREPARING FIREBASE CALL', { 
        nft: nft.name, 
        mediaKey, 
        userId: effectiveUserFid, 
        action: isUnliking ? 'UNLIKE' : 'LIKE',
        time: new Date().toISOString()
      });
      
      // Call Firebase ONCE to toggle like status
      let newLikeState = false;
      try {
        superDebug('CALLING FIREBASE toggleLikeNFT', {
          nftName: nft.name,
          mediaKey: mediaKey,
          fid: effectiveUserFid,
          timestamp: new Date().toISOString()
        });
        
        // Use our custom filter tag for debugging
        superDebug('ABOUT TO CALL FIREBASE toggleLikeNFT', {
          nft_name: nft.name,
          fid: effectiveUserFid,
          mediaKey: mediaKey
        });
        
        // Use the effective userFid (real or test value) - ONLY CALL ONCE
        // Pass forceUnlike=true when in Library view to ensure proper unliking
        newLikeState = await toggleLikeNFT(nft, effectiveUserFid, currentPage.isLibrary);
        
        // Use our custom filter tag for debugging
        superDebug('FIREBASE LIKE RESULT', {
          result: newLikeState ? 'LIKED' : 'UNLIKED',
          nftName: nft.name,
          mediaKey: mediaKey,
          time: new Date().toISOString()
        });
      } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error';
        
        // Only log to console, not to screen
        console.error('❌ LIKE ERROR', { 
          error, 
          errorMessage, 
          mediaKey,
          time: new Date().toISOString() 
        });
        
        logger.error('❌ Error in toggleLikeNFT:', error);
        return; // Exit if there's an error
      }
      
      // Update UI based on the result from Firebase
      console.log('🖼️ DEBUG - Demo: Updating UI with new like state', { newLikeState, mediaKey });
      
      // CRITICAL FIX: Update the local state to match Firebase result
      // This ensures the heart icon reflects the correct state
      setIsLiked(newLikeState);
      
      // Update the liked NFTs collection - CRITICAL for content-first approach
      setLikedNFTs(prev => {
        // Create a copy to avoid mutation issues
        const updatedLikedNFTs = [...prev];
        
        if (newLikeState) {
          // CRITICAL FIX: Remove from permanentlyRemovedNFTs when liking
          // This allows re-liking NFTs that were previously removed
          setPermanentlyRemovedNFTs(prev => {
            const newSet = new Set(prev);
            if (newSet.has(mediaKey)) {
              console.log('🔄 DEBUG - Demo: Removing NFT from permanentlyRemovedNFTs to allow re-liking', { mediaKey });
              newSet.delete(mediaKey);
            }
            return newSet;
          });
          
          // LIKE: Add NFT if not already in collection by mediaKey
          const existingIndex = updatedLikedNFTs.findIndex(item => {
            const itemMediaKey = getMediaKey(item);
            return itemMediaKey === mediaKey;
          });
          
          if (existingIndex >= 0) {
            console.log('ℹ️ DEBUG - Demo: NFT already in liked collection', { mediaKey });
            // Replace with the most up-to-date version of the NFT
            updatedLikedNFTs[existingIndex] = { ...updatedLikedNFTs[existingIndex], ...nft, mediaKey };
            return updatedLikedNFTs;
          }
          
          console.log('➕ DEBUG - Demo: Adding NFT to liked collection', { mediaKey });
          // Add mediaKey directly to the NFT object for easier reference
          return [...updatedLikedNFTs, { ...nft, mediaKey }];
        } else {
          // UNLIKE: Remove all NFTs with this mediaKey from collection
          console.log('➖ DEBUG - Demo: Removing NFT from liked collection', { mediaKey });
          
          // Add to permanently removed NFTs using mediaKey (content-first approach)
          setPermanentlyRemovedNFTs(prev => {
            const newSet = new Set(prev);
            newSet.add(mediaKey); // Using mediaKey instead of contract-tokenId
            return newSet;
          });
          
          return updatedLikedNFTs.filter(item => {
            const itemMediaKey = getMediaKey(item);
            return itemMediaKey !== mediaKey;
          });
        }
      });
      
      // Force update any NFT cards with the same mediaKey
      // This ensures consistent like state across all instances of the same content
      document.querySelectorAll('[data-media-key]').forEach(element => {
        if (element.getAttribute('data-media-key') === mediaKey) {
          element.setAttribute('data-liked', newLikeState ? 'true' : 'false');
        }
      });
      
      // Refresh the liked NFTs from Firebase to ensure everything is in sync
      try {
        console.log('🔄 DEBUG - Demo: Refreshing liked NFTs from Firebase');
        const freshLikedNFTs = await getLikedNFTs(effectiveUserFid);
        console.log('📋 DEBUG - Demo: Fetched liked NFTs', { 
          count: freshLikedNFTs.length, 
          mediaKeys: freshLikedNFTs.map(nft => getMediaKey(nft))
        });
        logger.info(`Fetched ${freshLikedNFTs.length} liked NFTs from Firebase`);
        
        // CRITICAL FIX: Properly merge the fresh data with our current state
        // This ensures we maintain consistent like state across all views
        const uniqueNFTsMap = new Map();
        
        // First add all current liked NFTs to the map
        likedNFTs.forEach(item => {
          const itemMediaKey = getMediaKey(item);
          if (!itemMediaKey) return;
          uniqueNFTsMap.set(itemMediaKey, { ...item, mediaKey: itemMediaKey });
        });
        
        // Then add all NFTs from Firebase, which will override any duplicates
        freshLikedNFTs.forEach(item => {
          const itemMediaKey = getMediaKey(item);
          if (!itemMediaKey) return;
          
          // If we just unliked this NFT, don't add it back
          if (isUnliking && itemMediaKey === mediaKey) {
            console.log('🚫 DEBUG - Demo: Skipping unliked NFT', { mediaKey: itemMediaKey });
            return;
          }
          
          // For NFTs with the same mediaKey, merge the data to ensure completeness
          if (uniqueNFTsMap.has(itemMediaKey)) {
            const existingNFT = uniqueNFTsMap.get(itemMediaKey);
            const mergedNFT = {
              ...existingNFT,
              ...item,
              // Preserve the mediaKey for easier reference
              mediaKey: itemMediaKey,
              // Merge metadata to ensure we have complete information
              metadata: {
                ...(existingNFT.metadata || {}),
                ...(item.metadata || {})
              }
            };
            uniqueNFTsMap.set(itemMediaKey, mergedNFT);
          } else {
            uniqueNFTsMap.set(itemMediaKey, { ...item, mediaKey: itemMediaKey });
          }
        });
        
        // If we're liking, make sure the NFT is in the map with the correct state
        if (!isUnliking && mediaKey) {
          console.log('💖 DEBUG - Demo: Ensuring liked NFT is in map', { mediaKey, newLikeState });
          // If this mediaKey exists, merge the NFT data
          if (uniqueNFTsMap.has(mediaKey)) {
            const existingNFT = uniqueNFTsMap.get(mediaKey);
            uniqueNFTsMap.set(mediaKey, {
              ...existingNFT,
              ...nft,
              // Explicitly mark as liked
              isLiked: true,
              mediaKey,
              metadata: {
                ...(existingNFT.metadata || {}),
                ...(nft.metadata || {})
              }
            });
          } else {
            // Otherwise add the NFT
            uniqueNFTsMap.set(mediaKey, { ...nft, isLiked: true, mediaKey });
          }
        }
        
        // Convert Map back to array and update state
        const uniqueNFTs = Array.from(uniqueNFTsMap.values());
        console.log('🔄 DEBUG - Demo: Updated liked NFTs', { 
          count: uniqueNFTs.length, 
          mediaKeys: uniqueNFTs.map(nft => getMediaKey(nft))
        });
        
        setLikedNFTs(uniqueNFTs);
        
        // Improved: TRUST THE USER ACTION over Firebase verification
        // This ensures the UI responds immediately to user input
        if (mediaKey) {
          // Check Firebase state for debugging purposes only
          const isLikedInFirebase = freshLikedNFTs.some(item => {
            const itemMediaKey = getMediaKey(item);
            return itemMediaKey === mediaKey;
          });
          
          console.warn('🛑🛑🛑 LIKE DEBUGGING - FIREBASE STATE CHECK', { 
            mediaKey, 
            isLikedInFirebase, 
            currentUIState: isLiked,
            isLikedMismatch: isLikedInFirebase !== isLiked,
            action: isUnliking ? 'UNLIKE' : 'LIKE',
            expectedNewState: newLikeState
          });
          
          // IMPORTANT: TRUST THE USER ACTION
          // We've already set isLiked based on the user's action
          // Firebase will eventually catch up via the real-time listener
          console.warn('🔄🔄🔄 USER ACTION PRIORITIZED OVER FIREBASE STATE', {
            userAction: isUnliking ? 'UNLIKE' : 'LIKE',
            newUIState: newLikeState,
            timestamp: new Date().toISOString()
          });
          
          // Force UI to match the user's action
          // This prevents UI flicker if Firebase is slow to update
          setIsLiked(newLikeState);
          
          // Also dispatch a custom event to ensure all components are in sync
          // This helps with cross-component synchronization
          const likeStateChangeEvent = new CustomEvent('nftLikeStateChange', {
            detail: {
              mediaKey,
              contract: nft.contract,
              tokenId: nft.tokenId,
              isLiked: newLikeState,
              timestamp: Date.now(),
              source: 'demo-component'
            }
          });
          document.dispatchEvent(likeStateChangeEvent);
          console.warn('📣📣📣 DEMO COMPONENT DISPATCHED LIKE STATE EVENT', {
            mediaKey,
            newState: newLikeState,
            action: isUnliking ? 'UNLIKE' : 'LIKE'
          });
        }
      } catch (error) {
        console.error('❌ DEBUG - Demo: Error refreshing liked NFTs', error);
        logger.error('Error refreshing liked NFTs:', error);
      }
    } catch (error) {
      logger.error('❌ Error toggling like:', error);
      setError('Failed to update liked status');
    }
  };

  const isNFTLiked = (nft: NFT, ignoreCurrentPage: boolean = false): boolean => {
    if (!nft || !nft.contract || !nft.tokenId) {
      logger.debug('Invalid NFT passed to isNFTLiked, returning false');
      return false;
    }
    
    // If we're in library view and not ignoring current page, all NFTs are liked
    if (currentPage.isLibrary && !ignoreCurrentPage) {
      return true;
    }

    // Get the mediaKey for content-based tracking
    const nftMediaKey = getMediaKey(nft);
    
    // IMPROVED: Check if the NFT has the isLiked property set directly
    if (nft.isLiked === true) {
      return true;
    }
    
    if (nftMediaKey) {
      // First try to match by mediaKey (content-based approach)
      const mediaKeyMatch = likedNFTs.some(item => {
        const itemMediaKey = getMediaKey(item);
        return itemMediaKey === nftMediaKey;
      });
      
      if (mediaKeyMatch) {
        return true;
      }
      
      // If this is the currently playing NFT and isLiked is true, return true
      // Check if the currently playing NFT has the same mediaKey and is liked
      if (currentPlayingNFT && nftMediaKey === getMediaKey(currentPlayingNFT) && isLiked) {
        return true;
      }
    }
    
    // Fallback to contract-tokenId comparison if no mediaKey match found
    const nftKey = `${nft.contract}-${nft.tokenId}`.toLowerCase();
    
    const contractMatch = likedNFTs.some(item => {
      const itemKey = `${item.contract}-${item.tokenId}`.toLowerCase();
      return itemKey === nftKey;
    });
    
    return contractMatch;
  };

  const switchPage = async (page: keyof PageState) => {
    setIsLoading(true); // Set loading state first
    
    const newState: PageState = {
      isHome: false,
      isExplore: false,
      isLibrary: false,
      isProfile: false,
      isUserProfile: false
    };
    newState[page] = true;
    
    // Reset scroll position when changing pages
    window.scrollTo(0, 0);
    
    // Reset states when switching pages
    setSelectedUser(null);
    setSearchResults([]);
    setError(null);

    // Always fetch fresh liked NFTs regardless of which page we're navigating to
    if (fid) {
      console.log('🔄 REFRESHING LIKED NFTS FOR ALL VIEWS');
      try {
        // Fetch FRESH liked NFTs directly from Firebase
        const freshLikedNFTs = await getLikedNFTs(fid);
        
        // Filter out permanently removed NFTs
        const filteredLiked = freshLikedNFTs.filter(item => {
          const mediaKey = getMediaKey(item);
          return !permanentlyRemovedNFTs.has(mediaKey);
        });
        
        // Update state with the refreshed NFTs
        console.log(`📊 Found ${filteredLiked.length} liked NFTs in Firebase`); 
        setLikedNFTs(filteredLiked);
        
        // Ensure all NFTs have their isLiked property set correctly
        const likedMediaKeys = new Set(filteredLiked.map(nft => getMediaKey(nft)));
        
        // Update window.nftList based on the current page
        if (page === 'isLibrary') {
          window.nftList = filteredLiked;
        } else if (page === 'isHome') {
          // Update like state for NFTs in recentlyPlayedNFTs and topPlayedNFTs
          const updatedRecentlyPlayed = recentlyPlayedNFTs.map(nft => {
            const mediaKey = getMediaKey(nft);
            return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
          });
          
          const updatedTopPlayed = topPlayedNFTs.map(item => {
            const mediaKey = getMediaKey(item.nft);
            return { ...item, nft: { ...item.nft, isLiked: likedMediaKeys.has(mediaKey) } };
          });
          
          window.nftList = [...updatedRecentlyPlayed, ...updatedTopPlayed.map(item => item.nft)];
          
          // Force update the DOM for all NFTs with matching mediaKeys
          setTimeout(() => {
            likedMediaKeys.forEach(mediaKey => {
              document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
                element.setAttribute('data-liked', 'true');
                element.setAttribute('data-is-liked', 'true');
              });
            });
          }, 100);
        } else if (page === 'isProfile') {
          // Update like state for NFTs in userNFTs
          const updatedUserNFTs = userNFTs.map(nft => {
            const mediaKey = getMediaKey(nft);
            return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
          });
          window.nftList = updatedUserNFTs;
        } else if (page === 'isExplore') {
          // Update like state for NFTs in filteredNFTs
          const updatedFilteredNFTs = filteredNFTs.map(nft => {
            const mediaKey = getMediaKey(nft);
            return { ...nft, isLiked: likedMediaKeys.has(mediaKey) };
          });
          window.nftList = updatedFilteredNFTs;
        }
        
        // Dispatch a custom event to notify all components about the like state update
        document.dispatchEvent(new CustomEvent('globalLikeStateRefresh', {
          detail: {
            likedMediaKeys: Array.from(likedMediaKeys),
            timestamp: Date.now(),
            source: 'demo-component'
          }
        }));
      } catch (error) {
        console.error('❌ Error refreshing liked NFTs:', error);
        setError('Failed to load your liked NFTs. Please try again.');
        
        // Set default window.nftList based on the page
        if (page === 'isHome') {
          window.nftList = [...recentlyPlayedNFTs, ...topPlayedNFTs.map(item => item.nft)];
        } else if (page === 'isProfile') {
          window.nftList = userNFTs;
        } else if (page === 'isExplore') {
          window.nftList = filteredNFTs;
        } else if (page === 'isLibrary') {
          window.nftList = likedNFTs;
        }
      }
    } else {
      // No user, just set the default window.nftList
      if (page === 'isHome') {
        window.nftList = [...recentlyPlayedNFTs, ...topPlayedNFTs.map(item => item.nft)];
      } else if (page === 'isProfile') {
        window.nftList = userNFTs;
      } else if (page === 'isExplore') {
        window.nftList = filteredNFTs;
      } else if (page === 'isLibrary') {
        window.nftList = likedNFTs;
      }
    }
    
    // Set the current page and finish loading
    setCurrentPage(newState);
    setIsLoading(false);
  };

  const handleSearch = async (username: string) => {
    setIsSearching(true);
    try {
      const results = await searchUsers(username);
      
      // IMPORTANT: If there's only one result, bypass search results completely
      if (results.length === 1) {
        await handleDirectUserSelect(results[0]);
        return; // Skip setting searchResults at all
      }
      
      // Otherwise, if multiple results
      setSearchResults(results);
      setSelectedUser(null); // Clear any selected user
    } catch (error) {
      logger.error('Error searching users:', error);
      setError('Error searching users');
    } finally {
      setIsSearching(false);
    }
  };

  const handleReset = () => {
    demoLogger.debug('🔄 FULL APP RESET: Clearing all user data');
    
    // Reset page to home
    setCurrentPage({
      isHome: true,
      isExplore: false,
      isLibrary: false,
      isProfile: false,
      isUserProfile: false
    });
    
    // Reset scroll position to top of page
    window.scrollTo(0, 0);
    
    // Clear all user-specific data
    setSelectedUser(null);
    setSearchResults([]);
    setUserNFTs([]);
    setFilteredNFTs([]);
    // User profile NFTs are managed separately
    setLikedNFTs([]);
    setError(null);
    
    // Reset player queue if present
    setCurrentNFTQueue([]);
    setCurrentQueueType('');
    
    // Reset NFT list to only public/featured content
    window.nftList = [...FEATURED_NFTS];
    
    // Clear session storage to force data refresh
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.clear();
      } catch (e) {
        console.error('Error clearing session storage:', e);
      }
    }
    
    demoLogger.debug('✅ App state reset completed');
  };

  const handlePlayFromLibrary = async (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => {
    setIsInitialPlay(true);
    
    // If a specific queue context was provided, use that
    if (context?.queue && context.queue.length > 0) {
      demoLogger.info(`Setting current queue to ${context.queue.length} NFTs from ${context.queueType || 'unknown'} context`);
      setCurrentNFTQueue(context.queue);
      setCurrentQueueType(context.queueType || '');
      
      // For backward compatibility
      window.nftList = context.queue;
    } else {
      // Set the queue based on the active view
      let queueNFTs: NFT[] = [];
      let queueSource = '';
      
      if (currentPage.isExplore) {
        queueNFTs = filteredNFTs;
        queueSource = 'explore';
      } else if (currentPage.isLibrary) {
        queueNFTs = likedNFTs;
        queueSource = 'library';
      } else if (currentPage.isProfile) {
        queueNFTs = userNFTs;
        queueSource = 'profile';
      } else if (currentPage.isHome) {
        // Only use the source that this NFT belongs to
        const isInRecentlyPlayed = recentlyPlayedNFTs.some(item => getMediaKey(item) === getMediaKey(nft));
        if (isInRecentlyPlayed) {
          queueNFTs = recentlyPlayedNFTs;
          queueSource = 'recentlyPlayed';
        } else {
          // Must be in topPlayed
          queueNFTs = topPlayedNFTs.map(item => item.nft);
          queueSource = 'topPlayed';
        }
      }
      
      demoLogger.info(`Setting default queue to ${queueNFTs.length} NFTs from ${queueSource}`);
      setCurrentNFTQueue(queueNFTs);
      setCurrentQueueType(queueSource);
      
      // For backward compatibility
      window.nftList = queueNFTs;
    }
    
    // Start playing the NFT
    await handlePlayAudio(nft);
    setIsInitialPlay(false);
  };

  const handleMinimizeToggle = () => {
    if (!isInitialPlay) {
      setIsPlayerMinimized(!isPlayerMinimized);
    }
  };

  const renderCurrentView = () => {
    // Terms of Service will no longer be displayed as the initial screen.
    // Users will proceed directly to the main app views.

    return (
      <>
        <AnimatePresence mode="wait">
          {currentPage.isHome && (
            <motion.div
              key="home"
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageVariants}
              transition={pageTransition}
            >
              <HomeView
                recentlyPlayedNFTs={recentlyPlayedNFTs}
                topPlayedNFTs={topPlayedNFTs}
                onPlayNFT={handlePlayFromLibrary}
                currentlyPlaying={currentPlayingNFT ? getMediaKey(currentPlayingNFT) : null}
                isPlaying={isPlaying}
                handlePlayPause={handlePlayPause}
                isLoading={isLoading}
                onReset={handleReset}
                onLikeToggle={handleLikeToggle}
                likedNFTs={likedNFTs}
                hasActivePlayer={Boolean(currentPlayingNFT)}
                currentPlayingNFT={currentPlayingNFT}
                recentlyAddedNFT={recentlyAddedNFT}
                featuredNfts={FEATURED_NFTS}
              />
            </motion.div>
          )}
          {currentPage.isExplore && (
            <ExploreView
              onSearch={handleSearch}
              selectedUser={selectedUser}
              onPlayNFT={handlePlayFromLibrary}
              currentlyPlaying={currentPlayingNFT ? getMediaKey(currentPlayingNFT) : null}
              isPlaying={isPlaying}
              searchResults={searchResults}
              nfts={filteredNFTs}
              isSearching={isSearching}
              handlePlayPause={handlePlayPause}
              isLoadingNFTs={isLoading}
              onBack={() => setSelectedUser(null)}
              publicCollections={[]}
              addToPublicCollection={() => { } }
              removeFromPublicCollection={() => { } }
              recentSearches={recentSearches}
              handleUserSelect={async (user) => {
                setSelectedUser(user);
                setIsLoading(true);
                try {
                  const cachedNFTs = getCachedNFTs(user.fid);

                  if (user.isENS) {
                    console.log('Selected ENS user:', user);
                  } else {
                    if (fid !== undefined) {
                      await trackUserSearch(user.username, fid);
                    }
                  }

                  if (fid !== undefined) {
                    const updatedSearches = await getRecentSearches(fid);
                    setRecentSearches(updatedSearches);
                  }

                  if (cachedNFTs && Array.isArray(cachedNFTs)) {
                    setUserNFTs(cachedNFTs);
                    setIsLoading(false);
                    return;
                  }

                  const nfts = await fetchUserNFTs(user.fid);
                  if (!nfts) {
                    throw new Error('No NFTs returned');
                  }

                  cacheNFTs(user.fid, nfts);
                  setUserNFTs(nfts);
                } catch (error) {
                  logger.error('Error fetching user NFTs:', error);
                  setError('Failed to fetch user NFTs');
                  setUserNFTs([]);
                } finally {
                  setIsLoading(false);
                }
              }}
              onReset={handleReset}
              handleDirectUserSelect={handleDirectUserSelect}
              onLikeToggle={handleLikeToggle}
              isNFTLiked={isNFTLiked}
              userFid={fid ?? 0}
              userNFTs={userNFTs}
              searchType={''}
              searchParam={''}
              likedNFTs={likedNFTs}
            />
          )}
          {currentPage.isLibrary && (
            <LibraryView
              ref={libraryViewRef}
              likedNFTs={likedNFTs}
              handlePlayAudio={(nft: NFT, context?: { queue?: NFT[], queueType?: string }) => handlePlayFromLibrary(nft, context)}
              currentlyPlaying={currentPlayingNFT ? getMediaKey(currentPlayingNFT) : null}
              currentPlayingNFT={currentPlayingNFT}
              isPlaying={isPlaying}
              handlePlayPause={handlePlayPause}
              onReset={handleReset}
              userContext={{
                user: userData ? {
                  fid: fid ?? 0,
                  username: userData.username,
                  displayName: userData.display_name,
                  pfpUrl: userData.pfp_url,
                  custody_address: userData.custody_address,
                  verified_addresses: {
                    eth_addresses: userData.verified_addresses?.eth_addresses
                  }
                } : undefined
              }}
              setIsLiked={setIsLiked}
              setIsPlayerVisible={() => {}}
              setIsPlayerMinimized={setIsPlayerMinimized}
              onLikeToggle={async (nft) => {
                if (currentPage.isLibrary) {
                  if (libraryViewRef.current) {
                    const isCurrentlyLiked = likedNFTs.some(
                      likedNFT => likedNFT.contractAddress === nft.contractAddress && 
                                  likedNFT.tokenId === nft.tokenId
                    );
                    if (isCurrentlyLiked) {
                      libraryViewRef.current.setState({
                        showUnlikeNotification: true
                      });
                      await handleLikeToggle(nft);
                    }
                  }
                }
              }}
            />
          )}
          {currentPage.isProfile && (
            <ProfileView
              userContext={{
                user: userData ? {
                  fid: fid ?? 0,
                  username: userData.username,
                  displayName: userData.display_name,
                  pfpUrl: userData.pfp_url,
                  custody_address: userData.custody_address,
                  verified_addresses: {
                    eth_addresses: userData.verified_addresses?.eth_addresses
                  }
                } : undefined
              }}
              nfts={userNFTs}
              handlePlayAudio={handlePlayFromLibrary}
              currentlyPlaying={currentPlayingNFT ? getMediaKey(currentPlayingNFT) : null}
              isPlaying={isPlaying}
              handlePlayPause={handlePlayPause}
              onReset={handleReset}
              onNFTsLoaded={setUserNFTs}
              onLikeToggle={handleLikeToggle}
            />
          )}
          {currentPage.isUserProfile && selectedUser && (
            <UserProfileView
              user={selectedUser}
              nfts={userNFTs}
              handlePlayAudio={handlePlayFromLibrary}
              currentlyPlaying={currentPlayingNFT ? getMediaKey(currentPlayingNFT) : null}
              isPlaying={isPlaying}
              handlePlayPause={handlePlayPause}
              onReset={handleReset}
              onBack={() => {
                if (navigationSource.fromExplore) {
                  switchPage('isExplore');
                } else if (navigationSource.fromProfile) {
                  switchPage('isProfile');
                }
              }}
              currentUserFid={fid ?? 0}
              onLikeToggle={handleLikeToggle}
              isNFTLiked={isNFTLiked}
            />
          )}
        </AnimatePresence>
      </>
    );
  };

  const getCachedNFTs = (userId: number): NFT[] | null => {
    const cached = localStorage.getItem(`${NFT_CACHE_KEY}${userId}`);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < TWO_HOURS) {
        return data;
      }
    }
    return null;
  };

  const cacheNFTs = (userId: number, nfts: NFT[]) => {
    localStorage.setItem(
      `${NFT_CACHE_KEY}${userId}`,
      JSON.stringify({ data: nfts, timestamp: Date.now() })
    );
  };

  const fetchRecentlyPlayed = useCallback(async () => {
    if (!fid) return;

    try {
      const recentlyPlayedCollection = collection(db, 'nft_plays');
      const q = query(
        recentlyPlayedCollection,
        where('fid', '==', fid),
        orderBy('timestamp', 'desc'),
        limit(12) // Fetch more to account for duplicates
      );

      const querySnapshot = await getDocs(q);
      const seenNFTs = new Set<string>();
      const recentPlays = querySnapshot.docs.reduce((acc: NFT[], doc: QueryDocumentSnapshot<DocumentData>) => {
        const data = doc.data() as NFTPlayData;
        const nftKey = `${data.nftContract}-${data.tokenId}`.toLowerCase();
        
        // Only add NFT if we haven't seen it before
        if (!seenNFTs.has(nftKey)) {
          seenNFTs.add(nftKey);
          acc.push({
            contract: data.nftContract || '',
            tokenId: data.tokenId || '',
            name: data.name || '',
            image: data.image || '',
            audio: data.audioUrl || '',
            hasValidAudio: true,
            network: data.network || 'ethereum',
            metadata: {
              image: data.image || '',
              animation_url: data.audioUrl || ''
            }
          } as NFT);
        }
        return acc;
      }, []).slice(0, 8); // Only keep first 8 unique NFTs

      setRecentlyPlayedNFTs(recentPlays);
    } catch (error) {
      logger.error('Error fetching recently played:', error);
      // If index error occurs, try fetching without ordering
      if (error instanceof Error && error.toString().includes('index')) {
        try {
          const recentlyPlayedCollection = collection(db, 'nft_plays');
          const fallbackQuery = query(
            recentlyPlayedCollection,
            where('fid', '==', fid),
            limit(12)
          );
          
          const fallbackSnapshot = await getDocs(fallbackQuery);
          const seenNFTs = new Set<string>();
          const fallbackPlays = fallbackSnapshot.docs.reduce((acc: NFT[], doc: QueryDocumentSnapshot<DocumentData>) => {
            const data = doc.data() as NFTPlayData;
            const nftKey = `${data.nftContract}-${data.tokenId}`.toLowerCase();
            
            // Only add NFT if we haven't seen it before
            if (!seenNFTs.has(nftKey)) {
              seenNFTs.add(nftKey);
              acc.push({
                contract: data.nftContract || '',
                tokenId: data.tokenId || '',
                name: data.name || '',
                image: data.image || '',
                audio: data.audioUrl || '',
                hasValidAudio: true,
                network: data.network || 'ethereum',
                metadata: {
                  image: data.image || '',
                  animation_url: data.audioUrl || ''
                }
              } as NFT);
            }
            return acc;
          }, []).slice(0, 8); // Only keep first 8 unique NFTs
          
          setRecentlyPlayedNFTs(fallbackPlays);
        } catch (fallbackError) {
          logger.error('Error with fallback query:', fallbackError);
        }
      }
    }
  }, [fid]);

  useEffect(() => {
    fetchRecentlyPlayed();
  }, [fetchRecentlyPlayed]);

  const prepareAndPlayAudio = async (nft: NFT) => {
    // Only build a default queue if the current queue is empty
    if (currentNFTQueue.length === 0) {
      // Set the current queue based on the active view
      let defaultQueue: NFT[] = [];
      
      if (currentPage.isExplore) {
        defaultQueue = filteredNFTs;
        setCurrentQueueType('explore');
      } else if (currentPage.isLibrary) {
        defaultQueue = likedNFTs;
        setCurrentQueueType('library');
      } else if (currentPage.isProfile) {
        defaultQueue = userNFTs;
        setCurrentQueueType('profile');
      } else if (currentPage.isHome) {
        // Only use recently played as the default queue, don't combine with top played
        defaultQueue = recentlyPlayedNFTs;
        setCurrentQueueType('recentlyPlayed');
      }
      
      demoLogger.info(`Building default queue with ${defaultQueue.length} NFTs from ${currentPage.isHome ? 'home' : currentPage.isExplore ? 'explore' : currentPage.isLibrary ? 'library' : 'profile'} page`);
      
      // Update the queue state
      setCurrentNFTQueue(defaultQueue);
    }
    
    // For compatibility with any code that might use this global
    window.nftList = currentNFTQueue;
    
    try {
      // Call the original handlePlayAudio from useAudioPlayer
      await handlePlayAudio(nft);
    } catch (error) {
      demoLogger.error('Error playing audio:', error);
    }
  };

  const handlePlayNext = async () => {
    if (!currentPlayingNFT || currentNFTQueue.length === 0) return;
    
    // Find current NFT index in our saved queue
    // Use mediaKey for consistent tracking rather than contract+tokenId
    const currentIndex = currentNFTQueue.findIndex(
      (nft: NFT) => getMediaKey(nft) === getMediaKey(currentPlayingNFT)
    );
    
    if (currentIndex === -1) {
      demoLogger.warn(`Current NFT not found in the ${currentQueueType} queue. Can't navigate to next.`);
      return;
    }
    
    // Get next NFT with wraparound
    const nextIndex = (currentIndex + 1) % currentNFTQueue.length;
    const nextNFT = currentNFTQueue[nextIndex];
    
    demoLogger.info(`Playing next NFT (${nextIndex + 1}/${currentNFTQueue.length}) in ${currentQueueType} queue`);
    
    // Play the next NFT
    await prepareAndPlayAudio(nextNFT);
  };

  const handlePlayPrevious = async () => {
    if (!currentPlayingNFT || currentNFTQueue.length === 0) return;
    
    // Find current NFT index in our saved queue
    // Use mediaKey for consistent tracking rather than contract+tokenId
    const currentIndex = currentNFTQueue.findIndex(
      (nft: NFT) => getMediaKey(nft) === getMediaKey(currentPlayingNFT)
    );
    
    if (currentIndex === -1) {
      demoLogger.warn(`Current NFT not found in the ${currentQueueType} queue. Can't navigate to previous.`);
      return;
    }
    
    // Get previous NFT with wraparound
    const prevIndex = (currentIndex - 1 + currentNFTQueue.length) % currentNFTQueue.length;
    const prevNFT = currentNFTQueue[prevIndex];
    
    demoLogger.info(`Playing previous NFT (${prevIndex + 1}/${currentNFTQueue.length}) in ${currentQueueType} queue`);
    
    // Play the previous NFT
    await prepareAndPlayAudio(prevNFT);
  };

  // Add this helper function to release resources from videos
  const releaseVideoResources = useCallback(() => {
    // Just pause videos that aren't playing, don't try to unload resources
    const allVideos = document.querySelectorAll('video');
    const currentId = currentPlayingNFT ? `video-${currentPlayingNFT.contract}-${currentPlayingNFT.tokenId}` : null;
    
    allVideos.forEach(video => {
      if (video.id !== currentId && !video.paused) {
        try {
          // Just pause the video - don't overcomplicate
          video.pause();
        } catch (e) {
          // Ignore errors
        }
      }
    });
  }, [currentPlayingNFT]);

  // Add a function to handle direct video playback
  const handleDirectVideoPlayback = useCallback((nft: NFT) => {
    if (!nft.isVideo) return;
    
    // Find only the specific video element we need
    const targetVideoId = `video-${nft.contract}-${nft.tokenId}`;
    const targetVideo = document.getElementById(targetVideoId) as HTMLVideoElement;
    
    // Only manage the target video to avoid affecting other elements
    if (targetVideo) {
      // Ensure video has playsinline attribute for mobile
      targetVideo.setAttribute('playsinline', 'true');
      
      // For the target video, try to play it directly
      try {
        // First try unmuted
        targetVideo.muted = false;
        targetVideo.play().catch(() => {
          // If that fails (expected on mobile), fall back to muted
          targetVideo.muted = true;
          targetVideo.play().catch(() => {
          });
        });
      } catch (e) {
      }
    }
    
    // Pause other videos more carefully to avoid affecting scrolling
    try {
      // Get only videos that aren't our target
      const otherVideos = document.querySelectorAll(`video:not(#${targetVideoId})`);
      otherVideos.forEach(video => {
        if (!(video as HTMLVideoElement).paused) {
          (video as HTMLVideoElement).pause();
        }
      });
    } catch (e) {
    }
  }, []);

  // IMPORTANT: Instead of replacing handlePlayAudio, modify the existing useAudioPlayer hook's function
  // Find the useEffect that runs when currentPlayingNFT changes, and add this code:
  useEffect(() => {
    if (currentPlayingNFT) {
      // When a new NFT starts playing, pause others
      releaseVideoResources();
      
      // Add direct video playback handling
      if (currentPlayingNFT.isVideo) {
        handleDirectVideoPlayback(currentPlayingNFT);
      }
    }
  }, [currentPlayingNFT, releaseVideoResources, handleDirectVideoPlayback]);

  useEffect(() => {
    // Initialize video performance monitor on mount
    // Use a try-catch to prevent any errors from breaking the app
    try {
      videoPerformanceMonitor.init();
    } catch (e) {
      logger.error('Error initializing video performance monitor:', e);
    }
  }, []);
  // Add this near your NFT processing code to reduce redundant checks
  const processNFTs = useCallback((nfts: any[]) => {
    // Use a Set to track media keys we've already processed
    const processedMediaKeys = new Set();
    const mediaOnly = [];

    // Process each NFT just once with a single pass
    for (const nft of nfts) {
      const mediaKey = getMediaKey(nft);
      
      // Skip if we've already processed this NFT
      if (processedMediaKeys.has(mediaKey)) continue;
      processedMediaKeys.add(mediaKey);
      
      // Determine if it's a media NFT with a single consolidated check
      const isMediaNFT = (
        (nft.animation_url || nft.metadata?.animation_url || nft.audio) && 
        (
          nft.audio || 
          (nft.animation_url?.toLowerCase().match(/\.(mp3|wav|ogg|mp4|webm)$/)) ||
          (nft.metadata?.animation_url?.toLowerCase().match(/\.(mp3|wav|ogg|mp4|webm)$/))
        )
      );
      
      if (isMediaNFT) {
        // Configure NFT properties in one pass
        nft.isVideo = nft.animation_url?.toLowerCase().match(/\.(mp4|webm)$/) || 
                      nft.metadata?.animation_url?.toLowerCase().match(/\.(mp4|webm)$/);
        nft.hasValidAudio = Boolean(nft.audio || 
                           nft.animation_url?.toLowerCase().match(/\.(mp3|wav|ogg)$/) ||
                           nft.metadata?.animation_url?.toLowerCase().match(/\.(mp3|wav|ogg)$/));
        
        mediaOnly.push(nft);
      }
    }
    
    return mediaOnly;
  }, []);

  // Add a direct wallet search function that bypasses search results
  const handleDirectUserSelect = async (user: FarcasterUser) => {
    // Store the target user FID to prevent race conditions
    const targetUserFid = user.fid;
    
    // First set loading state to prevent interactions during transition
    setIsLoading(true);
    
    // IMPORTANT: Clear all NFT data immediately to prevent showing previous user's NFTs
    // This is critical to prevent cross-user NFT display issues
    setUserNFTs([]);
    setFilteredNFTs([]);
    window.nftList = [];
    setSearchResults([]);
    
    // Set the selected user to null first to ensure clean state transition
    // This forces a complete re-render and ensures the loading state is shown
    setSelectedUser(null);
    
    // Small delay to ensure the UI shows the loading state before proceeding
    // This prevents flickering between users
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Determine the navigation source based on current page
    // When on the explore page, isHome is also true, so we need to check both
    const isFromExplore = currentPage.isExplore || (currentPage.isHome && !currentPage.isProfile && !currentPage.isUserProfile && !currentPage.isLibrary);
    const isFromProfile = currentPage.isProfile;
    
    // Log the current page state and navigation source for debugging
    logger.info('Navigation source tracking:', { 
      currentPage, 
      isFromExplore, 
      isFromProfile 
    });
    
    // Track where the user is coming from
    setNavigationSource({
      fromExplore: isFromExplore,
      fromProfile: isFromProfile
    });
    
    // Navigate to the user profile view first with a clean slate
    setCurrentPage({
      isHome: false,
      isExplore: false,
      isLibrary: false,
      isProfile: false,
      isUserProfile: true
    });
    
    // Create a local copy of the user to prevent reference issues
    let profileUser = {...user};
    
    // Track the search and get complete user data
    if (fid) {
      try {
        // Verify we're still loading the same user before continuing
        if (targetUserFid !== user.fid) {
          logger.warn('User changed during profile load, aborting previous operation');
          setIsLoading(false);
          return;
        }
        
        // Get the updated user data with complete profile information including bio
        const updatedUserData = await trackUserSearch(user.username, fid);
        
        // Double-check we're still on the same user
        if (targetUserFid !== user.fid) {
          logger.warn('User changed after search tracking, aborting previous operation');
          setIsLoading(false);
          return;
        }
        
        profileUser = updatedUserData;
        
        // Get updated recent searches
        const searches = await getRecentSearches(fid);
        setRecentSearches(searches);
      } catch (error) {
        logger.error('Error tracking user search:', error);
        // Fall back to using the original user data if there was an error
      }
    } else {
      // If no userFid, just ensure the user has a profile object with bio even if it's empty
      profileUser = {
        ...user,
        profile: user.profile || { bio: "" }
      };
    }
    
    // Set the user profile - only after we have complete data
    // Check again that we're still loading the same user
    if (targetUserFid !== user.fid) {
      logger.warn('User changed before setting profile data, aborting');
      setIsLoading(false);
      return;
    }
    
    // Now that we've verified everything, set the selected user
    setSelectedUser(profileUser);
    
    try {
      // Load NFTs for this user directly from Farcaster API/database
      logger.info(`Loading NFTs for user ${profileUser.username} (FID: ${targetUserFid})`);
      
      // Ensure we have a longer loading state to prevent premature "No NFTs" message
      // This helps with race conditions where the NFT data might take longer to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const nfts = await fetchUserNFTs(targetUserFid);
      
      // Final verification that we're still on the same user before updating UI
      if (targetUserFid !== profileUser.fid) {
        logger.warn('User changed during NFT fetch, aborting update');
        setIsLoading(false);
        return;
      }
      
      // Log NFT loading success
      logger.info(`Successfully loaded ${nfts.length} NFTs for ${profileUser.username} (FID: ${targetUserFid})`);
      
      // Add user FID to each NFT to ensure proper ownership tracking
      const nftsWithOwnership = nfts.map(nft => ({
        ...nft,
        ownerFid: targetUserFid // Add explicit owner FID to each NFT
      }));
      
      // Add a small delay before updating the UI to ensure loading states are properly shown
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Final check to make sure we're still on the same user
      if (targetUserFid !== profileUser.fid) {
        logger.warn('User changed after NFT processing, aborting update');
        setIsLoading(false);
        return;
      }
      
      // Only set the NFTs once we have them all loaded and we're still on the same user
      // CRITICAL: Set an empty array first, then wait, then set the actual NFTs
      // This prevents the "No NFTs" message from showing prematurely
      setUserNFTs([]);
      setFilteredNFTs([]);
      
      // Add another small delay to ensure the UI is in a loading state
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Final verification before updating the UI
      if (targetUserFid !== profileUser.fid) {
        logger.warn('User changed before final NFT update, aborting');
        setIsLoading(false);
        return;
      }
      
      // Now set the actual NFTs
      setUserNFTs(nftsWithOwnership);
      setFilteredNFTs(nftsWithOwnership);
      
      // CRITICAL: Always reset the global NFT list when switching users
      if (nftsWithOwnership && nftsWithOwnership.length > 0) {
        // Update global NFT list for player ONLY if there are actual NFTs
        window.nftList = [...nftsWithOwnership]; // Create a new array to avoid reference issues
        logger.info(`Set ${nftsWithOwnership.length} NFTs for user ${profileUser.username} (FID: ${targetUserFid})`);
      } else {
        // For users with no NFTs, ALWAYS set an empty array to prevent showing previous user's NFTs
        window.nftList = [];
        // Also clear any cached NFT data
        logger.info(`User ${profileUser.username} (FID: ${targetUserFid}) has no NFTs, clearing player queue and cached data`);
      }
      
      setError(null);
    } catch (error) {
      // Only show error if we're still on the same user
      if (targetUserFid === profileUser.fid) {
        logger.error(`Error loading NFTs for ${profileUser.username} (FID: ${targetUserFid}):`, error);
        setError('Error loading NFTs');
      }
    } finally {
      // Only update loading state if we're still on the same user
      if (targetUserFid === profileUser.fid) {
        setIsLoading(false);
      }
    }
  };

  // Add this near the top of the Demo component
  const libraryViewRef = useRef<LibraryView>(null);

  // Find where you initially load the liked NFTs
  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (fid) {
        const liked = await getLikedNFTs(fid);
        
        // CRITICAL: Apply our permanent blacklist using mediaKey (content-first approach)
        const filteredLiked = liked.filter(item => {
          const mediaKey = getMediaKey(item);
          return !permanentlyRemovedNFTs.has(mediaKey);
        });
        
        setLikedNFTs(filteredLiked);
      }
    };
    
    loadLikedNFTs();
  }, [fid, permanentlyRemovedNFTs]); // Add permanentlyRemovedNFTs as a dependency

  // Add this effect to monitor for problematic NFTs
  const checkProblematicNFTs = useCallback(() => {
    // Skip this check during video playback on cellular
    if (shouldDelayOperation()) {
      return;
    }
    
    // Original code...
  }, [userNFTs]);

  useEffect(() => {
    // Run check on startup and when NFT collections change
    checkProblematicNFTs();
    
    // Log cleanup when component unmounts
    return () => {
      demoLogger.debug('Cleaning up subscriptions');
    };
  }, [checkProblematicNFTs]);

  return (
    <div className="relative min-h-screen bg-black text-white">
      {renderCurrentView()}
      {/* ... rest of the JSX ... */}
    </div>
  );
};

export default DemoBase;
//