'use client';

import React from 'react';
import { Player } from './Player';
import { AdPlayer } from './AdPlayer';
import type { NFT } from '../../types/user';

export { usePrerollAd } from '../../hooks/usePrerollAd';

interface PlayerWithAdsProps {
  nft?: NFT | null;
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
  onPlayNFT: (nft: NFT) => Promise<void>;
  onOpenArtistProfile?: (fid: number) => void;
  onAdStateChange?: (isAdPlaying: boolean) => void;
  showAd?: boolean;
  onAdComplete?: () => void;
}

export const PlayerWithAds: React.FC<PlayerWithAdsProps> = (props) => {
  const { showAd, onAdComplete, onAdStateChange: _onAdStateChange, onPlayNFT: _onPlayNFT, ...playerProps } = props;

  if (showAd) {
    return <AdPlayer onAdComplete={onAdComplete} />;
  }

  if (!props.nft) {
    return null;
  }

  return <Player {...playerProps} nft={props.nft} />;
};
