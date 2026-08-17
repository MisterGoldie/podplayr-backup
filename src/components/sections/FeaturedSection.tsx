'use client';

import React from 'react';
import type { NFT } from '~/types/nft';
import { NFTCard } from '../nft/NFTCard';
import { getMediaKey } from '~/utils/media';
import { FEATURED_NFTS } from '~/data/featuredNfts';

export { FEATURED_NFTS, findFeaturedNft, withFeaturedCover } from '~/data/featuredNfts';

interface FeaturedSectionProps {
  onPlayNFT: (nft: NFT, context?: { queue?: NFT[], queueType?: string }) => Promise<void>;
  handlePlayPause: () => void;
  currentlyPlaying: string | null;
  isPlaying: boolean;
  onLikeToggle: (nft: NFT) => Promise<void>;
  isNFTLiked: (nft: NFT) => boolean;
  userFid?: string;
  nfts?: NFT[];
}

const FeaturedSection: React.FC<FeaturedSectionProps> = ({
  onPlayNFT,
  handlePlayPause,
  currentlyPlaying,
  isPlaying,
  onLikeToggle,
  isNFTLiked,
  userFid,
  nfts = FEATURED_NFTS
}) => {
  return (
    <section className="w-full">
      <div className="container mx-auto px-4">
        <h2 className="text-lg font-semibold text-white/90 mb-3">Featured</h2>
        <div className="overflow-x-auto pb-2 hide-scrollbar">
          <div className="flex gap-4">
            {nfts.map((nft, index) => (
              <div key={`${nft.contract}-${nft.tokenId}`} className="flex-shrink-0 w-[180px]">
                <NFTCard
                  nft={nft}
                  onPlay={async (played) => {
                    await onPlayNFT(played, {
                      queue: nfts,
                      queueType: 'featured',
                    });
                  }}
                  isPlaying={Boolean(
                    isPlaying && (
                      currentlyPlaying === `${nft.contract}-${nft.tokenId}` ||
                      currentlyPlaying === getMediaKey(nft)
                    )
                  )}
                  currentlyPlaying={currentlyPlaying}
                  handlePlayPause={handlePlayPause}
                  onLikeToggle={() => onLikeToggle(nft)}
                  userFid={userFid}
                  isNFTLiked={() => isNFTLiked(nft)}
                  animationDelay={0.2 + (index * 0.05)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturedSection;
