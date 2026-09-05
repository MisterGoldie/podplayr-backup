import React from 'react';
import { NFT } from '../../types/user';
import { NFTCard } from './NFTCard';
import { PAGE_SIZE, usePagedItems } from '../../hooks/usePagedItems';

interface UserProfileNFTGridProps {
  nfts: NFT[];
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  onPlayNFT: (nft: NFT) => void;
  onLikeToggle?: (nft: NFT) => Promise<boolean | void>;
  isNFTLiked?: (nft: NFT) => boolean;
  userFid?: number;
  scrollRoot?: HTMLElement | null;
  resetKey?: string | number;
}

/**
 * A dedicated NFT grid component for user profiles with proper spacing
 */
export const UserProfileNFTGrid: React.FC<UserProfileNFTGridProps> = ({
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
}) => {
  const { visibleItems, hasMore, sentinelRef } = usePagedItems(nfts, {
    pageSize: PAGE_SIZE,
    resetKey: resetKey ?? userFid ?? '',
    scrollRoot,
  });

  return (
    <>
      <div className="flex flex-wrap justify-center gap-4 pb-32">
        {visibleItems.map((nft, index) => {
          const uniqueKey = `user-profile-${nft.contract}-${nft.tokenId}`;
          const staggerDelay = 0.05 * (index % 8);

          return (
            <div key={uniqueKey} className="w-40 flex-shrink-0">
              <NFTCard
                nft={nft}
                onPlay={async (nft) => onPlayNFT(nft)}
                isPlaying={isPlaying}
                currentlyPlaying={currentlyPlaying}
                handlePlayPause={handlePlayPause}
                onLikeToggle={onLikeToggle}
                userFid={userFid?.toString()}
                isNFTLiked={() => (isNFTLiked ? isNFTLiked(nft) : false)}
                animationDelay={staggerDelay}
                smallCard
              />
            </div>
          );
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" aria-hidden="true" />}
    </>
  );
};
