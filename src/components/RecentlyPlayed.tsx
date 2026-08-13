import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NFT } from '../types/user';
import { subscribeToRecentPlays } from '../lib/firebase';
import { logger } from '../utils/logger';
import { NFTCard } from './nft/NFTCard';
import { getMediaKey } from '../utils/media';
import { usePagedItems } from '../hooks/usePagedItems';

// Create a dedicated logger for this component
const recentlyPlayedLogger = logger.getModuleLogger('RecentlyPlayed');

interface RecentlyPlayedProps {
  userFid: number;
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => void;
  recentlyAddedNFT?: React.MutableRefObject<string | null>;
  currentlyPlaying?: string | null;
  isPlaying?: boolean;
  handlePlayPause?: () => void;
  onLikeToggle?: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT) => boolean;
  currentPlayingNFT?: NFT | null; // Add currentPlayingNFT prop
}

const RecentlyPlayed: React.FC<RecentlyPlayedProps> = ({ 
  userFid, 
  onPlayNFT,
  currentlyPlaying,
  isPlaying = false,
  handlePlayPause,
  onLikeToggle,
  isNFTLiked,
  currentPlayingNFT
}) => {
  const [firebaseRecentlyPlayed, setFirebaseRecentlyPlayed] = useState<NFT[]>([]);
  const [localRecentlyPlayed, setLocalRecentlyPlayed] = useState<NFT[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Initialize local recently played from localStorage if available
  useEffect(() => {
    try {
      const storedNFTs = localStorage.getItem(`recentlyPlayed_${userFid}`);
      if (storedNFTs) {
        const parsedNFTs = JSON.parse(storedNFTs) as NFT[];
        setLocalRecentlyPlayed(parsedNFTs);
        recentlyPlayedLogger.info(`📥 Loaded ${parsedNFTs.length} local recently played NFTs from localStorage`);
      }
    } catch (error) {
      recentlyPlayedLogger.warn('⚠️ Error loading recently played from localStorage:', error);
    }
  }, [userFid]);

  // We'll handle localStorage updates directly when modifying localRecentlyPlayed
  // instead of using a useEffect dependency that causes infinite loops
  const saveToLocalStorage = React.useCallback((items: NFT[]) => {
    if (userFid && items.length > 0) {
      try {
        localStorage.setItem(`recentlyPlayed_${userFid}`, JSON.stringify(items));
        recentlyPlayedLogger.debug(`💾 Saved ${items.length} local recently played NFTs to localStorage`);
      } catch (error) {
        recentlyPlayedLogger.warn('⚠️ Error saving recently played to localStorage:', error);
      }
    }
  }, [userFid]);

  // Set up Firebase subscription for recently played NFTs
  useEffect(() => {
    if (!userFid) {
      setIsLoading(false);
      return;
    }

    try {
      const unsubscribe = subscribeToRecentPlays(userFid, (nfts) => {
        setFirebaseRecentlyPlayed(nfts);
        setIsLoading(false);
      });

      unsubscribeRef.current = unsubscribe;

      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }
      };
    } catch (error) {
      recentlyPlayedLogger.error('Error setting up recently played subscription:', error);
      setIsLoading(false);
    }
  }, [userFid]);
  
  // Instant local prepend so the row updates the moment playback starts.
  useEffect(() => {
    if (!currentPlayingNFT) return;
    const mediaKey = getMediaKey(currentPlayingNFT);
    if (!mediaKey) return;

    setLocalRecentlyPlayed(prev => {
      if (prev[0] && (prev[0].mediaKey || getMediaKey(prev[0])) === mediaKey) {
        return prev;
      }
      const newNFT = {
        ...currentPlayingNFT,
        mediaKey,
        addedToRecentlyPlayed: true,
        addedToRecentlyPlayedAt: Date.now(),
      };
      const filtered = prev.filter(nft => (nft.mediaKey || getMediaKey(nft)) !== mediaKey);
      const updatedList = [newNFT, ...filtered].slice(0, 12);
      saveToLocalStorage(updatedList);
      return updatedList;
    });
  }, [currentPlayingNFT, saveToLocalStorage]);

  const nftIdentity = (nft: NFT) => nft.mediaKey || getMediaKey(nft) || `${nft.contract}-${nft.tokenId}`.toLowerCase();

  const isDisplayableNft = (nft: NFT | null | undefined): nft is NFT => {
    if (!nft) return false;
    const hasDisplayInfo = Boolean(nft.name || (nft.contract && nft.tokenId));
    const hasMedia = Boolean(
      nft.image ||
      nft.metadata?.image ||
      nft.audio ||
      nft.metadata?.animation_url
    );
    return hasDisplayInfo && hasMedia;
  };

  // Local recency is the display order. Firebase only fills in older items
  // that this session has not played yet. Replaying an NFT already in Firebase
  // must still move it to the front immediately.
  const validRecentlyPlayedNFTs = useMemo(() => {
    const seen = new Set<string>();
    const ordered: NFT[] = [];

    const push = (nft: NFT | null | undefined) => {
      if (!isDisplayableNft(nft)) return;
      const key = nftIdentity(nft);
      if (!key || seen.has(key)) return;
      seen.add(key);
      ordered.push(nft);
    };

    if (currentPlayingNFT) push(currentPlayingNFT);
    localRecentlyPlayed.forEach(push);
    firebaseRecentlyPlayed.forEach(push);

    return ordered;
  }, [localRecentlyPlayed, firebaseRecentlyPlayed, currentPlayingNFT]);

  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const { visibleItems, hasMore, sentinelRef } = usePagedItems(validRecentlyPlayedNFTs, {
    pageSize: 6,
    resetKey: `${userFid}:${validRecentlyPlayedNFTs[0] ? (validRecentlyPlayedNFTs[0].mediaKey || getMediaKey(validRecentlyPlayedNFTs[0])) : ''}:${validRecentlyPlayedNFTs.length}`,
    scrollRoot,
    rootMargin: '0px 400px',
  });

  if (isLoading && validRecentlyPlayedNFTs.length === 0) {
    return (
      <section className="w-full">
        <div className="container mx-auto px-4">
          <h2 className="text-lg font-semibold text-white/90 mb-3">Recently played</h2>
          <div className="flex gap-4 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-[180px] aspect-square bg-purple-900/30 rounded-2xl flex-shrink-0 animate-pulse" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (validRecentlyPlayedNFTs.length === 0) {
    return (
      <section className="w-full">
        <div className="container mx-auto px-4">
          <h2 className="text-lg font-semibold text-white/90 mb-1">Recently played</h2>
          <p className="text-sm text-white/40">Play something and it will show up here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="container mx-auto px-4">
        <h2 className="text-lg font-semibold text-white/90 mb-3">Recently played</h2>
        <div className="overflow-x-auto pb-2 hide-scrollbar" ref={setScrollRoot}>
          <div className="flex gap-4">
            {visibleItems.map((nft, index) => {
              const mediaKey = nft.mediaKey || getMediaKey(nft);
              const uniqueKey = mediaKey
                ? `recent-${mediaKey.substring(0, 8)}-${index}`
                : `recent-fallback-${index}`;

              return (
                <div key={uniqueKey} className="flex-shrink-0 w-[180px]">
                  <NFTCard
                    nft={nft}
                    onPlay={async () => {
                      try {
                        await onPlayNFT(nft, {
                          queue: validRecentlyPlayedNFTs,
                          queueType: 'recentlyPlayed',
                        });
                      } catch (error) {
                        recentlyPlayedLogger.error('Error playing NFT from Recently Played:', error);
                      }
                    }}
                    isPlaying={Boolean(
                      isPlaying && (
                        currentlyPlaying === `${nft.contract}-${nft.tokenId}` ||
                        currentlyPlaying === (nft.mediaKey || getMediaKey(nft))
                      )
                    )}
                    currentlyPlaying={currentlyPlaying || null}
                    handlePlayPause={handlePlayPause || (() => {})}
                    onLikeToggle={onLikeToggle ? () => onLikeToggle(nft) : undefined}
                    userFid={userFid.toString()}
                    isNFTLiked={isNFTLiked ? () => isNFTLiked(nft) : undefined}
                    animationDelay={0.2 + (index * 0.05)}
                    smallCard
                  />
                </div>
              );
            })}
            {hasMore && <div ref={sentinelRef} className="flex-shrink-0 w-8 h-8" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </section>
  );

};

export default RecentlyPlayed;
