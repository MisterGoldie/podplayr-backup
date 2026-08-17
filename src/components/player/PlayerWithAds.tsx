'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Player } from './Player';
import { AdPlayer } from './AdPlayer';
import { preloadUpcomingAdWhenIdle } from './adQueue';
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
  onOpenArtistProfile?: (fid: number) => void;
  onAdStateChange?: (isAdPlaying: boolean) => void;
  showAd?: boolean;
  onAdComplete?: () => void;
}

const FIRST_AD_MIN = 1;
const FIRST_AD_MAX = 3;
const NEXT_AD_MIN = 4;
const NEXT_AD_MAX = 7;
const MIN_MS_BETWEEN_ADS = 3 * 60 * 1000;

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pre-roll only: decide before a new play starts. Never inserts mid-track. */
export function usePrerollAd() {
  const [showAd, setShowAd] = useState(false);
  const uniquePlaysRef = useRef(0);
  const playsUntilNextAdRef = useRef(randomInt(FIRST_AD_MIN, FIRST_AD_MAX));
  const lastAdAtRef = useRef(0);
  const afterAdRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    preloadUpcomingAdWhenIdle();
  }, []);

  const beforePlay = (run: () => void, pauseCurrent?: () => void) => {
    uniquePlaysRef.current += 1;
    const due = uniquePlaysRef.current >= playsUntilNextAdRef.current;
    const cooledDown =
      lastAdAtRef.current === 0 ||
      Date.now() - lastAdAtRef.current >= MIN_MS_BETWEEN_ADS;

    if (due && cooledDown) {
      afterAdRef.current = run;
      pauseCurrent?.();
      setShowAd(true);
      return;
    }

    run();
  };

  const onAdComplete = () => {
    lastAdAtRef.current = Date.now();
    playsUntilNextAdRef.current =
      uniquePlaysRef.current + randomInt(NEXT_AD_MIN, NEXT_AD_MAX);
    const run = afterAdRef.current;
    afterAdRef.current = null;
    setShowAd(false);
    run?.();
  };

  return { showAd, beforePlay, onAdComplete };
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
