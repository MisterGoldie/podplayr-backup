import React from 'react';
import { NFT } from '../../types/user';
import { NFTCard } from './NFTCard';
import { getMediaKey } from '../../utils/media';
import { NFTImage } from '../media/NFTImage'; // Add this import

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
      
      {/* Grid container with fixed-width cards */}
      <div className="flex flex-wrap justify-center gap-4 pb-32">
        {nfts.map((nft, index) => {
          const mediaKey = getMediaKey(nft);
          const uniqueKey = `user-profile-${mediaKey || `${nft.contract}-${nft.tokenId}`}-${index}`;
          const staggerDelay = 0.05 * (index % 8);
          
          return (
            <div key={uniqueKey} className="w-40 h-40 flex-shrink-0 relative group cursor-pointer" onClick={() => onPlayNFT(nft)}>
              {/* NFT Image */}
              <div className="w-full h-full rounded-lg overflow-hidden bg-gray-800/20 shadow-lg">
                <NFTImage
                  nft={nft}
                  src={nft.image || nft.metadata?.image || '/default-nft.png'}
                  alt={nft.name}
                  className="w-full h-full object-cover"
                  width={160}
                  height={160}
                  loading="lazy"
                />
                
                {/* Overlay gradient for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                {/* Title overlay - appears on hover */}
                <div className="absolute bottom-0 left-0 right-0 p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <h3 className="text-xs font-medium truncate">{nft.name}</h3>
                </div>
                
                {/* Like button */}
                {userFid && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onLikeToggle) onLikeToggle(nft);
                    }}
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-red-500 transition-all duration-300 hover:scale-125 z-10"
                  >
                    {isNFTLiked && isNFTLiked(nft) ? (
                      // Filled heart for liked NFTs
                      <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                        <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                      </svg>
                    ) : (
                      // Unfilled heart for non-liked NFTs
                      <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor" className="text-white hover:text-red-500">
                        <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
