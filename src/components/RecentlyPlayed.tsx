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
  currentPlayingNFT?: NFT | null;
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
  /** True until the first Firebase playHistory snapshot — don't paint stale local order. */
  const [firebaseReady, setFirebaseReady] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Warm local cache for optimistic prepends after Firebase hydrates — never for first paint.
  useEffect(() => {
    if (!userFid) return;
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
    setFirebaseReady(false);
    setFirebaseRecentlyPlayed([]);

    if (!userFid) {
      // No FID yet — stay gated (parent should wait for isFidReady).
      return;
    }

    try {
      const unsubscribe = subscribeToRecentPlays(userFid, (nfts) => {
        setFirebaseRecentlyPlayed(nfts);
        setFirebaseReady(true);
        // Keep localStorage aligned with Firebase so the next cold start matches.
        if (nfts.length > 0) {
          try {
            localStorage.setItem(`recentlyPlayed_${userFid}`, JSON.stringify(nfts));
          } catch {
            /* ignore quota */
          }
        }
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
      setFirebaseReady(true);
    }
  }, [userFid]);
  
  // Instant local prepend so the row updates the moment playback starts (after hydrate).
  useEffect(() => {
    if (!firebaseReady || !currentPlayingNFT) return;
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
  }, [currentPlayingNFT, saveToLocalStorage, firebaseReady]);

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

  // Firebase order is canonical after hydrate. Local / currentPlaying only
  // optimistic-prepend session plays that Firebase has not caught up with yet.
  const validRecentlyPlayedNFTs = useMemo(() => {
    if (!firebaseReady) return [];

    const seen = new Set<string>();
    const ordered: NFT[] = [];

    const push = (nft: NFT | null | undefined) => {
      if (!isDisplayableNft(nft)) return;
      const key = nftIdentity(nft);
      if (!key || seen.has(key)) return;
      seen.add(key);
      ordered.push(nft);
    };

    const firebaseKeys = new Set(
      firebaseRecentlyPlayed.map(nftIdentity).filter(Boolean) as string[]
    );
    const firebaseFirstKey =
      firebaseRecentlyPlayed[0] ? nftIdentity(firebaseRecentlyPlayed[0]) : '';

    // Optimistic: now-playing / just-played local head that Firebase hasn't moved yet.
    if (currentPlayingNFT) {
      const playingKey = nftIdentity(currentPlayingNFT);
      if (playingKey && playingKey !== firebaseFirstKey) {
        push(currentPlayingNFT);
      }
    }
    const localHead = localRecentlyPlayed[0];
    if (localHead) {
      const localKey = nftIdentity(localHead);
      if (
        localKey &&
        localKey !== firebaseFirstKey &&
        (!currentPlayingNFT || localKey !== nftIdentity(currentPlayingNFT))
      ) {
        const localAt = localHead.addedToRecentlyPlayedAt || 0;
        const firebaseAt = firebaseRecentlyPlayed[0]?.addedToRecentlyPlayedAt || 0;
        if (localAt > firebaseAt) {
          push(localHead);
        }
      }
    }

    firebaseRecentlyPlayed.forEach(push);

    // Local-only items not yet in Firebase (offline / lag) — after Firebase order.
    localRecentlyPlayed.forEach((nft) => {
      const key = nftIdentity(nft);
      if (key && !firebaseKeys.has(key)) push(nft);
    });

    return ordered;
  }, [localRecentlyPlayed, firebaseRecentlyPlayed, currentPlayingNFT, firebaseReady]);

  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const { visibleItems, hasMore, sentinelRef } = usePagedItems(validRecentlyPlayedNFTs, {
    pageSize: 6,
    resetKey: `${userFid}:${validRecentlyPlayedNFTs[0] ? (validRecentlyPlayedNFTs[0].mediaKey || getMediaKey(validRecentlyPlayedNFTs[0])) : ''}:${validRecentlyPlayedNFTs.length}`,
    scrollRoot,
    rootMargin: '0px 400px',
  });

  if (!firebaseReady) {
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
