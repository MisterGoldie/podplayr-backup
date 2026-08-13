import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
  const instanceId = useRef<string>(uuidv4().substring(0, 8));

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
    recentlyPlayedLogger.info(`🎵 RecentlyPlayed component [${instanceId.current}] mounted with userFid:`, userFid);
    
    if (!userFid) {
      recentlyPlayedLogger.warn('⚠️ No userFid provided to RecentlyPlayed component');
      setIsLoading(false);
      return;
    }

    try {
      // Set up subscription to recently played NFTs from Firebase
      recentlyPlayedLogger.info(`🔄 Setting up subscription to recently played NFTs [instance: ${instanceId.current}]`);
      
      const unsubscribe = subscribeToRecentPlays(userFid, (nfts) => {
        recentlyPlayedLogger.info(`📥 [${instanceId.current}] Received Firebase recently played NFTs update:`, {
          count: nfts.length,
          firstNft: nfts.length > 0 ? `${nfts[0]?.name} (${nfts[0]?.mediaKey?.substring(0, 8) || 'no-mediaKey'})` : 'none'
        });
        
        setFirebaseRecentlyPlayed(nfts);
        setIsLoading(false);
      });
      
      // Store the unsubscribe function
      unsubscribeRef.current = unsubscribe;
      
      // Return cleanup function
      return () => {
        recentlyPlayedLogger.info(`🛑 Unsubscribing from recently played NFTs updates [instance: ${instanceId.current}]`);
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }
      };
    } catch (error) {
      recentlyPlayedLogger.error('❌ Error setting up recently played subscription:', error);
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

  const uniqueRecentlyPlayedNFTs = useMemo(() => {
    return validRecentlyPlayedNFTs.filter((nft, index, self) => {
      const mediaKey = nft.mediaKey || getMediaKey(nft);
      if (!mediaKey) {
        recentlyPlayedLogger.warn('NFT missing mediaKey, using fallback deduplication:', nft.name);
        const key = nft.contract && nft.tokenId ?
          `${nft.contract}-${nft.tokenId}`.toLowerCase() : null;
        return key ? index === self.findIndex(n =>
          n.contract && n.tokenId &&
          `${n.contract}-${n.tokenId}`.toLowerCase() === key
        ) : true;
      }

      return index === self.findIndex(n => {
        const nMediaKey = n.mediaKey || getMediaKey(n);
        return nMediaKey === mediaKey;
      });
    });
  }, [validRecentlyPlayedNFTs]);

  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const { visibleItems, hasMore, sentinelRef } = usePagedItems(uniqueRecentlyPlayedNFTs, {
    pageSize: 6,
    resetKey: `${userFid}:${uniqueRecentlyPlayedNFTs[0] ? (uniqueRecentlyPlayedNFTs[0].mediaKey || getMediaKey(uniqueRecentlyPlayedNFTs[0])) : ''}:${uniqueRecentlyPlayedNFTs.length}`,
    scrollRoot,
    rootMargin: '0px 400px',
  });

  // Handle empty state
  // Handle empty state
  if (isLoading && uniqueRecentlyPlayedNFTs.length === 0) {
  return (
    <section className="w-full py-8">
      <div className="container mx-auto px-4">
        <h2 className="text-xl font-mono text-green-400 mb-6">Recently Played</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="aspect-square bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    </section>
  );
}

if (validRecentlyPlayedNFTs.length === 0) {
  return (
    <section className="w-full py-8">
      <div className="container mx-auto px-4">
        <h2 className="text-xl font-mono text-green-400 mb-6">Recently Played</h2>
        <div className="text-gray-400 font-mono">No recently played NFTs yet</div>
      </div>
    </section>
  );
}

  return (
    <section className="w-full py-4">
      <div className="container mx-auto px-4">
        <div className="mb-6">
          <h2 className="text-xl font-mono text-green-400 mb-4">Recently Played</h2>
          <div className="relative">
            <div className="overflow-x-auto pb-4 hide-scrollbar" ref={setScrollRoot}>
              <div className="flex gap-6">
                {visibleItems.map((nft, index) => {
                  const mediaKey = nft.mediaKey || getMediaKey(nft);
                  const uniqueKey = mediaKey
                    ? `recent-${mediaKey.substring(0, 8)}-${index}`
                    : `recent-fallback-${index}`;
                  
                  return (
                    <div key={uniqueKey} className="flex-shrink-0 w-[150px]"> {/* Changed from w-[200px] to w-[150px] */}
                      <NFTCard
                        nft={nft}
                        onPlay={async () => {
                          recentlyPlayedLogger.debug(`Play button clicked for NFT in Recently Played: ${nft.name}`);
                          try {
                            await onPlayNFT(nft, {
                              queue: uniqueRecentlyPlayedNFTs,
                              queueType: 'recentlyPlayed'
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
                        smallCard={true} // Position heart icon properly for smaller cards
                      />
                    </div>
                  );
                })}
                {hasMore && <div ref={sentinelRef} className="flex-shrink-0 w-8 h-8" aria-hidden="true" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

};

export default RecentlyPlayed;
