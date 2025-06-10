import type { NFT } from '../types/user';

// Mobile device detection
export const isMobileDevice = (): boolean => {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

// Determine if we should preload based on mobile context
export const shouldPreloadAsset = (nft: NFT, currentNFT: NFT | null, queue: NFT[]): boolean => {
  if (!isMobileDevice()) return true; // Always preload on desktop
  
  if (!currentNFT) return true; // Always preload if nothing is playing
  
  // On mobile, only preload:
  // 1. Currently playing NFT
  // 2. Next NFT in queue
  // 3. Previous NFT in queue
  const currentIndex = queue.findIndex(item => item === currentNFT);
  const nftIndex = queue.findIndex(item => item === nft);
  
  return (
    nft === currentNFT ||
    nftIndex === currentIndex + 1 || // Next track
    nftIndex === currentIndex - 1    // Previous track
  );
};

// Get optimal chunk size for mobile streaming
export const getMobileChunkSize = (): number => {
  // Smaller chunks for mobile to reduce memory usage
  return isMobileDevice() ? 256 * 1024 : 1024 * 1024; // 256KB for mobile, 1MB for desktop
};

// Clear old cached assets on mobile
export const cleanupMobileCache = () => {
  if (!isMobileDevice()) return;
  
  try {
    // Keep only recent items in localStorage
    const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('audio-cache-')) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || '{}');
          if (now - item.lastPlayed > maxCacheAge) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          console.warn('Failed to parse cached item:', e);
        }
      }
    });
  } catch (e) {
    console.warn('Failed to cleanup mobile cache:', e);
  }
};
