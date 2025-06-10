import { isCellularConnection } from './cellularOptimizer';

// Track if video is currently playing
let isVideoPlaying = false;

// Queue for delayed operations
const operationQueue: (() => void)[] = [];

// Set video playback state
export const setVideoPlaybackState = (playing: boolean) => {
  isVideoPlaying = playing;
  
  // If video stopped playing, process queued operations
  if (!playing) {
    processQueue();
  }
};

// Pause non-essential network operations during video playback on cellular
export const prioritizeVideoPlayback = <T>(
  operation: () => Promise<T>,
  options: {
    isEssential?: boolean;
    timeout?: number;
  } = {}
): Promise<T> => {
  const { isEssential = false, timeout = 30000 } = options;
  const { isCellular } = isCellularConnection();
  
  // If not on cellular or operation is essential, execute immediately
  if (!isCellular || isEssential || !isVideoPlaying) {
    return operation();
  }
  
  // Otherwise, queue the operation for later
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      // If operation times out, remove from queue and execute
      const index = operationQueue.findIndex(op => op === queuedOperation);
      if (index !== -1) {
        operationQueue.splice(index, 1);
      }
      
      operation().then(resolve).catch(reject);
    }, timeout);
    
    const queuedOperation = () => {
      clearTimeout(timeoutId);
      operation().then(resolve).catch(reject);
    };
    
    operationQueue.push(queuedOperation);
    console.log(`Operation queued during video playback on cellular. Queue size: ${operationQueue.length}`);
  });
};

// Process queued operations
const processQueue = () => {
  console.log(`Processing ${operationQueue.length} queued operations`);
  
  // Process a few operations at a time to avoid overwhelming the network
  const batchSize = 3;
  const processBatch = () => {
    const batch = operationQueue.splice(0, batchSize);
    
    if (batch.length === 0) return;
    
    // Execute batch operations
    batch.forEach(operation => {
      try {
        operation();
      } catch (error) {
        console.error('Error executing queued operation:', error);
      }
    });
    
    // If more operations remain, schedule next batch
    if (operationQueue.length > 0) {
      setTimeout(processBatch, 1000);
    }
  };
  
  processBatch();
}; 