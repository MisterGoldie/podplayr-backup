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
import { useNFTLike } from '../hooks/useNFTLike';
import { NFTCard } from './NFTCard';

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

  // Add these state variables near the other state declarations
  const [currentPlayingNFT, setCurrentPlayingNFT] = useState<NFT | null>(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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
            // Update recentlyPlayedNFTs with correct like states
            setRecentlyPlayedNFTs(prev => 
              prev.map(nft => ({
                ...nft,
                isLiked: likedMediaKeys.has(getMediaKey(nft))
              }))
            );
          }
          
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
  }, [fid, currentPage.isLibrary, currentPage.isHome, permanentlyRemovedNFTs]);

  // Initialize player state
  useEffect(() => {
    setIsPlayerMinimized(true);
  }, []);

  // Load initial data
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

  const {
    isPlaying: audioIsPlaying,
    currentPlayingNFT: audioCurrentPlayingNFT,
    currentlyPlaying: audioCurrentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause: audioHandlePlayPause,
    handleSeek,
    audioRef
  } = useAudioPlayer({ 
    fid: fid,
    setRecentlyPlayedNFTs,
    recentlyAddedNFT 
  });

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

  // Add the onLikeToggle function
  const onLikeToggle = async (nft: NFT) => {
    if (!fid) {
      console.warn('No FID available for like toggle');
      return;
    }

    try {
      // Call the existing toggleLikeNFT function from firebase
      await toggleLikeNFT(nft, fid);
      // Update the liked state
      setIsLiked(!isLiked);
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  // Use the NFT like hook
  const { handleLike, handleUnlike } = useNFTLike({
    onLikeToggle,
    setIsLiked
  });

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

  // Add these functions before renderCurrentView
  const handlePlayNFT = async (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => {
    if (context?.queue) {
      setCurrentNFTQueue(context.queue);
      setCurrentQueueType(context.queueType || '');
    }
    setCurrentPlayingNFT(nft);
    setIsPlayerMinimized(false);
    setIsInitialPlay(true);
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const onReset = () => {
    setCurrentPage({
      isHome: true,
      isExplore: false,
      isLibrary: false,
      isProfile: false,
      isUserProfile: false
    });
  };

  const isNFTLiked = (nft: NFT): boolean => {
    return likedNFTs.some(liked => 
      liked.contract === nft.contract && 
      liked.tokenId === nft.tokenId
    );
  };

  // Add these functions before renderCurrentView
  const handleSearch = async (query: string) => {
    setIsSearching(true);
    try {
      const results = await searchUsers(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsSearching(false);
    }
  };

  function renderCurrentView(): React.ReactNode {
    const currentView = currentPage.isHome ? 'home' : 
                       currentPage.isExplore ? 'explore' : 
                       currentPage.isLibrary ? 'library' : 
                       currentPage.isProfile ? 'profile' : 'home';

    const handleViewChange = (view: 'home' | 'explore' | 'library' | 'profile') => {
      setCurrentPage({
        isHome: view === 'home',
        isExplore: view === 'explore',
        isLibrary: view === 'library',
        isProfile: view === 'profile',
        isUserProfile: false
      });
    };

    return (
      <>
        {currentPage.isHome && (
          <HomeView
            recentlyPlayedNFTs={recentlyPlayedNFTs}
            topPlayedNFTs={topPlayedNFTs}
            onPlayNFT={handlePlayNFT}
            currentlyPlaying={currentlyPlaying}
            isPlaying={isPlaying}
            handlePlayPause={handlePlayPause}
            isLoading={isLoading}
            onReset={onReset}
            onLikeToggle={onLikeToggle}
            likedNFTs={likedNFTs}
            hasActivePlayer={!isPlayerMinimized}
            currentPlayingNFT={currentPlayingNFT}
            recentlyAddedNFT={recentlyAddedNFT}
            featuredNfts={FEATURED_NFTS}
          />
        )}

        {currentPage.isExplore && (
          <ExploreView
            onSearch={handleSearch}
            selectedUser={selectedUser}
            onPlayNFT={handlePlayNFT}
            currentlyPlaying={currentlyPlaying}
            isPlaying={isPlaying}
            searchResults={searchResults}
            nfts={userNFTs}
            isSearching={isSearching}
            handlePlayPause={handlePlayPause}
            isLoadingNFTs={isLoading}
            onBack={() => setCurrentPage(prev => ({ ...prev, isUserProfile: false }))}
            publicCollections={[]}
            recentSearches={recentSearches}
            handleUserSelect={handleDirectUserSelect}
            handleDirectUserSelect={handleDirectUserSelect}
            onReset={onReset}
            onLikeToggle={onLikeToggle}
            isNFTLiked={isNFTLiked}
            userFid={fid}
            userNFTs={userNFTs}
            searchType=""
            searchParam=""
            likedNFTs={likedNFTs}
          />
        )}

        {currentPage.isLibrary && (
          <LibraryView
            likedNFTs={likedNFTs}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            currentPlayingNFT={currentPlayingNFT}
            handlePlayAudio={handlePlayNFT}
            handlePlayPause={handlePlayPause}
            onReset={onReset}
            userContext={{ user: { fid: fid || 0 } }}
            setIsLiked={() => {}}
            setIsPlayerVisible={() => {}}
            setIsPlayerMinimized={setIsPlayerMinimized}
            onLikeToggle={onLikeToggle}
          />
        )}

        {currentPage.isProfile && (
          <ProfileView
            userContext={{ user: { fid: fid || 0 } }}
            nfts={likedNFTs}
            handlePlayAudio={handlePlayNFT}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            handlePlayPause={handlePlayPause}
            onReset={onReset}
            onNFTsLoaded={() => {}}
            onLikeToggle={onLikeToggle}
          />
        )}

        {currentPage.isUserProfile && selectedUser && (
          <UserProfileView
            user={selectedUser}
            nfts={userNFTs}
            handlePlayAudio={handlePlayNFT}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            handlePlayPause={handlePlayPause}
            onReset={onReset}
            onBack={() => setCurrentPage(prev => ({ ...prev, isUserProfile: false }))}
            currentUserFid={fid || 0}
            onLikeToggle={onLikeToggle}
            isNFTLiked={isNFTLiked}
          />
        )}

        <BottomNav currentView={currentView} onViewChange={handleViewChange} />
      </>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      {renderCurrentView()}
      {!isPlayerMinimized && (
        <PlayerWithAds
          nft={currentPlayingNFT}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onNext={handlePlayNext}
          onPrevious={handlePlayPrevious}
          isMinimized={isPlayerMinimized}
          onMinimizeToggle={() => setIsPlayerMinimized(true)}
          progress={0}
          duration={0}
          onSeek={() => {}}
          onLikeToggle={() => currentPlayingNFT && onLikeToggle(currentPlayingNFT)}
          isLiked={currentPlayingNFT ? isNFTLiked(currentPlayingNFT) : false}
          onPictureInPicture={togglePictureInPicture}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {topPlayedNFTs.map((item) => (
          <NFTCard
            key={`${item.nft.contract}-${item.nft.tokenId}`}
            nft={item.nft}
            onClick={() => handlePlayNFT(item.nft)}
            isPlaying={isPlaying && currentPlayingNFT?.contract === item.nft.contract && currentPlayingNFT?.tokenId === item.nft.tokenId}
            isCompact={false}
            isPreview={false}
          />
        ))}
      </div>
    </div>
  );
};

export default DemoBase;

function prepareAndPlayAudio(nextNFT: NFT) {
  throw new Error('Function not implemented.');
}
//