import { v4 as uuidv4 } from 'uuid';
import type { NFT } from '../types/user';

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};

// Get optimized video URL (now just returns the original animation_url)
export const getOptimizedVideoUrl = (nft: NFT): string => {
  return nft.metadata?.animation_url || '';
};

// Preload video metadata
export const preloadVideo = async (nft: NFT): Promise<void> => {
  try {
    const url = await getOptimizedVideoUrl(nft);
    if (!url) return;

    // Create a temporary video element to preload metadata
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;

    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      // Timeout after 10 seconds
      setTimeout(reject, 10000);
    });
  } catch (error) {
    console.warn('Error preloading video:', error);
  }
};