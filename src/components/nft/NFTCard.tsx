'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useFarcasterContext } from '~/app/providers';
import { NFT } from '~/types/nft';
import { useNFTLikeState } from '~/hooks/useNFTLikeState';
import { useNFTLike } from '~/hooks/useNFTLike';
import { NFTImage } from '../media/NFTImage';
import { NFTGifImage } from '../media/NFTGifImage';
import { shouldPreserveAnimation } from '../../utils/imageOptimizer';

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
  /** Extra "In Library" marker for liked NFTs on another user's profile. */
  showLibraryBadge?: boolean;
}

const NFTCardInner: React.FC<NFTCardProps> = ({ 
  nft,
  onPlay,
  onLikeToggle,
  userFid,
  isNFTLiked,
  animationDelay = 0,
  smallCard,
  showLibraryBadge = false
}) => {
  const { fid } = useFarcasterContext();
  // Use userFid prop if available, otherwise fall back to context fid
  const effectiveFid = userFid ? parseInt(userFid) : fid;
  
  // When the caller already tracks liked state itself (isNFTLiked prop), skip our
  // own live "is this liked by me" subscription — it'd be a redundant listener,
  // since displayIsLiked below prefers isNFTLiked() whenever it's provided.
  // Like counts are read once rather than kept live to avoid piling up dozens of
  // concurrent listeners in large grids (e.g. the Library view).
  const { isLiked, toggleLike } = useNFTLikeState(nft, effectiveFid, {
    watchIsLiked: !isNFTLiked,
    watchCount: false,
  });

  // Use the NFT like hook
  const { handleLike, handleUnlike } = useNFTLike({
    onLikeToggle: onLikeToggle || (async () => {
      if (!fid) return;
      await toggleLike();
    }),
  });

  const rawImageUrl = nft.image || nft.metadata?.image || '';
  const [hasEntered, setHasEntered] = useState(false);
  const enterStyleRef = useRef(
    animationDelay ? { animationDelay: `${animationDelay}s` } : undefined
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setHasEntered(true),
      (animationDelay || 0) * 1000 + 500
    );
    return () => window.clearTimeout(timeout);
  }, [animationDelay]);

  const handlePlay = () => {
    console.log('[PLAY-DEBUG] card click', {
      name: nft.name,
      contract: nft.contract,
      tokenId: nft.tokenId,
      audio: nft.audio,
      animation: nft.metadata?.animation_url,
    });
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

  const displayIsLiked = isNFTLiked ? isNFTLiked() : isLiked;

  return (
    <div 
      className={`relative group cursor-pointer${hasEntered ? '' : ' nft-card-enter'}`} 
      onClick={handlePlay}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setHasEntered(true);
      }}
      style={hasEntered ? undefined : enterStyleRef.current}
    >
        <div className="aspect-square rounded-lg overflow-hidden bg-gray-800/20 shadow-lg relative">
          {shouldPreserveAnimation(rawImageUrl) ? (
            <NFTGifImage
              nft={nft}
              className="w-full h-full object-cover"
              width={smallCard ? 160 : 180}
              height={smallCard ? 160 : 180}
              priority={!smallCard}
            />
          ) : (
            <NFTImage
              nft={nft}
              src={rawImageUrl}
              alt={nft.name}
              className="w-full h-full object-cover"
              width={smallCard ? 160 : 180}
              height={smallCard ? 160 : 180}
              sizes={smallCard ? '160px' : '180px'}
              quality={60}
              loading="lazy"
            />
          )}
          
          {/* Change this condition to use effectiveFid */}
          {effectiveFid && (
            <button 
              onClick={handleLikeClick}
              className={`absolute top-2 right-2 ${smallCard ? 'w-8 h-8' : 'w-10 h-10'} flex items-center justify-center text-red-500 z-10 active:scale-95 touch-manipulation`}
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
          {showLibraryBadge && displayIsLiked && (
            <div className="absolute bottom-2 left-2 z-10 pointer-events-none">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 border border-green-400/40 text-green-400 font-mono text-[10px] leading-none shadow-lg shadow-black/40">
                <svg xmlns="http://www.w3.org/2000/svg" height="12" viewBox="0 -960 960 960" width="12" fill="currentColor">
                  <path d="M200-120v-665q0-24 18-42t42-18h440q24 0 42 18t18 42v665L480-240 200-120Z"/>
                </svg>
                In Library
              </span>
            </div>
          )}
        </div>
        
        <div className={smallCard ? "mt-1" : "mt-2"}>
          <h3 className={`font-medium text-white ${smallCard ? 'text-xs' : 'text-sm'} truncate`}>{nft.name}</h3>
        </div>
    </div>
  );
};

function areNftCardsEqual(prev: NFTCardProps, next: NFTCardProps) {
  return (
    prev.nft === next.nft &&
    prev.userFid === next.userFid &&
    prev.smallCard === next.smallCard &&
    prev.showLibraryBadge === next.showLibraryBadge &&
    prev.animationDelay === next.animationDelay &&
    prev.onPlay === next.onPlay &&
    prev.onLikeToggle === next.onLikeToggle &&
    prev.isNFTLiked === next.isNFTLiked
  );
}

export const NFTCard = React.memo(NFTCardInner, areNftCardsEqual);
