'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Player } from './Player';
import { AdPlayer } from './AdPlayer';
import { useVideoPlay } from '../../contexts/VideoPlayContext';
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
}

export const PlayerWithAds: React.FC<PlayerWithAdsProps> = (props) => {
  const { playCount, incrementPlayCount, resetPlayCount } = useVideoPlay();
  const [navElement, setNavElement] = useState<HTMLElement | null>(null);
  const [showAd, setShowAd] = useState(false);
  const [adComplete, setAdComplete] = useState(false);
  const [hasShownFirstAd, setHasShownFirstAd] = useState(false);
  const [playsAfterAd, setPlaysAfterAd] = useState(0);
  
  // Add ref to track the current NFT
  const currentNftRef = useRef<string | null>(null);

  // Check if we need to show an ad when attempting to play a video
  useEffect(() => {
    if (!props.nft) return;
    
    // Create a unique ID for the current NFT
    const nftId = `${props.nft.contract}-${props.nft.tokenId}`;
    
    // Check if this is a new NFT (different from the previous one)
    const isNewNft = nftId !== currentNftRef.current;
    
    // Only increment play count and check for ads when a new NFT is played
    if (props.isPlaying && !showAd && isNewNft) {
      console.log('New NFT detected:', nftId, 'Previous:', currentNftRef.current);
      
      // Update the current NFT ref
      currentNftRef.current = nftId;
      
      // Increment play count
      incrementPlayCount();
      
      // Update plays after ad if we've already shown the first ad
      if (hasShownFirstAd) {
        setPlaysAfterAd(prev => prev + 1);
      }
      
      // Check if we need to show an ad
      if (!hasShownFirstAd && playCount >= 2) {
        console.log('Showing first ad after 3 plays');
        setShowAd(true);
        setHasShownFirstAd(true);
      } else if (hasShownFirstAd && playsAfterAd >= 8) {
        console.log('Showing subsequent ad after 9 more plays');
        setShowAd(true);
        setPlaysAfterAd(0); // Reset counter after showing ad
      }
    }
  }, [props.nft, props.isPlaying, playCount, playsAfterAd, hasShownFirstAd, incrementPlayCount]);

  // Force pause content if ad is showing and handle nav and header visibility
  useEffect(() => {
    // Get all elements we need to hide during ad display
    const nav = document.querySelector('nav');
    const headers = document.querySelectorAll('header'); // This gets all headers in any view
    
    if (showAd) {
      // Hide navigation
      if (nav) nav.style.display = 'none';
      
      // Hide all headers
      headers.forEach(header => {
        header.style.display = 'none';
      });
      
      // Pause the main content if it's playing
      if (props.isPlaying) props.onPlayPause();
    } else {
      // Show navigation when ad is not showing
      if (nav) nav.style.display = 'flex';
      
      // Show all headers
      headers.forEach(header => {
        header.style.display = 'flex';
      });
    }
  }, [showAd, props.isPlaying, props.onPlayPause]);

  const handleAdComplete = () => {
    setShowAd(false);
    setAdComplete(true);
    resetPlayCount();
    setPlaysAfterAd(0); // Reset the counter for plays after ad
    
    // Restore nav and headers
    const nav = document.querySelector('nav');
    const headers = document.querySelectorAll('header');
    
    if (nav) nav.style.display = 'flex';
    headers.forEach(header => {
      header.style.display = 'flex';
    });
    
    props.onPlayPause(); // Resume the main content
  };

  // Don't render anything until ad is complete if we're showing an ad
  if (showAd) {
    return <AdPlayer onAdComplete={handleAdComplete} />;
  }

  // Only render the Player when no ad is showing
  return <Player {...props} />;
}