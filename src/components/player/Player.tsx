// Remove this line:
// 'use client';
import React, { useContext, useRef, useEffect, useState } from 'react';
import { MinimizedPlayer } from './MinimizedPlayer';
import { MaximizedPlayer } from './MaximizedPlayer';
import type { NFT } from '../../types/user';
import { UserFidContext } from '../../app/providers';
import { useNFTLikeState } from '../../hooks/useNFTLikeState';
import { isPlaybackActive } from '../../utils/media';
import { useNFTQueue } from './hooks/useNFTQueue';

interface PlayerProps {
  nft: NFT;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  isMinimized: boolean;
  onMinimizeToggle: () => void;
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
  onLikeToggle?: (nft: NFT) => void;
  isLiked?: boolean;
  onPictureInPicture?: () => void;
  userFid?: number;
}

export const Player: React.FC<PlayerProps> = ({
  nft,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  isMinimized,
  onMinimizeToggle,
  progress,
  duration,
  onSeek,
  onLikeToggle,
  isLiked,
  onPictureInPicture,
  userFid: propUserFid
}) => {
  const contextUserFid = useContext(UserFidContext);
  const userFid = propUserFid ?? contextUserFid ?? 0;
  
  // Fix: useNFTLikeState expects (nft, fid) parameters, not an object
  const { isLiked: nftIsLiked, toggleLike } = useNFTLikeState(nft, typeof userFid === 'number' ? userFid : null);

  // REMOVE this useNFTQueue hook - we should use the props instead
  // const { handlePlayNext, handlePlayPrevious } = useNFTQueue({
  //   onPlayNFT: async (nextNft: NFT) => {
  //     // This will be handled by the parent component
  //     console.log('Playing next NFT:', nextNft.name);
  //   }
  // });

  // Simplified minimize toggle that doesn't interfere with audio
  const handleMinimizeToggle = () => {
    onMinimizeToggle();
  };
  
  // Only render one player component at a time to prevent conflicts
  if (isMinimized) {
    return (
      <MinimizedPlayer
        nft={nft}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
        onNext={onNext}  // Use the prop directly
        onPrevious={onPrevious}  // Use the prop directly
        onMinimizeToggle={handleMinimizeToggle}
        progress={progress}
        duration={duration}
        onSeek={onSeek}
        onLikeToggle={onLikeToggle}
        isLiked={isLiked}
        onPictureInPicture={onPictureInPicture}
        lastPosition={progress}
        isMinimized={isMinimized}
        isAnimating={false}
        userFid={typeof userFid === 'number' ? userFid : undefined}
      />
    );
  }
  
  return (
    <MaximizedPlayer
      nft={nft}
      isMinimized={isMinimized}
      isAnimating={false}
      isPlaying={isPlaying}
      onPlayPause={onPlayPause}
      onNext={onNext}  // Use the prop directly
      onPrevious={onPrevious}  // Use the prop directly
      onMinimizeToggle={handleMinimizeToggle}
      progress={progress}
      duration={duration}
      onSeek={onSeek}
      onLikeToggle={onLikeToggle}
      isLiked={isLiked}
      onPictureInPicture={onPictureInPicture}
      lastPosition={progress}
    />
  );
};