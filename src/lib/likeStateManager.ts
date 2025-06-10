import { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Create a dedicated logger for like state management
const likeLogger = {
  debug: (message: string, ...args: any[]) => logger.debug(`[LikeState] ${message}`, ...args),
  info: (message: string, ...args: any[]) => logger.info(`[LikeState] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(`[LikeState] ${message}`, ...args),
  error: (message: string, ...args: any[]) => logger.error(`[LikeState] ${message}`, ...args),
};

// Declare global window properties
declare global {
  interface Window {
    __LIKED_MEDIA_KEYS: Set<string>;
    __LIKE_UPDATE_INTERVAL: number;
    __LIKE_OBSERVER: MutationObserver;
  }
}

// Singleton class to manage like state across the application
class LikeStateManager {
  private static instance: LikeStateManager;
  private likedMediaKeys: Set<string> = new Set();
  private observers: Set<() => void> = new Set();
  private initialized: boolean = false;
  private updateInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  public static getInstance(): LikeStateManager {
    if (!LikeStateManager.instance) {
      LikeStateManager.instance = new LikeStateManager();
    }
    return LikeStateManager.instance;
  }

  public initialize(): void {
    if (this.initialized) return;
    
    likeLogger.info('Initializing LikeStateManager');
    
    // Load from localStorage
    this.loadFromLocalStorage();
    
    // Set up interval for periodic DOM updates
    if (typeof window !== 'undefined') {
      // Make the set available globally
      window.__LIKED_MEDIA_KEYS = this.likedMediaKeys;
      
      // Set up periodic DOM updates (every 500ms)
      this.updateInterval = window.setInterval(() => {
        this.updateDOM();
      }, 500);
      
      // Store reference to prevent garbage collection
      window.__LIKE_UPDATE_INTERVAL = this.updateInterval;
      
      // Set up mutation observer to catch DOM changes
      this.setupMutationObserver();
      
      // Update DOM on visibility change
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.updateDOM();
        }
      });
      
      // Update DOM on scroll events (for lazy-loaded content)
      document.addEventListener('scroll', () => {
        setTimeout(() => this.updateDOM(), 100);
      }, { passive: true });
    }
    
    this.initialized = true;
  }

  private setupMutationObserver(): void {
    if (typeof window === 'undefined' || !document.body) return;
    
    try {
      this.mutationObserver = new MutationObserver((mutations) => {
        let needsUpdate = false;
        
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of Array.from(mutation.addedNodes)) {
              if (node instanceof HTMLElement) {
                if (node.hasAttribute('data-media-key') || 
                    node.querySelectorAll('[data-media-key]').length > 0) {
                  needsUpdate = true;
                  break;
                }
              }
            }
          } else if (mutation.type === 'attributes' && 
                    mutation.attributeName === 'data-media-key') {
            needsUpdate = true;
          }
        }
        
        if (needsUpdate) {
          this.updateDOM();
        }
      });
      
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-media-key']
      });
      
      // Store reference to prevent garbage collection
      if (window) {
        window.__LIKE_OBSERVER = this.mutationObserver;
      }
      
      likeLogger.info('MutationObserver setup complete');
    } catch (error) {
      likeLogger.error('Failed to set up MutationObserver:', error);
    }
  }

  public addLikedNFT(nft: NFT): void {
    if (!nft) return;
    
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return;
    
    this.likedMediaKeys.add(mediaKey);
    this.saveToLocalStorage();
    this.updateDOM();
    this.notifyObservers();
    
    likeLogger.info(`Added liked NFT: ${nft.name} (${mediaKey})`);
  }

  public removeLikedNFT(nft: NFT): void {
    if (!nft) return;
    
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return;
    
    this.likedMediaKeys.delete(mediaKey);
    this.saveToLocalStorage();
    this.updateDOM();
    this.notifyObservers();
    
    likeLogger.info(`Removed liked NFT: ${nft.name} (${mediaKey})`);
  }

  public isNFTLiked(nft: NFT): boolean {
    if (!nft) return false;
    
    const mediaKey = nft.mediaKey || getMediaKey(nft);
    if (!mediaKey) return false;
    
    return this.likedMediaKeys.has(mediaKey);
  }

  public setLikedMediaKeys(mediaKeys: string[]): void {
    this.likedMediaKeys = new Set(mediaKeys);
    this.saveToLocalStorage();
    this.updateDOM();
    this.notifyObservers();
    
    likeLogger.info(`Set ${mediaKeys.length} liked media keys`);
  }

  public getLikedMediaKeys(): string[] {
    return Array.from(this.likedMediaKeys);
  }

  public addObserver(callback: () => void): () => void {
    this.observers.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.observers.delete(callback);
    };
  }

  private notifyObservers(): void {
    this.observers.forEach(callback => {
      try {
        callback();
      } catch (error) {
        likeLogger.error('Error in observer callback:', error);
      }
    });
  }

  private loadFromLocalStorage(): void {
    if (typeof window === 'undefined') return;
    
    try {
      const savedLikes = localStorage.getItem('podplayr_liked_media_keys');
      if (savedLikes) {
        const likedKeys = JSON.parse(savedLikes) as string[];
        this.likedMediaKeys = new Set(likedKeys);
        
        likeLogger.info(`Loaded ${likedKeys.length} liked media keys from localStorage`);
      }
    } catch (error) {
      likeLogger.error('Failed to load likes from localStorage:', error);
    }
  }

  private saveToLocalStorage(): void {
    if (typeof window === 'undefined') return;
    
    try {
      const likedKeys = Array.from(this.likedMediaKeys);
      localStorage.setItem('podplayr_liked_media_keys', JSON.stringify(likedKeys));
      
      likeLogger.debug(`Saved ${likedKeys.length} liked media keys to localStorage`);
    } catch (error) {
      likeLogger.error('Failed to save likes to localStorage:', error);
    }
  }

  public updateDOM(): void {
    if (typeof window === 'undefined') return;
    
    try {
      // First reset all elements with data-media-key
      document.querySelectorAll('[data-media-key]').forEach(element => {
        const mediaKey = element.getAttribute('data-media-key');
        if (!mediaKey || !this.likedMediaKeys.has(mediaKey)) {
          element.setAttribute('data-liked', 'false');
          element.setAttribute('data-is-liked', 'false');
          
          // Also update child elements
          const likeButtons = element.querySelectorAll('.like-button, [data-like-button]');
          likeButtons.forEach(button => {
            if (button instanceof HTMLElement) {
              button.setAttribute('data-liked', 'false');
              button.setAttribute('data-is-liked', 'false');
              button.classList.remove('liked');
            }
          });
        }
      });
      
      // Then update all liked elements
      this.likedMediaKeys.forEach(mediaKey => {
        document.querySelectorAll(`[data-media-key="${mediaKey}"]`).forEach(element => {
          element.setAttribute('data-liked', 'true');
          element.setAttribute('data-is-liked', 'true');
          
          // Also update child elements
          const likeButtons = element.querySelectorAll('.like-button, [data-like-button]');
          likeButtons.forEach(button => {
            if (button instanceof HTMLElement) {
              button.setAttribute('data-liked', 'true');
              button.setAttribute('data-is-liked', 'true');
              button.classList.add('liked');
            }
          });
        });
      });
    } catch (error) {
      // Ignore DOM errors
    }
  }

  public cleanup(): void {
    if (this.updateInterval && typeof window !== 'undefined') {
      window.clearInterval(this.updateInterval);
    }
    
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
    
    this.initialized = false;
  }
}

// Export a singleton instance
export const likeStateManager = LikeStateManager.getInstance();

// Initialize on module load
if (typeof window !== 'undefined') {
  // Initialize after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      likeStateManager.initialize();
    });
  } else {
    likeStateManager.initialize();
  }
}

// Helper functions for external use
export const addLikedNFT = (nft: NFT): void => {
  likeStateManager.addLikedNFT(nft);
};

export const removeLikedNFT = (nft: NFT): void => {
  likeStateManager.removeLikedNFT(nft);
};

export const isNFTLiked = (nft: NFT): boolean => {
  return likeStateManager.isNFTLiked(nft);
};

export const updateLikeDOM = (): void => {
  likeStateManager.updateDOM();
};

export const observeLikeChanges = (callback: () => void): () => void => {
  return likeStateManager.addObserver(callback);
};

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};
