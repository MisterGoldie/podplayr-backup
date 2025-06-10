'use client';

import React, { useRef, useEffect } from 'react';
import { NFT } from '../../types/user';

interface UltraDirectPlayerProps {
  nft: NFT;
}

export const UltraDirectPlayer: React.FC<UltraDirectPlayerProps> = ({ nft }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Get most direct URL possible and use fastest gateway
  const url = nft.metadata?.animation_url || '';
  let directUrl = url;
  
  // Choose fastest gateway based on IPFS URL type
  if (typeof url === 'string') {
    if (url.includes('ipfs://')) {
      // Cloudflare's IPFS gateway is consistently the fastest
      directUrl = url.replace('ipfs://', 'https://cloudflare-ipfs.com/ipfs/');
    } else if (url.includes('ar://')) {
      directUrl = url.replace('ar://', 'https://arweave.net/');
    }
  }
  
  // Minimal setup with NO management code
  useEffect(() => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    
    // Let the browser handle everything natively - no JavaScript control
    video.playsInline = true;
    
    // Force hardware acceleration where available
    video.style.transform = 'translateZ(0)';
    
    // Remove any existing listeners to prevent duplicates
    const clonedVideo = video.cloneNode(true) as HTMLVideoElement;
    if (video.parentNode) {
      video.parentNode.replaceChild(clonedVideo, video);
    }
    
    // Reassign the ref
    videoRef.current = clonedVideo;
  }, [directUrl]);
  
  return (
    <video
      ref={videoRef}
      src={directUrl}
      controls
      muted
      autoPlay
      loop
      playsInline
      className="w-full h-full object-cover rounded-md"
      poster={nft.image || nft.metadata?.image || ''}
      style={{
        // Force hardware acceleration
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        // Remove any filters that could impact performance
        filter: 'none',
        WebkitFilter: 'none'
      }}
    />
  );
}; 