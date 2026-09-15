// Remove this line:
// 'use client';
import React, { useContext, useEffect, useState } from 'react';
import { MinimizedPlayer } from './MinimizedPlayer';
import { MaximizedPlayer, PLAYER_SLIDE_MS } from './MaximizedPlayer';
import type { NFT } from '../../types/user';
import { UserFidContext } from '../../app/providers';
import { getNftPlaybackPlan } from '../../utils/isMediaNFT';

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
  onOpenArtistProfile?: (fid: number) => void;
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
  userFid: propUserFid,
  onOpenArtistProfile,
}) => {
  const { fid: contextFid } = useContext(UserFidContext);
  const userFid = propUserFid ?? contextFid ?? 0;

  const handleMinimizeToggle = () => {
    onMinimizeToggle();
  };

  // MaximizedPlayer owns the <video> element. Once the user opens it for the
  // first time, keep it mounted (just hidden via CSS) instead of unmounting
  // on every minimize — unmounting destroys the <video> node and forces a
  // full refetch the next time it's maximized, which is what caused the
  // multi-second reload delay. Before the first maximize we skip mounting it
  // entirely so audio-only listening doesn't pay for video downloads.
  // Keep the <video> node mounted for video NFTs even while minimized so
  // picture and sound share one element from the first play().
  const keepVideoMounted = Boolean(
    nft.isVideo || nft.videoUrl || getNftPlaybackPlan(nft).videoUrl
  );
  const [hasMaximizedOnce, setHasMaximizedOnce] = useState(!isMinimized || keepVideoMounted);
  useEffect(() => {
    if (!isMinimized || keepVideoMounted) setHasMaximizedOnce(true);
  }, [isMinimized, keepVideoMounted]);

  // The minimized bar used to appear and vanish in a single frame. Keep it
  // mounted until its slide-out finishes, and hold it below the viewport for
  // one frame on the way in, so both directions travel instead of popping.
  const [renderMinimized, setRenderMinimized] = useState(isMinimized);
  // Starts parked even on first mount so pressing an NFT card slides the bar up
  // rather than snapping it into place.
  const [minimizedSlidIn, setMinimizedSlidIn] = useState(false);

  useEffect(() => {
    let rafOuter = 0;
    let rafInner = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (isMinimized) {
      setRenderMinimized(true);
      rafOuter = requestAnimationFrame(() => {
        rafInner = requestAnimationFrame(() => setMinimizedSlidIn(true));
      });
    } else {
      setMinimizedSlidIn(false);
      timer = setTimeout(() => setRenderMinimized(false), PLAYER_SLIDE_MS);
    }

    return () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
      if (timer) clearTimeout(timer);
    };
  }, [isMinimized]);

  return (
    <>
      {hasMaximizedOnce && (
        <MaximizedPlayer
          nft={nft}
          isMinimized={isMinimized}
          isAnimating={false}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          onNext={onNext}
          onPrevious={onPrevious}
          onMinimizeToggle={handleMinimizeToggle}
          progress={progress}
          duration={duration}
          onSeek={onSeek}
          onLikeToggle={onLikeToggle}
          isLiked={isLiked}
          onPictureInPicture={onPictureInPicture}
          lastPosition={progress}
          onOpenArtistProfile={onOpenArtistProfile}
        />
      )}
      {renderMinimized && (
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
          slideIn={minimizedSlidIn}
          userFid={typeof userFid === 'number' ? userFid : undefined}
          onOpenArtistProfile={onOpenArtistProfile}
        />
      )}
    </>
  );
};