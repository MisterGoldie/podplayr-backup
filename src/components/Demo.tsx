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
  trackUserSearch,
  trackNFTPlay,
  fetchNFTDetails,
  getLikedNFTs,
  searchUsers,
  toggleLikeNFT,
  fetchUserNFTs,
  getRecentSearches
} from '../lib/firebase';
import { fetchUserNFTsFromAlchemy } from '../lib/alchemy';
import type { NFT, FarcasterUser, SearchedUser, UserContext, LibraryViewProps, ProfileViewProps, NFTFile, NFTPlayData, GroupedNFT } from '../types/user';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useTopPlayedNFTs } from '../hooks/useTopPlayedNFTs';
import { useFirebase } from '../contexts/FirebaseContext';
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

import { UserImageProvider } from '../contexts/UserImageContext';

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

// Enhanced page transition configurations
const pageTransition = {
  duration: 0.4,
  ease: [0.43, 0.13, 0.23, 0.96]
};

const pageVariants = {
  initial: { 
    opacity: 0, 
    x: 20,
    scale: 0.98
  },
  animate: { 
    opacity: 1, 
    x: 0,
    scale: 1,
    transition: pageTransition
  },
  exit: { 
    opacity: 0, 
    x: -20,
    scale: 0.98,
    transition: { ...pageTransition, duration: 0.3 }
  }
};

// Slide transitions for different directions
const slideVariants = {
  slideLeft: {
    initial: { opacity: 0, x: 100 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -100 }
  },
  slideRight: {
    initial: { opacity: 0, x: -100 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 100 }
  },
  slideUp: {
    initial: { opacity: 0, y: 50 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 }
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
  }
};

interface RecentSearch {
  id: string;
  username: string;
  timestamp: number;
}

