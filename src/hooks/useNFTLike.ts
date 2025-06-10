import { useState, useCallback } from 'react';
import type { NFT } from '../types/user';
import { useNFTNotification } from '../context/NFTNotificationContext';

interface UseNFTLikeProps {
  onLikeToggle: (nft: NFT) => Promise<void>;
  setIsLiked?: (isLiked: boolean) => void;
}

export const useNFTLike = ({ onLikeToggle, setIsLiked }: UseNFTLikeProps) => {
  const [nftToNotify, setNftToNotify] = useState<NFT | null>(null);
  const nftNotification = useNFTNotification();

  const handleUnlike = useCallback(async (nft: NFT) => {
    try {
      await onLikeToggle(nft);
      // Show notification
      nftNotification.showNotification('unlike', nft);
      // Reset notification state
      setNftToNotify(null);
      // Update liked state if setter is provided
      if (setIsLiked) {
        setIsLiked(false);
      }
    } catch (error) {
      console.error('Error unliking NFT:', error);
    }
  }, [onLikeToggle, nftNotification, setIsLiked]);

  const handleLike = useCallback(async (nft: NFT) => {
    try {
      await onLikeToggle(nft);
      // Show notification
      nftNotification.showNotification('like', nft);
      // Update liked state if setter is provided
      if (setIsLiked) {
        setIsLiked(true);
      }
    } catch (error) {
      console.error('Error liking NFT:', error);
    }
  }, [onLikeToggle, nftNotification, setIsLiked]);

  return {
    handleLike,
    handleUnlike,
    nftToNotify,
    setNftToNotify
  };
}; 