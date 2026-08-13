import { useCallback } from 'react';
import type { NFT } from '../types/user';
import { useNFTNotification } from '../context/NFTNotificationContext';

interface UseNFTLikeProps {
  onLikeToggle: (nft: NFT) => Promise<void>;
  setIsLiked?: (isLiked: boolean) => void;
}

export const useNFTLike = ({ onLikeToggle, setIsLiked }: UseNFTLikeProps) => {
  const nftNotification = useNFTNotification();

  const handleUnlike = useCallback(async (nft: NFT) => {
    try {
      await onLikeToggle(nft);
      nftNotification.showNotification('unlike', nft);
      setIsLiked?.(false);
    } catch (error) {
      console.error('Error unliking NFT:', error);
    }
  }, [onLikeToggle, nftNotification, setIsLiked]);

  const handleLike = useCallback(async (nft: NFT) => {
    try {
      await onLikeToggle(nft);
      nftNotification.showNotification('like', nft);
      setIsLiked?.(true);
    } catch (error) {
      console.error('Error liking NFT:', error);
    }
  }, [onLikeToggle, nftNotification, setIsLiked]);

  return {
    handleLike,
    handleUnlike,
  };
};
