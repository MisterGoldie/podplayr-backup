import { useState, useCallback } from 'react';
import type { NFT } from '../../../types/user';
import { getMediaKey } from '../../../utils/media';

interface UseNFTQueueProps {
  onPlayNFT: (nft: NFT) => Promise<void>;
}

export const useNFTQueue = ({ onPlayNFT }: UseNFTQueueProps) => {
  const [currentNFTQueue, setCurrentNFTQueue] = useState<NFT[]>([]);
  const [currentQueueType, setCurrentQueueType] = useState<string>('');

  const handlePlayNext = useCallback(async (currentNFT: NFT | null) => {
    if (!currentNFT || currentNFTQueue.length === 0) return;
    
    const currentIndex = currentNFTQueue.findIndex(
      (nft) => getMediaKey(nft) === getMediaKey(currentNFT)
    );
    
    if (currentIndex === -1) return;
    
    const nextIndex = (currentIndex + 1) % currentNFTQueue.length;
    const nextNFT = currentNFTQueue[nextIndex];
    
    await onPlayNFT(nextNFT);
  }, [currentNFTQueue, onPlayNFT]);

  const handlePlayPrevious = useCallback(async (currentNFT: NFT | null) => {
    if (!currentNFT || currentNFTQueue.length === 0) return;
    
    const currentIndex = currentNFTQueue.findIndex(
      (nft) => getMediaKey(nft) === getMediaKey(currentNFT)
    );
    
    if (currentIndex === -1) return;
    
    const prevIndex = (currentIndex - 1 + currentNFTQueue.length) % currentNFTQueue.length;
    const prevNFT = currentNFTQueue[prevIndex];
    
    await onPlayNFT(prevNFT);
  }, [currentNFTQueue, onPlayNFT]);

  const updateQueue = useCallback((nfts: NFT[], queueType: string) => {
    setCurrentNFTQueue(nfts);
    setCurrentQueueType(queueType);
    // Update global NFT list for backward compatibility
    window.nftList = nfts;
  }, []);

  return {
    currentNFTQueue,
    currentQueueType,
    handlePlayNext,
    handlePlayPrevious,
    updateQueue
  };
}; 