const DemoBase: React.FC = () => {
  // CRITICAL: Force ENABLE all logs for debugging
  logger.setDebugMode(true);
  logger.enableLevel('debug', true);
  logger.enableLevel('info', true);
  logger.enableLevel('warn', true);
  logger.enableLevel('error', true);
  logger.enableModule('firebase', true);
  
  // 1. Context Hooks - USE THE ENHANCED CONTEXT!
  const { isFarcaster, user: farcasterUser, client: farcasterClient, location: farcasterLocation } = useContext(FarcasterContext);
  const { fid } = useContext(UserFidContext);
  const { hasAcceptedTerms, acceptTerms } = useTerms();
  const { recentSearches: firebaseRecentSearches, featuredNFTs } = useFirebase();
  
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
  const [isLoadingLikedNFTs, setIsLoadingLikedNFTs] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(document.createElement('video'));

  // Add this near your other state variables
  const [permanentlyRemovedNFTs, setPermanentlyRemovedNFTs] = useState<Set<string>>(new Set());
  const [likeSyncComplete, setLikeSyncComplete] = useState<boolean>(false);



  const [localRecentSearches, setLocalRecentSearches] = useState<RecentSearch[]>([]);

  // Remove old Firebase subscription
  useEffect(() => {
    if (!fid) return;

    const loadLikedNFTs = async () => {
      try {
        const likedNFTs = await getLikedNFTs(fid);
        demoLogger.info('❤️ Liked NFTs loaded:', likedNFTs.length);
      } catch (error) {
        demoLogger.error('Error loading liked NFTs:', error);
      }
    };

    loadLikedNFTs();
  }, [fid]);

  // Initialize player state
  useEffect(() => {
    setIsPlayerMinimized(true);
  }, []);

  // Update the context usage
  // Around line 142 - Remove the duplicate fid declaration
  // Keep only this line:
  const { isFidReady } = useContext(UserFidContext); // Remove duplicate fid declaration since it's already declared above
  
  // Remove this duplicate line around line 274:
  // const { fid, isFidReady } = useContext(UserFidContext); // DELETE THIS LINE
  
  // Also consolidate the duplicate loadInitialData useEffect
  // Keep only this version around line 280:
  useEffect(() => {
    // Only load data when FID context is fully ready
    if (!isFidReady) {
      demoLogger.info('⏳ Waiting for FID context to be ready...');
      return;
    }
    
    const loadInitialData = async () => {
      if (!fid) {
        demoLogger.warn('⚠️ No userFid available for initial data load');
        return;
      }
  
      try {
        demoLogger.info('🔄 Starting initial data load with userFid:', fid);
  
        // Load all user-specific data in parallel
        const [recentSearches, likedNFTs, userNFTs] = await Promise.all([
          getRecentSearches(fid),
          getLikedNFTs(fid),
          fetchUserNFTs(fid)
        ]);
  
        demoLogger.info('📜 Recent searches loaded:', recentSearches.length);
        demoLogger.info('❤️ Liked NFTs loaded:', likedNFTs.length);
  
        const mediaNFTs = userNFTs.filter(nft => nft.metadata?.image || nft.image);
        nftLogger.info(`Found ${mediaNFTs.length} media NFTs out of ${userNFTs.length} total NFTs`);
  
        setUserNFTs(userNFTs);
        setFilteredNFTs(mediaNFTs);
      } catch (error) {
        demoLogger.error('❌ Error loading initial data:', error);
      }
    };
  
    loadInitialData();
  }, [fid, isFidReady]);
  
  // Remove the duplicate useEffect around line 330-357 that also calls loadInitialData

  // Fix the useAudioPlayer destructuring (around line 250)
  const {
    isPlaying,
    currentPlayingNFT,
    currentlyPlaying,
    audioProgress,
    audioDuration,
    handlePlayAudio,
    handlePlayPause: audioHandlePlayPause,
    handleSeek,
    handlePlayNext,
    handlePlayPrevious,
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
        const recentSearches = await getRecentSearches(fid);
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
    // Remove or modify the problematic useEffect
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

  // Update search handling to use context
  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchUsers(query);
      setSearchResults(results);
    } catch (error) {
      demoLogger.error('Error searching users:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Add this near the top of the Demo component
  const libraryViewRef = useRef<LibraryView>(null);

  // Find where you initially load the liked NFTs
  useEffect(() => {
    const loadLikedNFTs = async () => {
      if (isLoadingLikedNFTs) return; // Prevent duplicate calls
      if (!fid) return;
      
      setIsLoadingLikedNFTs(true);
      try {
        const liked = await getLikedNFTs(fid);
        
        // CRITICAL: Apply our permanent blacklist using mediaKey (content-first approach)
        const filteredLiked = liked.filter(item => {
          const mediaKey = getMediaKey(item);
          return !permanentlyRemovedNFTs.has(mediaKey);
        });
        
        setLikedNFTs(filteredLiked);
      } catch (error) {
        demoLogger.error('Error loading liked NFTs:', error);
      } finally {
        setIsLoadingLikedNFTs(false);
      }
    };
    
    loadLikedNFTs();
  }, [fid, permanentlyRemovedNFTs, isLoadingLikedNFTs]); // Add permanentlyRemovedNFTs as a dependency

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
  const handlePlayNFT = useCallback(async (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => {
  // Check if this is a different NFT by comparing the currently playing identifier
  if (!currentlyPlaying || currentlyPlaying !== `${nft.contract}-${nft.tokenId}`) {
  // New NFT - start with minimized player and play audio
  setIsPlayerMinimized(true);
await handlePlayAudio(nft);
  } else {
  // Same NFT - just ensure player is minimized without restarting audio
  setIsPlayerMinimized(true);
  }
  }, [handlePlayAudio, currentlyPlaying]);

  const handlePlayPause = () => {
    audioHandlePlayPause();
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

  // Add direct user selection handler
  const handleDirectUserSelect = async (user: FarcasterUser) => {
    setIsLoading(true);
    try {
      // Implementation of handleDirectUserSelect
      demoLogger.info(`Selected user: ${user.username}`);
      setSelectedUser(user);
      setCurrentPage(prev => ({ ...prev, isUserProfile: true }));
    } catch (error) {
      demoLogger.error('Error selecting user:', error);
      setError('Error selecting user');
    } finally {
      setIsLoading(false);
    }
  };

  // Add the missing handleUserSelect function
  const handleUserSelect = async (user: FarcasterUser) => {
    setIsLoading(true);
    try {
      demoLogger.info(`Selecting user: ${user.username}`);
      setSelectedUser(user);
      // Load user's NFTs
      const nfts = await fetchUserNFTs(user.fid);
      setUserNFTs(nfts);
      setCurrentPage(prev => ({ ...prev, isUserProfile: true }));
    } catch (error) {
      demoLogger.error('Error selecting user:', error);
      setError('Error selecting user');
    } finally {
      setIsLoading(false);
    }
  };

  // Update local recent searches when Firebase data changes
  useEffect(() => {
    if (firebaseRecentSearches.length > 0) {
      setLocalRecentSearches(firebaseRecentSearches);
    }
  }, [firebaseRecentSearches]);

  function renderCurrentView(): React.ReactNode {
    let currentViewKey: 'home' | 'explore' | 'library' | 'profile' = 'home';
    if (currentPage.isHome) currentViewKey = 'home';
    else if (currentPage.isExplore) currentViewKey = 'explore';
    else if (currentPage.isLibrary) currentViewKey = 'library';
    else if (currentPage.isProfile || currentPage.isUserProfile) currentViewKey = 'profile';
  
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
            onReset={onReset}
            onLikeToggle={onLikeToggle}
            likedNFTs={likedNFTs}
            hasActivePlayer={!!currentPlayingNFT}
            currentPlayingNFT={currentPlayingNFT}
            featuredNfts={[]}
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
            onBack={() => setCurrentPage(prev => ({ ...prev, isExplore: false, isHome: true }))}
            publicCollections={[]}
            recentSearches={recentSearches}
            handleUserSelect={handleUserSelect}
            handleDirectUserSelect={handleDirectUserSelect}
            onReset={onReset}
            onLikeToggle={onLikeToggle}
            isNFTLiked={isNFTLiked}
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
            userContext={{
              user: {
                fid: fid || 0,
                pfpUrl: farcasterUser?.pfp ?? ''
              }
            }}
            setIsLiked={() => {}}
            setIsPlayerVisible={() => {}}
            setIsPlayerMinimized={setIsPlayerMinimized}
            onLikeToggle={onLikeToggle}
          />
        )}
        {currentPage.isProfile && (
          <UserImageProvider fid={fid} initialProfileImage={farcasterUser?.pfp}>
            <ProfileView
              farcasterContext={{
                isFarcaster,
                user: farcasterUser,
                client: farcasterClient,
                location: farcasterLocation
              }}
              nfts={likedNFTs}
              handlePlayAudio={handlePlayNFT}
              isPlaying={isPlaying}
              currentlyPlaying={currentlyPlaying}
              handlePlayPause={handlePlayPause}
              onReset={onReset}
              onNFTsLoaded={() => {}}
              onLikeToggle={onLikeToggle}
            />
          </UserImageProvider>
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
        <BottomNav 
          currentView={currentViewKey} 
          onViewChange={handleViewChange} 
          isPlayerActive={!!currentPlayingNFT}
          isPlayerMinimized={isPlayerMinimized}
        />
      </>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#1E1525] via-[#2D1B69] to-[#4B0082] text-white">
      {renderCurrentView()}
      {currentPlayingNFT && (
        <PlayerWithAds
          nft={currentPlayingNFT}
          isPlaying={isPlaying}
          progress={audioProgress}
          duration={audioDuration}
          onSeek={handleSeek}
          onPlayPause={handlePlayPause}
          onNext={handlePlayNext}
          onPrevious={handlePlayPrevious}
          isMinimized={isPlayerMinimized}
          onMinimizeToggle={() => setIsPlayerMinimized(!isPlayerMinimized)}
          onPlayNFT={handlePlayNFT}
          onLikeToggle={() => currentPlayingNFT && onLikeToggle(currentPlayingNFT)}
          isLiked={currentPlayingNFT ? isNFTLiked(currentPlayingNFT) : false}
          onPictureInPicture={togglePictureInPicture}
        />
      )}
    </div>
  );
};

export const Demo = React.memo(DemoBase);