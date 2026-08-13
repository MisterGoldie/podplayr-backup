'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Player } from './Player';
import { AdPlayer } from './AdPlayer';
import type { NFT } from '../../types/user';

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
  onAdStateChange?: (isAdPlaying: boolean) => void;
}

const FIRST_AD_MIN = 1;
const FIRST_AD_MAX = 3;
const NEXT_AD_MIN = 4;
const NEXT_AD_MAX = 7;
const MIN_MS_BETWEEN_ADS = 3 * 60 * 1000;

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export const PlayerWithAds: React.FC<PlayerWithAdsProps> = (props) => {
  const [showAd, setShowAd] = useState(false);
  const currentNftRef = useRef<string | null>(null);
  const uniquePlaysRef = useRef(0);
  const playsUntilNextAdRef = useRef(randomInt(FIRST_AD_MIN, FIRST_AD_MAX));
  const lastAdAtRef = useRef(0);
  const onPlayPauseRef = useRef(props.onPlayPause);
  const onAdStateChangeRef = useRef(props.onAdStateChange);

  onPlayPauseRef.current = props.onPlayPause;
  onAdStateChangeRef.current = props.onAdStateChange;

  useEffect(() => {
    if (!props.nft || !props.isPlaying || showAd) return;

    const nftId = `${props.nft.contract}-${props.nft.tokenId}`;
    if (nftId === currentNftRef.current) return;
    currentNftRef.current = nftId;

    uniquePlaysRef.current += 1;

    const due = uniquePlaysRef.current >= playsUntilNextAdRef.current;
    const cooledDown =
      lastAdAtRef.current === 0 ||
      Date.now() - lastAdAtRef.current >= MIN_MS_BETWEEN_ADS;

    if (due && cooledDown) {
      setShowAd(true);
    }
  }, [props.nft, props.isPlaying, showAd]);

  useEffect(() => {
    onAdStateChangeRef.current?.(showAd);
    if (showAd) {
      onPlayPauseRef.current();
    }
  }, [showAd]);

  const handleAdComplete = () => {
    lastAdAtRef.current = Date.now();
    playsUntilNextAdRef.current =
      uniquePlaysRef.current + randomInt(NEXT_AD_MIN, NEXT_AD_MAX);
    setShowAd(false);
    onAdStateChangeRef.current?.(false);
    onPlayPauseRef.current();
  };

  if (showAd) {
    return <AdPlayer onAdComplete={handleAdComplete} />;
  }

  if (!props.nft) {
    return null;
  }

  const { onPlayNFT: _onPlayNFT, onAdStateChange: _onAdStateChange, ...playerProps } = props;
  return <Player {...playerProps} nft={props.nft} />;
};
