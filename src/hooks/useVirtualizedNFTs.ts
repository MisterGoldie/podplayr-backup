import { useState, useEffect, useCallback } from 'react';
import { NFT } from '../types/user';

// These constants control the NFT loading behavior
const INITIAL_LOAD = 24; // Increased initial load to show more NFTs at once 
const BATCH_SIZE = 24; // Double the batch size for more NFTs per load
const THRESHOLD = 1200; // Much larger threshold to trigger loading sooner

// Create an interface that extends NFT with a truly unique random ID for React keys
interface IndexedNFT extends NFT {
  _uniqueReactId: string; // Guaranteed unique random ID for React keys
}

// Generate a random string that's guaranteed to be unique
const generateUniqueId = (): string => {
  return `id_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
};

export const useVirtualizedNFTs = (allNFTs: NFT[]) => {
  const [visibleNFTs, setVisibleNFTs] = useState<IndexedNFT[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Initialize with first batch and reset loading state
  useEffect(() => {
    // Add a completely random unique ID to each NFT for guaranteed unique React keys
    const initialLoadCount = Math.min(INITIAL_LOAD, allNFTs.length);
    console.log(`Loading initial ${initialLoadCount} NFTs out of ${allNFTs.length} total`);
    
    const indexedInitialBatch = allNFTs.slice(0, initialLoadCount).map((nft) => ({
      ...nft,
      _uniqueReactId: generateUniqueId() // Add a random unique ID 
    }));
    
    setVisibleNFTs(indexedInitialBatch);
    setIsLoadingMore(false);
    
    // Force repeated scroll events to ensure more content loads
    const triggerScrolls = () => {
      window.dispatchEvent(new Event('scroll'));
      
      // If we haven't loaded everything, trigger another scroll soon
      if (initialLoadCount < allNFTs.length) {
        setTimeout(triggerScrolls, 800);
      }
    };
    
    // Start triggering scrolls after initial render
    setTimeout(triggerScrolls, 500);
  }, [allNFTs]);

  const loadMoreNFTs = useCallback(() => {
    if (isLoadingMore || visibleNFTs.length >= allNFTs.length) return;

    setIsLoadingMore(true);
    console.log(`Loading more NFTs: ${visibleNFTs.length} -> ${Math.min(visibleNFTs.length + BATCH_SIZE, allNFTs.length)}`);
    
    // Get next batch and add COMPLETELY RANDOM IDs to each NFT
    const nextBatch = allNFTs.slice(
      visibleNFTs.length,
      visibleNFTs.length + BATCH_SIZE
    ).map((nft) => ({
      ...nft,
      _uniqueReactId: generateUniqueId() // Guaranteed unique every time
    }));
    
    if (nextBatch.length > 0) {
      setVisibleNFTs(prev => [...prev, ...nextBatch]);
      
      // Allow next load after a short delay
      setTimeout(() => {
        setIsLoadingMore(false);
      }, 100);
    } else {
      setIsLoadingMore(false);
    }
  }, [allNFTs, visibleNFTs.length, isLoadingMore]);

  const handleScroll = useCallback(() => {
    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;
    
    if (documentHeight - scrollPosition < THRESHOLD) {
      loadMoreNFTs();
    }
  }, [loadMoreNFTs]);

  // Add scroll listener
  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return {
    visibleNFTs,
    isLoadingMore,
    hasMore: visibleNFTs.length < allNFTs.length,
    loadMoreNFTs
  };
};
