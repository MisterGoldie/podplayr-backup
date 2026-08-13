// Remove this line:
// 'use client';
import React, { useContext, useRef, useEffect, useState } from 'react';
import { MinimizedPlayer } from './MinimizedPlayer';
import { MaximizedPlayer } from './MaximizedPlayer';
import type { NFT } from '../../types/user';
import { UserFidContext } from '../../app/providers';

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

  // MaximizedPlayer owns the <video> element. Once the user opens it for the
  // first time, keep it mounted (just hidden via CSS) instead of unmounting
  // on every minimize — unmounting destroys the <video> node and forces a
  // full refetch the next time it's maximized, which is what caused the
  // multi-second reload delay. Before the first maximize we skip mounting it
  // entirely so audio-only listening doesn't pay for video downloads.
  const [hasMaximizedOnce, setHasMaximizedOnce] = useState(!isMinimized);
  useEffect(() => {
    if (!isMinimized) setHasMaximizedOnce(true);
  }, [isMinimized]);

  return (
    <>
      {hasMaximizedOnce && (
        <div className={isMinimized ? 'hidden' : ''}>
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
        </div>
      )}
      {isMinimized && (
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
      )}
    </>
  );
};