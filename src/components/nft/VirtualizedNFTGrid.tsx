import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { NFT } from '../../types/user';
import { NFTCard } from './NFTCard';
import { useVirtualizedNFTs } from '../../hooks/useVirtualizedNFTs';
import ErrorBoundary from '../ErrorBoundary';
import { isPlaybackActive, getMediaKey } from '../../utils/media';
import { predictivePreload } from '../../utils/videoPreloader';
import { logger } from '../../utils/logger';

interface VirtualizedNFTGridProps {
  nfts: NFT[];
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  onPlayNFT: (nft: NFT) => void;
  publicCollections: string[];
  addToPublicCollection?: (nft: NFT, collectionId: string) => void;
  removeFromPublicCollection?: (nft: NFT, collectionId: string) => void;
  onLikeToggle?: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT, ignoreCurrentPage?: boolean) => boolean;
  userFid?: number;
}

// Add keyframes style for the animation
const animationKeyframes = `
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

export const VirtualizedNFTGrid: React.FC<VirtualizedNFTGridProps> = ({
  nfts,
  currentlyPlaying,
  isPlaying,
  handlePlayPause,
  onPlayNFT,
  publicCollections,
  addToPublicCollection,
  removeFromPublicCollection,
  onLikeToggle,
  isNFTLiked,
  userFid,
}) => {
  const { visibleNFTs, isLoadingMore, hasMore, loadMoreNFTs } = useVirtualizedNFTs(nfts);
  const [animationKey, setAnimationKey] = useState(0);

  // Only log when not in playback mode to reduce noise
  useEffect(() => {
    if (!isPlaybackActive()) {
      console.log('Rendering VirtualizedNFTGrid with', visibleNFTs.length, 'visible NFTs out of', nfts.length, 'total');
    }
  }, [visibleNFTs.length, nfts.length]);
  
  // Memoized check function to avoid redundant processing
  const checkDirectlyLiked = useCallback((nftToCheck: NFT): boolean => {
    if (!isNFTLiked) return false;
    // Always use true for ignoreCurrentPage to get real like status regardless of page
    return isNFTLiked(nftToCheck, true);
  }, [isNFTLiked]);
  
  // Reduced logging - just once when component mounts and not during playback
  // Create a dedicated logger for the NFT grid
  const gridLogger = logger.getModuleLogger('virtualizedNFTGrid');
  
  useEffect(() => {
    // Only log when not in playback mode
    if (!isPlaybackActive()) {
      gridLogger.debug('VirtualizedNFTGrid rendered with:', {
        hasLikeToggle: !!onLikeToggle,
        hasLikeCheck: !!isNFTLiked,
        userFid
      });
    }
  }, [onLikeToggle, isNFTLiked, userFid]);

  // When new NFTs are loaded, update the animation key
  useEffect(() => {
    if (visibleNFTs.length > 0) {
      setAnimationKey(prev => prev + 1);
    }
  }, [visibleNFTs.length]);

  // Memoize the NFT cards to prevent unnecessary re-renders
  const nftCards = useMemo(() => {
    return visibleNFTs.map((nft: any, index: number) => {
      // Calculate a staggered delay based on index
      // This creates a wave-like appearance as cards animate in
      const staggerDelay = 0.05 * (index % 8) + 0.2; // Base delay of 0.2s plus stagger
      
      // Create a truly unique key for each NFT
      // Use mediaKey if available, otherwise use contract and tokenId with index as fallback
      // Adding index ensures uniqueness even if duplicate NFTs exist in the data
      const uniqueKey = nft.mediaKey || `${nft.contract}-${nft.tokenId}`;
      const stableKey = `${uniqueKey}-${index}`;
      
      return (
        <ErrorBoundary key={`boundary-${stableKey}`}>
          <NFTCard
            key={stableKey}
            nft={nft}
            onPlay={async (nft) => {
              // Find this NFT's index in the visible NFTs array
              const currentIndex = visibleNFTs.findIndex(
                item => getMediaKey(item) === getMediaKey(nft)
              );
              
              // Use predictive preloading to improve playback experience
              if (currentIndex !== -1) {
                gridLogger.info('Predictively preloading next NFTs in Explore view', {
                  currentNFT: nft.name || 'Unknown NFT',
                  currentIndex
                });
                predictivePreload(visibleNFTs, currentIndex);
              }
              
              await onPlayNFT(nft);
            }}
            isPlaying={isPlaying}
            currentlyPlaying={currentlyPlaying}
            handlePlayPause={handlePlayPause}
            publicCollections={publicCollections}
            onAddToCollection={addToPublicCollection}
            onRemoveFromCollection={removeFromPublicCollection}
            showTitleOverlay={true}
            useCenteredPlay={true}
            onLikeToggle={onLikeToggle}
            userFid={userFid}
            isNFTLiked={checkDirectlyLiked}
            animationDelay={staggerDelay} // Pass the staggered delay
          />
        </ErrorBoundary>
      );
    });
  }, [visibleNFTs, animationKey, isPlaying, currentlyPlaying, handlePlayPause, publicCollections, addToPublicCollection, removeFromPublicCollection, onLikeToggle, userFid, checkDirectlyLiked, onPlayNFT]);
  
  return (
    <>
      {/* Add the keyframes style */}
      <style>{animationKeyframes}</style>
      
      {nftCards}
      
      {/* Keep only a simple completion message if needed */}
      {!hasMore && visibleNFTs.length > 0 && (
        <div className="col-span-full text-center py-8">
          <p className="font-mono text-gray-400 text-sm">All NFTs loaded</p>
        </div>
      )}
    </>
  );
};