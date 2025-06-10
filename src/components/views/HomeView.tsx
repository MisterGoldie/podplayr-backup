'use client';

import React, { useMemo, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { NFTCard } from '../nft/NFTCard';
import type { NFT } from '~/types/nft';
import Image from 'next/image';
import { useNFTPreloader } from '../../hooks/useNFTPreloader';
import FeaturedSection from '../sections/FeaturedSection';
import RecentlyPlayed from '../RecentlyPlayed';
import { getMediaKey } from '../../utils/media';
import { useFarcasterContext } from '~/contexts/FarcasterContext';
import NotificationHeader from '../NotificationHeader';
import NFTNotification from '../NFTNotification';
import { useNFTNotification } from '../../context/NFTNotificationContext';
import { logger } from '~/utils/logger';
import { useRouter } from 'next/router';

// Create a dedicated logger for the HomeView
const homeLogger = logger.getModuleLogger('homeView');

interface HomeViewProps {
  recentlyPlayedNFTs: NFT[];
  topPlayedNFTs: { nft: NFT; count: number }[];
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  isLoading?: boolean;
  onReset: () => void;
  onLikeToggle: (nft: NFT) => Promise<void>;
  likedNFTs: NFT[];
  hasActivePlayer: boolean;
  currentPlayingNFT?: NFT | null; // Add currentPlayingNFT prop
  recentlyAddedNFT?: React.MutableRefObject<string | null>; // Add recentlyAddedNFT ref
  featuredNfts: NFT[];
}

const HomeView: React.FC<HomeViewProps> = ({
  recentlyPlayedNFTs,
  topPlayedNFTs,
  onPlayNFT,
  currentlyPlaying,
  isPlaying,
  handlePlayPause,
  isLoading = false,
  onReset,
  onLikeToggle,
  likedNFTs,
  hasActivePlayer = false,
  currentPlayingNFT,
  recentlyAddedNFT,
  featuredNfts,
}) => {
  // Get NFT notification context (use directly for instant notifications)
  const { showNotification } = useNFTNotification();
  
  // Add router for navigation
  const router = useRouter();

  // Initialize featured NFTs once on mount
  useEffect(() => {
    const initializeFeaturedNFTs = async () => {
      const { ensureFeaturedNFTsExist } = await import('../../lib/firebase');
      const { FEATURED_NFTS } = await import('../sections/FeaturedSection');
      await ensureFeaturedNFTsExist(FEATURED_NFTS);
    };

    initializeFeaturedNFTs();
  }, []);

  // Combine all NFTs that need preloading
  const allNFTs = useMemo(() => {
    const nfts = [...recentlyPlayedNFTs];
    topPlayedNFTs.forEach(({ nft }) => {
      if (!nfts.some(existing => 
        existing.contract === nft.contract && 
        existing.tokenId === nft.tokenId
      )) {
        nfts.push(nft);
      }
    });
    return nfts;
  }, [recentlyPlayedNFTs, topPlayedNFTs]);

  // Preload all NFT images
  useNFTPreloader(allNFTs);

  // Get user's FID from context
  const { fid } = useFarcasterContext();

  // Directly check if an NFT is liked by comparing against likedNFTs prop
  // This is more reliable than depending on context or hooks
  const checkDirectlyLiked = (nftToCheck: NFT): boolean => {
    if (!nftToCheck) return false;
    
    // CRITICAL: Use mediaKey as the primary identifier for comparison
    // This aligns with the core architecture of using mediaKey for all NFT content
    const mediaKey = nftToCheck.mediaKey || getMediaKey(nftToCheck);
    
    if (mediaKey) {
      // First try to match by mediaKey (preferred method)
      const mediaKeyMatch = likedNFTs.some(likedNFT => {
        const likedMediaKey = likedNFT.mediaKey || getMediaKey(likedNFT);
        return likedMediaKey === mediaKey;
      });
      
      if (mediaKeyMatch) return true;
    }
    
    // Fallback to contract-tokenId only if mediaKey matching fails
    if (nftToCheck.contract && nftToCheck.tokenId) {
      const nftKey = `${nftToCheck.contract}-${nftToCheck.tokenId}`.toLowerCase();
      return likedNFTs.some(likedNFT => 
        likedNFT.contract && likedNFT.tokenId &&
        `${likedNFT.contract}-${likedNFT.tokenId}`.toLowerCase() === nftKey
      );
    }
    
    return false;
  };

  // Create a wrapper for the existing like function that shows notification IMMEDIATELY
  const handleNFTLike = async (nft: NFT): Promise<void> => {
    // Check if the NFT is already liked BEFORE toggling
    const wasLiked = checkDirectlyLiked(nft);
    
    // Show notification with a small delay to sync with heart icon animation
    // This ensures the notification appears after the heart turns red
    const notificationType = !wasLiked ? 'like' : 'unlike';
    
    // Add a small delay (150ms) to match the heart animation timing
    setTimeout(() => {
      showNotification(notificationType, nft);
    }, 150); // Timing synchronized with heart icon animation
    
    // Call the original like function to toggle the status in the background
    // Don't await this - let it happen in the background while notification shows
    if (onLikeToggle) {
      onLikeToggle(nft).catch(error => {
        console.error('Error toggling like status:', error);
      });
    }
  };

  // Filter out invalid NFTs from recently played
  const validRecentlyPlayedNFTs = useMemo(() => {
    return recentlyPlayedNFTs.filter(nft => {
      // Basic validation
      if (!nft) return false;
      
      // Check for critical display properties
      const hasDisplayInfo = Boolean(
        nft.name || (nft.contract && nft.tokenId)
      );
      
      // Check for media
      const hasMedia = Boolean(
        nft.image || 
        nft.metadata?.image ||
        nft.audio ||
        nft.metadata?.animation_url
      );
      
      // Log invalid NFTs
      if (!hasDisplayInfo || !hasMedia) {
        homeLogger.warn('Filtering invalid NFT from recently played:', {
          nft,
          reason: !hasDisplayInfo ? 'missing display info' : 'missing media'
        });
      }
      
      return hasDisplayInfo && hasMedia;
    });
  }, [recentlyPlayedNFTs]);

  if (isLoading) {
    return (
      <>
        <header className="fixed top-0 left-0 right-0 h-16 bg-black border-b border-black flex items-center justify-center z-50">
          <button 
            onClick={onReset}
            className="cursor-pointer"
          >
            <Image
              src="/fontlogo.png"
              alt="PODPlayr Logo"
              width={120}
              height={30}
              className="w-[120px] h-[30px]"
              priority={true}
            />
          </button>
        </header>
        <div className="space-y-8 animate-pulse pt-20">
          <section>
            <div className="h-8 w-48 bg-gray-800 rounded mb-4"></div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="aspect-square bg-gray-800 rounded-lg"></div>
              ))}
            </div>
          </section>
          <section>
            <div className="h-8 w-48 bg-gray-800 rounded mb-4"></div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="aspect-square bg-gray-800 rounded-lg"></div>
              ))}
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-16 bg-black border-b border-black flex items-center justify-center z-50">
        <button 
          onClick={onReset}
          className="cursor-pointer"
        >
            <Image
              src="/fontlogo.png"
              alt="PODPlayr Logo"
              width={120}
              height={30}
              className="logo-image"
              priority={true}
            />
        </button>
      </header>
      <div 
        className={`space-y-8 pt-20 pb-40 overflow-y-auto overscroll-y-contain ${
          // Use conditional class for height based on player state and screen size
          hasActivePlayer 
            ? 'h-[calc(100vh-130px)] md:h-[calc(100vh-150px)]' // Adjusted height when player active
            : 'h-screen' // Full height when no player
        }`}
      >
        {/* Notifications are now handled by the global NFTNotification component */}

        {/* Recently Played Section - Now using dedicated component */}
        <RecentlyPlayed
          userFid={fid ?? 0}
          onPlayNFT={onPlayNFT}
          currentlyPlaying={currentlyPlaying}
          isPlaying={isPlaying}
          handlePlayPause={handlePlayPause}
          onLikeToggle={onLikeToggle}
          isNFTLiked={checkDirectlyLiked}
          currentPlayingNFT={currentPlayingNFT} // Pass the currentPlayingNFT prop
          recentlyAddedNFT={recentlyAddedNFT} // Pass the recentlyAddedNFT ref
        />

        {/* Top Played Section */}
        <section>
          {topPlayedNFTs.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-mono text-green-400 mb-6">Top Played</h2>
              <div className="relative">
                <div className="overflow-x-auto pb-4 hide-scrollbar">
                  <div className="flex gap-6">
                    {topPlayedNFTs.map(({ nft, count }, index) => {
                      // Generate strictly unique key that doesn't depend on content
                      const uniqueKey = nft.contract && nft.tokenId 
                        ? `top-${nft.contract}-${nft.tokenId}-${index}` 
                        : `top-${index}-${Math.random().toString(36).substr(2, 9)}`;
                      
                      return (
                        <div key={uniqueKey} className="flex-shrink-0 w-[200px]">
                          <NFTCard
                            key={nft.contract + '-' + nft.tokenId}
                            nft={nft}
                            onPlay={async (nft) => {
                              homeLogger.debug(`Play button clicked for NFT in Top Played: ${nft.name}`);
                              try {
                                // Pass all top played NFTs as the queue context
                                await onPlayNFT(nft, {
                                  queue: topPlayedNFTs.map(item => item.nft),
                                  queueType: 'topPlayed'
                                });
                              } catch (error) {
                                homeLogger.error('Error playing NFT from Top Played:', error);
                              }
                            }}
                            isPlaying={currentlyPlaying === nft.contract + '-' + nft.tokenId}
                            currentlyPlaying={currentlyPlaying}
                            handlePlayPause={handlePlayPause}
                            onLikeToggle={() => handleNFTLike(nft)}
                            userFid={(fid ?? 0).toString()}
                            isNFTLiked={() => checkDirectlyLiked(nft)}
                            playCountBadge={`${count} plays`}
                            animationDelay={index * 0.1}
                          />
                          <h3 className="font-mono text-white text-sm truncate mt-3">{nft.name}</h3>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Featured Section */}
        <section>
          <FeaturedSection
            onPlayNFT={onPlayNFT}
            handlePlayPause={handlePlayPause}
            currentlyPlaying={currentlyPlaying}
            isPlaying={isPlaying}
            onLikeToggle={handleNFTLike}
            isNFTLiked={checkDirectlyLiked}
            userFid={(fid ?? 0).toString()}
          />
        </section>
      </div>
      
      {/* Add NFTNotification component to handle like/unlike notifications */}
      <NFTNotification onReset={onReset} />
    </>
  );
};

export default HomeView;