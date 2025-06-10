declare global {
  interface Window {
    firebase?: any;
    updateNFTPlayCount?: any;
  }
}

let isVideoPlaybackActive = false;
let pausedOperations: Array<() => void> = [];

// Track if we're on cellular
const isCellular = (): boolean => {
  // Use the Network Information API if available
  if ('connection' in navigator && (navigator as any).connection) {
    const connection = (navigator as any).connection;
    return connection.type === 'cellular';
  }
  return false;
};

// Pause all non-essential operations during video playback
export const enterVideoFirstMode = () => {
  if (isCellular()) {
    isVideoPlaybackActive = true;
    console.log('🎬 Video-First Mode: Enabled - pausing background operations');
    
    // Pause Firebase/Firestore polling if possible
    if (window.firebase?.firestore) {
      const originalFirestoreGet = window.firebase.firestore.get;
      window.firebase.firestore.get = function(...args: any[]) {
        if (isVideoPlaybackActive) {
          return new Promise(resolve => {
            pausedOperations.push(() => {
              originalFirestoreGet.apply(this, args).then(resolve);
            });
          });
        }
        return originalFirestoreGet.apply(this, args);
      };
    }
    
    // Disable NFT play count updates temporarily
    if (window.updateNFTPlayCount) {
      const originalUpdatePlayCount = window.updateNFTPlayCount;
      window.updateNFTPlayCount = function(...args: any[]) {
        if (isVideoPlaybackActive) {
          pausedOperations.push(() => {
            originalUpdatePlayCount.apply(this, args);
          });
          return;
        }
        return originalUpdatePlayCount.apply(this, args);
      };
    }
  }
};

// Resume normal operation after video is loaded
export const exitVideoFirstMode = () => {
  if (isVideoPlaybackActive) {
    isVideoPlaybackActive = false;
    console.log(`🎬 Video-First Mode: Disabled - resuming ${pausedOperations.length} operations`);
    
    // Process queued operations in batches to avoid overwhelming the network
    const processOperations = () => {
      const batch = pausedOperations.splice(0, 5);
      if (batch.length === 0) return;
      
      batch.forEach(operation => {
        try {
          operation();
        } catch (error) {
          console.error('Error executing queued operation:', error);
        }
      });
      
      if (pausedOperations.length > 0) {
        setTimeout(processOperations, 1000);
      }
    };
    
    processOperations();
  }
};

// Check if we should delay an operation
export const shouldDelayOperation = (): boolean => {
  return isVideoPlaybackActive && isCellular();
}; 