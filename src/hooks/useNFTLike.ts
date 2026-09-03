import { useCallback } from 'react';
import type { NFT } from '../types/user';
import { useNFTNotification } from '../context/NFTNotificationContext';

interface UseNFTLikeProps {
  onLikeToggle: (nft: NFT) => Promise<boolean | void>;
  setIsLiked?: (isLiked: boolean) => void;
}

export const useNFTLike = ({ onLikeToggle, setIsLiked }: UseNFTLikeProps) => {
  const { showNotification } = useNFTNotification();

  const handleUnlike = useCallback(async (nft: NFT) => {
    showNotification('unlike', nft);
    try {
      const next = await onLikeToggle(nft);
      const liked = typeof next === 'boolean' ? next : false;
      setIsLiked?.(liked);
    } catch (error) {
      console.error('Error unliking NFT:', error);
    }
  }, [onLikeToggle, showNotification, setIsLiked]);

  const handleLike = useCallback(async (nft: NFT) => {
    showNotification('like', nft);
    try {
      const next = await onLikeToggle(nft);
      const liked = typeof next === 'boolean' ? next : true;
      setIsLiked?.(liked);
    } catch (error) {
      console.error('Error liking NFT:', error);
    }
  }, [onLikeToggle, showNotification, setIsLiked]);

  return {
    handleLike,
    handleUnlike,
  };
};
