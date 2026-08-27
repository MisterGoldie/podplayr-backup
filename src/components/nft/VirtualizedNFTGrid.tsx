import React, { useCallback } from 'react';
import { NFT } from '../../types/user';
import { NFTCard } from './NFTCard';
import ErrorBoundary from '../ErrorBoundary';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';

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
  scrollRoot?: HTMLElement | null;
  resetKey?: string | number;
  showLibraryBadge?: boolean;
}

export const VirtualizedNFTGrid: React.FC<VirtualizedNFTGridProps> = ({
  nfts,
  currentlyPlaying,
  isPlaying,
  handlePlayPause,
  onPlayNFT,
  onLikeToggle,
  isNFTLiked,
  userFid,
  scrollRoot,
  resetKey,
  showLibraryBadge = false,
}) => {
  const { visibleItems: visibleNFTs, hasMore, sentinelRef } = usePagedItems(nfts, {
    pageSize: PAGE_SIZE,
    resetKey: resetKey ?? userFid ?? '',
    scrollRoot,
  });

  const checkDirectlyLiked = useCallback((nftToCheck: NFT): boolean => {
    if (!isNFTLiked) return false;
    return isNFTLiked(nftToCheck, true);
  }, [isNFTLiked]);

  const handlePlay = useCallback(async (played: NFT) => {
    onPlayNFT(played);
  }, [onPlayNFT]);

  return (
    <>
      {visibleNFTs.map((nft, index) => {
        const staggerDelay = 0.05 * (index % 8) + 0.2;
        const uniqueKey = `${nft.contract}-${nft.tokenId}`;
        const stableKey = `${uniqueKey}-${index}`;

        return (
          <ErrorBoundary key={`boundary-${stableKey}`}>
            <NFTCard
              nft={nft}
              onPlay={handlePlay}
              isPlaying={isPlaying}
              currentlyPlaying={currentlyPlaying}
              handlePlayPause={handlePlayPause}
              onLikeToggle={onLikeToggle}
              userFid={userFid?.toString()}
              isNFTLiked={() => checkDirectlyLiked(nft)}
              animationDelay={staggerDelay}
              showLibraryBadge={showLibraryBadge}
              allowHide
            />
          </ErrorBoundary>
        );
      })}

      {hasMore && <div ref={sentinelRef} className="col-span-full h-8" aria-hidden="true" />}
    </>
  );
};
