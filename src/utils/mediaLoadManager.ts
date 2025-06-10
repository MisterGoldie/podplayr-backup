import { NFT } from '../types/user';
import { v4 as uuidv4 } from 'uuid';

interface LoadProgress {
  loaded: number;
  total: number;
  status: 'pending' | 'loading' | 'complete' | 'error';
  retryCount: number;
}

class MediaLoadManager {
  private static instance: MediaLoadManager;
  private loadingQueue: Map<string, Promise<void>> = new Map();
  private loadProgress: Map<string, LoadProgress> = new Map();
  private loadedAssets: Set<string> = new Set();
  private loadAttempts: Map<string, number> = new Map();
  private activeListeners: Map<string, Set<(progress: number) => void>> = new Map();
  private maxConcurrent = 3;
  private activeLoads = 0;
  private maxRetries = 3;
  private mountId: string = Math.random().toString(36).substring(7);
  private lastMountTime: number = Date.now();
  private batchTimeout: NodeJS.Timeout | null = null;
  private pendingBatch: Set<NFT> = new Set();
  private waitingQueue: Array<{ nft: NFT; priority: 'high' | 'medium' | 'low'; timestamp: number }> = [];
  
  private constructor() {}

  public static getInstance(): MediaLoadManager {
    if (!MediaLoadManager.instance) {
      MediaLoadManager.instance = new MediaLoadManager();
    }
    return MediaLoadManager.instance;
  }

  private shouldSkipLoad(mediaKey: string): boolean {
    // Skip if too many attempts in last 5 minutes
    const attempts = this.loadAttempts.get(mediaKey) || 0;
    if (attempts >= 5) {
      const timeSinceLastMount = Date.now() - this.lastMountTime;
      if (timeSinceLastMount < 5 * 60 * 1000) { // 5 minutes
        return true;
      }
      // Reset attempts after cooldown
      this.loadAttempts.delete(mediaKey);
    }
    return false;
  }

  private trackLoadAttempt(mediaKey: string) {
    const attempts = this.loadAttempts.get(mediaKey) || 0;
    this.loadAttempts.set(mediaKey, attempts + 1);
  }

  private processBatch() {
    if (this.pendingBatch.size === 0) return;
    
    console.debug(`Processing batch of ${this.pendingBatch.size} items`);
    const batch = Array.from(this.pendingBatch);
    this.pendingBatch.clear();
    
    // Sort batch by priority
    const highPriority = batch.filter(nft => this.getMediaPriority(nft) === 'high');
    const mediumPriority = batch.filter(nft => this.getMediaPriority(nft) === 'medium');
    const lowPriority = batch.filter(nft => this.getMediaPriority(nft) === 'low');
    
    // Process in priority order
    [...highPriority, ...mediumPriority, ...lowPriority].forEach(nft => {
      const mediaKey = getMediaKey(nft);
      if (!this.loadingQueue.has(mediaKey) && !this.loadedAssets.has(mediaKey)) {
        this.loadMediaAssets(nft, this.getMediaPriority(nft));
      }
    });
  }

  private getMediaPriority(nft: NFT): 'high' | 'medium' | 'low' {
    // Determine priority based on NFT type/metadata
    if (nft.audio && nft.isVideo) return 'high';
    if (nft.audio || nft.metadata?.animation_url) return 'medium';
    return 'low';
  }

