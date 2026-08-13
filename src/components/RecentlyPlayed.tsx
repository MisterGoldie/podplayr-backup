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
  recentlyAddedNFT,
  currentlyPlaying,
  isPlaying = false,
  handlePlayPause,
  onLikeToggle,
  isNFTLiked,
  currentPlayingNFT
}) => {
  const [recentlyPlayedNFTs, setRecentlyPlayedNFTs] = useState<NFT[]>([]);
  const [firebaseRecentlyPlayed, setFirebaseRecentlyPlayed] = useState<NFT[]>([]);
  const [localRecentlyPlayed, setLocalRecentlyPlayed] = useState<NFT[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const instanceId = useRef<string>(uuidv4().substring(0, 8));
  const processedMediaKeys = useRef<Set<string>>(new Set());
  
  // ✅ KEEP ONLY ONE cleanup mechanism - make it more efficient
  useEffect(() => {
    const clearProcessedKeys = () => {
      // Only clear and log if there are actually keys to clear
      if (processedMediaKeys.current.size > 0) {
        const clearedCount = processedMediaKeys.current.size;
        processedMediaKeys.current.clear();
        recentlyPlayedLogger.debug(`🧹 Cleared ${clearedCount} processed mediaKeys`);
      }
    };
    
    // Clear the set every 30 seconds instead of 5 seconds to reduce noise
    const intervalId = setInterval(clearProcessedKeys, 30000);
    
    return () => {
      clearInterval(intervalId);
    };
  }, []);

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

  // Set up Firebase subscription for recently played NFTs that have reached the 25% threshold
  useEffect(() => {
    recentlyPlayedLogger.info(`🎵 RecentlyPlayed component [${instanceId.current}] mounted with userFid:`, userFid);
    
    if (!userFid) {
      recentlyPlayedLogger.warn('⚠️ No userFid provided to RecentlyPlayed component');
      setIsLoading(false);
      return;
    }

    try {
      // Set up subscription to recently played NFTs from Firebase (25% threshold)
      recentlyPlayedLogger.info(`🔄 Setting up subscription to recently played NFTs [instance: ${instanceId.current}]`);
      
      const unsubscribe = subscribeToRecentPlays(userFid, (nfts) => {
        recentlyPlayedLogger.info(`📥 [${instanceId.current}] Received Firebase recently played NFTs update:`, {
          count: nfts.length,
          firstNft: nfts.length > 0 ? `${nfts[0]?.name} (${nfts[0]?.mediaKey?.substring(0, 8) || 'no-mediaKey'})` : 'none'
        });
        
        // Before setting, check if the first NFT is the same as our recently added one
        if (nfts.length > 0 && recentlyAddedNFT?.current) {
          const mediaKey = nfts[0]?.mediaKey || '';
          
          recentlyPlayedLogger.debug('🔍 Checking for duplicate with recentlyAddedNFT:', {
            mediaKey: mediaKey.substring(0, 12) + '...',
            recentlyAdded: recentlyAddedNFT.current
          });
          
          // If the first NFT is one we just added manually, skip this update
          if (mediaKey && mediaKey === recentlyAddedNFT.current) {
            recentlyPlayedLogger.debug('⏭️ Skipping duplicate NFT update based on mediaKey match');
            return;
          }
        }
        
        // Log each NFT being added to the recently played list
        nfts.forEach((nft, index) => {
          recentlyPlayedLogger.debug(`Firebase NFT ${index+1}: ${nft.name} (mediaKey: ${nft.mediaKey?.substring(0, 8) || 'no-mediaKey'})`);
        });
        
        // Store Firebase NFTs separately
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
  }, [userFid]); // ✅ REMOVE recentlyAddedNFT dependency
  
  // Update local recently played when props.recentlyAddedNFT changes
  // Connect the localRecentlyPlayed state to the useAudioPlayer hook by watching the recentlyAddedNFT ref
  useEffect(() => {
    if (recentlyAddedNFT?.current) {
      const mediaKey = recentlyAddedNFT.current;
      
      // Skip if we've already processed this mediaKey to prevent infinite loops
      if (processedMediaKeys.current.has(mediaKey)) {
        return;
      }
      
      // Mark this mediaKey as processed
      processedMediaKeys.current.add(mediaKey);
      
      recentlyPlayedLogger.info(`🎮 Local recently played ref updated: ${mediaKey}`);
      recentlyPlayedLogger.info(`🔑 Using mediaKey from ref: ${mediaKey.substring(0, 15)}...`);
      
      // Find the NFT in either the existing localRecentlyPlayed or in the firebase list
      const existingLocalNFT = localRecentlyPlayed.find(nft => {
        const nftMediaKey = nft.mediaKey || getMediaKey(nft);
        return nftMediaKey === mediaKey;
      });
      
      const firebaseNFT = firebaseRecentlyPlayed.find(nft => {
        const nftMediaKey = nft.mediaKey || getMediaKey(nft);
        return nftMediaKey === mediaKey;
      });
      
      // Find the best source NFT to use (we don't have direct access to the current playing NFT)
      const sourceNFT = existingLocalNFT || firebaseNFT || currentPlayingNFT;
      
      if (sourceNFT) {
        setLocalRecentlyPlayed(prev => {
          // Copy the NFT and ensure it has the right mediaKey and timestamp
          const newNFT = { ...sourceNFT };
          if (!newNFT.mediaKey) {
            newNFT.mediaKey = mediaKey;
          }
          newNFT.addedToRecentlyPlayed = true;
          newNFT.addedToRecentlyPlayedAt = new Date().getTime();
          
          // Filter out any existing version of this NFT
          const filtered = prev.filter(nft => {
            const nftMediaKey = nft.mediaKey || getMediaKey(nft);
            return nftMediaKey !== mediaKey;
          });
          
          // Create the updated list
          const updatedList = [newNFT, ...filtered].slice(0, 8);
          
          // Save to localStorage using our helper function
          saveToLocalStorage(updatedList);
          
          // Return the updated list for state update
          return updatedList;
        });
      }
    }
  }, [recentlyAddedNFT, localRecentlyPlayed, firebaseRecentlyPlayed, saveToLocalStorage]);
  
  // CRITICAL: Update local recently played when currentPlayingNFT changes
  useEffect(() => {
    if (currentPlayingNFT && !processedMediaKeys.current.has(getMediaKey(currentPlayingNFT))) {
      // ALWAYS use getMediaKey() - never use existing mediaKey property
      const mediaKey = getMediaKey(currentPlayingNFT);
      processedMediaKeys.current.add(mediaKey);
      
      setLocalRecentlyPlayed(prev => {
        const newNFT = { ...currentPlayingNFT, mediaKey, addedToRecentlyPlayed: true, addedToRecentlyPlayedAt: Date.now() };
        const filtered = prev.filter(nft => getMediaKey(nft) !== mediaKey);
        const updatedList = [newNFT, ...filtered].slice(0, 8);
        saveToLocalStorage(updatedList);
        return updatedList;
      });
    }
  }, [currentPlayingNFT, saveToLocalStorage]);

  // Add a cleanup effect to clear processed mediaKeys periodically
  useEffect(() => {
    const intervalId = setInterval(() => {
      processedMediaKeys.current.clear();
      recentlyPlayedLogger.debug('🧹 Cleared processed mediaKeys set');
    }, 5000);
    
    return () => clearInterval(intervalId);
  }, []);

  // Combine local and Firebase recently played NFTs with local taking priority
  // and deduplicate them based on mediaKey
  const validRecentlyPlayedNFTs = useMemo(() => {
    // First add all local recently played NFTs
    let combined = [...localRecentlyPlayed];
    
    // Then add Firebase NFTs only if they don't already exist in the local list
    firebaseRecentlyPlayed.forEach(firebaseNFT => {
      const firebaseMediaKey = firebaseNFT.mediaKey || getMediaKey(firebaseNFT);
      
      // Skip if the NFT is already in the combined list (prioritize local state)
      const existsInCombined = combined.some(localNFT => {
        const localMediaKey = localNFT.mediaKey || getMediaKey(localNFT);
        return localMediaKey === firebaseMediaKey;
      });
      
      if (!existsInCombined) {
        combined.push(firebaseNFT);
      }
    });
    
    // Filter out invalid NFTs
    return combined.filter(nft => {
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
        recentlyPlayedLogger.warn('Filtering invalid NFT from recently played:', {
          nft,
          reason: !hasDisplayInfo ? 'missing display info' : 'missing media'
        });
      }
      
      return hasDisplayInfo && hasMedia;
    });
  }, [localRecentlyPlayed, firebaseRecentlyPlayed]);

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
  if (isLoading) {
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
                        isPlaying={Boolean(isPlaying && currentlyPlaying === (nft.mediaKey || getMediaKey(nft)))}
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

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(RecentlyPlayed, (prevProps, nextProps) => {
  // Return true if props are equal (component shouldn't re-render)
  // Re-render if:
  // 1. userFid changes (different user)
  // 2. currentlyPlaying changes (different NFT playing)
  // 3. isPlaying changes (play state changes)
  // 4. recentlyAddedNFT changes (new NFT was added to the recently played list)
  // 5. isNFTLiked function changes (liked NFTs updated)
  
  const userFidEqual = prevProps.userFid === nextProps.userFid;
  const currentlyPlayingEqual = prevProps.currentlyPlaying === nextProps.currentlyPlaying;
  const isPlayingEqual = prevProps.isPlaying === nextProps.isPlaying;
  
  // CRITICAL: For immediate updates to recently played, we need to check if the ref itself
  // or its current value has changed. This ensures we re-render when a new NFT is played
  // even before it reaches the 25% threshold.
  const recentlyAddedNFTEqual = 
    (!prevProps.recentlyAddedNFT && !nextProps.recentlyAddedNFT) || // both are null/undefined
    (prevProps.recentlyAddedNFT && nextProps.recentlyAddedNFT && 
     prevProps.recentlyAddedNFT.current === nextProps.recentlyAddedNFT.current); // same current value
  
  // NEW: Check if isNFTLiked function has changed (when liked NFTs are loaded)
  const isNFTLikedEqual = prevProps.isNFTLiked === nextProps.isNFTLiked;
  
  // Return true if all are equal (no re-render needed)
  const shouldSkipRender = userFidEqual && currentlyPlayingEqual && 
                           isPlayingEqual && recentlyAddedNFTEqual && isNFTLikedEqual;
  
  // Log why we're re-rendering or not
  if (!shouldSkipRender) {
    recentlyPlayedLogger.debug('RecentlyPlayed will re-render due to prop changes:', {
      userFidChanged: !userFidEqual,
      currentlyPlayingChanged: !currentlyPlayingEqual,
      isPlayingChanged: !isPlayingEqual,
      recentlyAddedNFTChanged: !recentlyAddedNFTEqual,
      isNFTLikedChanged: !isNFTLikedEqual,
      recentlyAddedValue: nextProps.recentlyAddedNFT?.current?.substring(0, 8) || 'none'
    });
  }
  
  // Always return a boolean value to satisfy TypeScript
  return shouldSkipRender === true;
});
