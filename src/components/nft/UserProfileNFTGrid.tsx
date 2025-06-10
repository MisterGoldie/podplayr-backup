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

  return (
    <>
      {/* Add the keyframes style */}
      <style>{animationKeyframes}</style>
      
      {/* Grid container with proper spacing */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-32">
        {nfts.map((nft, index) => {
          // Create a unique key that respects the mediaKey architecture
          const mediaKey = getMediaKey(nft);
          const uniqueKey = `user-profile-${mediaKey || `${nft.contract}-${nft.tokenId}`}-${index}`;
          
          // Calculate a staggered delay based on index
          const staggerDelay = 0.05 * (index % 8);
          
          return (
            <NFTCard
              key={uniqueKey}
              nft={nft}
              onPlay={async (nft) => {
                await onPlayNFT(nft);
              }}
              isPlaying={isPlaying}
              currentlyPlaying={currentlyPlaying}
              handlePlayPause={handlePlayPause}
              publicCollections={[]}
              showTitleOverlay={true}
              useCenteredPlay={true}
              onLikeToggle={onLikeToggle}
              userFid={userFid}
              isNFTLiked={isNFTLiked}
              animationDelay={staggerDelay}
            />
          );
        })}
      </div>
    </>
  );
};
