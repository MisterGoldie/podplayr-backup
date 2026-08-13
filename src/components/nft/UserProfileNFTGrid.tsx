import React from 'react';
import { NFT } from '../../types/user';
import { NFTCard } from './NFTCard';
import { getMediaKey } from '../../utils/media';

interface UserProfileNFTGridProps {
  nfts: NFT[];
  currentlyPlaying: string | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  onPlayNFT: (nft: NFT) => void;
  onLikeToggle?: (nft: NFT) => Promise<void>;
  isNFTLiked?: (nft: NFT) => boolean;
  userFid?: number;
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
}) => {
  return (
    <div className="flex flex-wrap justify-center gap-4 pb-32">
      {nfts.map((nft, index) => {
        const mediaKey = getMediaKey(nft);
        const uniqueKey = `user-profile-${mediaKey || `${nft.contract}-${nft.tokenId}`}-${index}`;
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
  );
};
