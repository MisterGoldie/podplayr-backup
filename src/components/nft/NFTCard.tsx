'use client';

import React from 'react';
import { useFarcasterContext } from '~/app/providers';
import { NFT } from '~/types/nft';
import { useNFTLikeState } from '~/hooks/useNFTLikeState';
import { useNFTLike } from '~/hooks/useNFTLike';
import { NFTImage } from '../media/NFTImage';

interface NFTCardProps {
  nft: NFT;
  onPlay?: (nft: NFT) => Promise<void>;
  isPlaying?: boolean;
  currentlyPlaying?: string | null;
  handlePlayPause?: () => void;
  onLikeToggle?: (nft: NFT) => Promise<void>;
  userFid?: string;
  isNFTLiked?: () => boolean;
  playCountBadge?: string;
  animationDelay?: number;
  smallCard?: boolean;
}

export const NFTCard: React.FC<NFTCardProps> = ({ 
  nft,
  onPlay,
  isPlaying,
  currentlyPlaying,
  handlePlayPause,
  onLikeToggle,
  userFid,
  isNFTLiked,
  playCountBadge,
  animationDelay = 0,
  smallCard
}) => {
  const { fid } = useFarcasterContext();
  // Use userFid prop if available, otherwise fall back to context fid
  const effectiveFid = userFid ? parseInt(userFid) : fid;
  
  const { isLiked, likesCount, toggleLike } = useNFTLikeState(nft, effectiveFid);

  // Use the NFT like hook
  const { handleLike, handleUnlike } = useNFTLike({
    onLikeToggle: onLikeToggle || (async () => {
      // If no onLikeToggle is provided, use the default behavior
      if (!fid) return;
      await toggleLike();
    }),
    setIsLiked: (liked) => {
      // Update the local state if needed
      if (isNFTLiked) {
        isNFTLiked();
      }
    }
  });

  const rawImageUrl = nft.image || nft.metadata?.image || '';

  const handlePlay = () => {
    if (onPlay) {
      onPlay(nft);
    } else {
      console.log('Playing NFT:', nft.contract + '-' + nft.tokenId);
    }
  };

  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the card click
    // Use the prop function to check current state, fallback to hook state
    const currentlyLiked = isNFTLiked ? isNFTLiked() : isLiked;
    if (currentlyLiked) {
      handleUnlike(nft);
    } else {
      handleLike(nft);
    }
  };

  // Add animation styles - same as LibraryView
  const animationStyle = {
    opacity: 0,
    transform: 'translateY(20px)',
    animation: `fadeInUp 0.5s ease-out ${animationDelay}s forwards`
  };

  // Add keyframes style
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

  // Use the prop function to determine liked state, fallback to hook state
  const displayIsLiked = isNFTLiked ? isNFTLiked() : isLiked;

  return (
    <>
      <style>{animationKeyframes}</style>
      
      <div 
        className="relative group cursor-pointer" 
        onClick={handlePlay}
        style={animationStyle}
      >
        <div className="aspect-square rounded-lg overflow-hidden bg-gray-800/20 shadow-lg relative">
          <NFTImage
            nft={nft}
            src={rawImageUrl}
            alt={nft.name}
            className="w-full h-full object-cover"
            width={300}
            height={300}
            loading="lazy"
          />
          
          {/* Change this condition to use effectiveFid */}
          {effectiveFid && (
            <button 
              onClick={handleLikeClick}
              className={`absolute top-2 right-2 ${smallCard ? 'w-8 h-8' : 'w-10 h-10'} flex items-center justify-center text-red-500 transition-all duration-300 hover:scale-125 z-10`}
            >
              {displayIsLiked ? (
                <svg xmlns="http://www.w3.org/2000/svg" height={smallCard ? "20" : "24"} viewBox="0 -960 960 960" width={smallCard ? "20" : "24"} fill="currentColor">
                  <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" height={smallCard ? "20" : "24"} viewBox="0 -960 960 960" width={smallCard ? "20" : "24"} fill="currentColor" className="text-white hover:text-red-500">
                  <path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"/>
                </svg>
              )}
            </button>
          )}
        </div>
        
        <div className={smallCard ? "mt-1" : "mt-2"}>
          <h3 className={`font-medium text-white ${smallCard ? 'text-xs' : 'text-sm'} truncate`}>{nft.name}</h3>
          <div className={`flex items-center gap-2 text-gray-400 ${smallCard ? 'text-xs' : 'text-xs'}`}>
            {likesCount > 0 && <span>{likesCount} likes</span>}
          </div>
        </div>
      </div>
    </>
  );
};