  private addToBatch(nft: NFT) {
    this.pendingBatch.add(nft);
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.processBatch();
      this.batchTimeout = null;
    }, 50); // 50ms batch window
  }

  async preloadMedia(nft: NFT, priority: 'high' | 'medium' | 'low' = 'medium'): Promise<void> {
    const mediaKey = getMediaKey(nft);
    
    // Check for duplicate/excessive loads
    if (this.shouldSkipLoad(mediaKey)) {
      console.debug(`Skipping load for ${mediaKey} due to too many recent attempts`);
      return;
    }

    // Add to batch for processing
    this.addToBatch(nft);

    // Return if already loaded or loading
    if (this.loadedAssets.has(mediaKey)) {
      // Validate cache and reload if necessary
      if (!await this.validateCache(mediaKey)) {
        this.loadedAssets.delete(mediaKey);
      } else {
        return;
      }
    }

    this.trackLoadAttempt(mediaKey);
    
    if (this.loadingQueue.has(mediaKey)) {
      return this.loadingQueue.get(mediaKey);
    }

    // Initialize progress tracking
    this.loadProgress.set(mediaKey, {
      loaded: 0,
      total: 100,
      status: 'pending',
      retryCount: 0
    });

    // Initialize listener set if not exists
    if (!this.activeListeners.has(mediaKey)) {
      this.activeListeners.set(mediaKey, new Set());
    }

    // Add to waiting queue if at max concurrent loads
    if (this.activeLoads >= this.maxConcurrent) {
      this.waitingQueue.push({ nft, priority, timestamp: Date.now() });
      return;
    }

    this.activeLoads++;
    const loadPromise = this.loadMediaAssets(nft, priority);
    this.loadingQueue.set(mediaKey, loadPromise);
    
    try {
      await loadPromise;
    } finally {
      this.loadingQueue.delete(mediaKey);
      this.activeLoads--;
      this.processWaitingQueue();
    }
  }

  public addProgressListener(mediaKey: string, listener: (progress: number) => void): () => void {
    if (!this.activeListeners.has(mediaKey)) {
      this.activeListeners.set(mediaKey, new Set());
    }
    const listeners = this.activeListeners.get(mediaKey)!;
    
    // Only add if not already present
    if (!listeners.has(listener)) {
      listeners.add(listener);

      // Send initial progress if available
      const progress = this.loadProgress.get(mediaKey);
      if (progress) {
        listener(progress.loaded / progress.total * 100);
      }
    }

    // Return cleanup function
    return () => this.removeProgressListener(mediaKey, listener);
  }

  public removeProgressListener(mediaKey: string, listener: (progress: number) => void): void {
    const listeners = this.activeListeners.get(mediaKey);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.activeListeners.delete(mediaKey);
      }
    }
  }

  private notifyProgressListeners(mediaKey: string, progress: number): void {
    const listeners = this.activeListeners.get(mediaKey);
    if (listeners && listeners.size > 0) {
      console.debug(`Notifying ${listeners.size} listeners for ${mediaKey} with progress ${progress}%`);
      listeners.forEach(listener => {
        try {
          listener(progress);
        } catch (error) {
          console.error(`Error in progress listener for ${mediaKey}:`, error);
          // Remove failed listener
          this.removeProgressListener(mediaKey, listener);
        }
      });
    }
  }

  private async loadMediaAssets(nft: NFT, priority: 'high' | 'medium' | 'low'): Promise<void> {
    const mediaKey = getMediaKey(nft);
    const progress = this.loadProgress.get(mediaKey)!;
    
    try {
      progress.status = 'loading';
      
      // Preload image if exists
      if (nft.image) {
        await this.retryWithBackoff(() => this.preloadImage(nft.image!, mediaKey), progress);
      }

      progress.status = 'complete';
      progress.loaded = progress.total;
      this.loadedAssets.add(mediaKey);
    } catch (error) {
      progress.status = 'error';
      console.warn(`Failed to preload media (${mediaKey}):`, error);
      throw error;
    }
  }

  private preloadImage(url: string, mediaKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const progress = this.loadProgress.get(mediaKey)!;
      
      // Check if image is already cached
      if (img.complete) {
        progress.loaded += 50;
        resolve();
        return;
      }

      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };

      img.onload = () => {
        cleanup();
        progress.loaded += 50;
        resolve();
      };
      
      img.onerror = () => {
        cleanup();
        reject(new Error(`Failed to load image: ${url}`));
      };

      // Add progress tracking
      if (img.decode) {
        img.decode().catch(() => {
          // Ignore decode errors, still try to load
        });
      }
      
      img.src = url;

      // Add timeout
      setTimeout(() => {
        cleanup();
        reject(new Error('Image load timeout'));
      }, 15000);
    });
  }

  private processWaitingQueue() {
    if (this.waitingQueue.length > 0 && this.activeLoads < this.maxConcurrent) {
      // Sort by priority and waiting time
      this.waitingQueue.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        
        // If same priority, consider waiting time
        if (priorityDiff === 0) {
          return a.timestamp - b.timestamp;
        }
        return priorityDiff;
      });

      const next = this.waitingQueue.shift();
      if (next) {
        this.preloadMedia(next.nft, next.priority);
      }
    }
  }

  private async retryWithBackoff(
    operation: () => Promise<void>,
    progress: LoadProgress
  ): Promise<void> {
    const baseDelay = 1000;
    
    while (progress.retryCount < this.maxRetries) {
      try {
        return await operation();
      } catch (error) {
        progress.retryCount++;
        if (progress.retryCount >= this.maxRetries) {
          throw error;
        }
        
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, progress.retryCount - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async validateCache(mediaKey: string): Promise<boolean> {
    // Implement cache validation logic here
    // For now, assume cache is valid for 1 hour
    const cacheTime = 60 * 60 * 1000;
    const lastLoaded = this.loadedAssets.has(mediaKey) ? Date.now() : 0;
    return Date.now() - lastLoaded < cacheTime;
  }

  public getProgress(mediaKey: string): LoadProgress | undefined {
    return this.loadProgress.get(mediaKey);
  }

  // Clear loaded assets cache
  public reset() {
    this.loadedAssets.clear();
    this.loadProgress.clear();
    this.loadAttempts.clear();
    this.activeListeners.clear();
    this.pendingBatch.clear();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.waitingQueue = [];
    this.mountId = Math.random().toString(36).substring(7);
    this.lastMountTime = Date.now();
  }

  // Get current mount info
  public getMountInfo(): { id: string; time: number } {
    return {
      id: this.mountId,
      time: this.lastMountTime
    };
  }
}

export const mediaLoadManager = MediaLoadManager.getInstance();

// Generate a unique, random media key for each NFT
const getMediaKey = (nft: NFT): string => {
  return uuidv4();
};
