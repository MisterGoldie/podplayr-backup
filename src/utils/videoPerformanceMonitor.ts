// Track global video performance and adjust quality as needed

// Extend HTMLVideoElement with our custom properties
declare global {
  interface HTMLVideoElement {
    _podplayrHandlers?: Record<string, EventListener>;
    _podplayrCleanupTimeout?: number;
    _podplayrMediaKey?: string; // Store mediaKey for proper tracking
  }
}

let isLowPerformanceMode = false;
let frameDropDetected = false;
let totalVideosPlaying = 0;

// Track active video elements for memory management
const activeVideoElements = new Set<HTMLVideoElement>();

// Helper functions for monitoring performance
export const videoPerformanceMonitor = {
  init() {
    // Check device capabilities once at init
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowPowerDevice = isMobile && typeof window.navigator.hardwareConcurrency === 'number' && 
      window.navigator.hardwareConcurrency <= 4;
    
    if (isLowPowerDevice) {
      this.enableLowPerformanceMode();
    }
    
    // Monitor frame rate to detect dropped frames
    if ('requestAnimationFrame' in window) {
      let lastTime = performance.now();
      let frameCount = 0;
      let slowFrames = 0;
      
      const checkFrameRate = () => {
        const now = performance.now();
        const delta = now - lastTime;
        
        frameCount++;
        
        // Check if this frame took too long (dropped frames)
        if (delta > 50) { // More than 50ms = less than 20fps
          slowFrames++;
        }
        
        // Every 60 frames, check the ratio of slow frames
        if (frameCount >= 60) {
          const slowFrameRatio = slowFrames / frameCount;
          
          // If more than 20% of frames are slow, enable low performance mode
          if (slowFrameRatio > 0.2) {
            frameDropDetected = true;
            this.enableLowPerformanceMode();
          }
          
          // Reset counters
          frameCount = 0;
          slowFrames = 0;
        }
        
        lastTime = now;
        requestAnimationFrame(checkFrameRate);
      };
      
      // Start monitoring
      requestAnimationFrame(checkFrameRate);
    }
  },
  
  enableLowPerformanceMode() {
    if (!isLowPerformanceMode) {
      isLowPerformanceMode = true;
      console.log("Enabling low performance mode for videos");
      
      // Apply low performance settings to all videos
      document.querySelectorAll('video').forEach(video => {
        this.optimizeVideoElement(video);
      });
      
      // Add a listener for future video elements
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeName === 'VIDEO') {
              this.optimizeVideoElement(node as HTMLVideoElement);
            }
            
            // Check if node has querySelectorAll (Element or Document)
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE) {
              const element = node as Element;
              element.querySelectorAll('video').forEach((video: HTMLVideoElement) => {
                this.optimizeVideoElement(video);
              });
            }
          });
        });
      });
      
      observer.observe(document.body, { 
        childList: true,
        subtree: true
      });
    }
  },
  
  optimizeVideoElement(video: HTMLVideoElement, mediaKey?: string) {
    if (!video) return;
    
    // Add to active videos set for tracking
    activeVideoElements.add(video);
    
    // Store mediaKey for proper tracking if provided
    if (mediaKey) {
      video._podplayrMediaKey = mediaKey;
    }
    
    // Track the number of videos playing
    const playHandler = () => {
      totalVideosPlaying++;
      this.pruneBackgroundVideos();
    };
    
    const pauseHandler = () => {
      totalVideosPlaying = Math.max(0, totalVideosPlaying - 1);
    };
    
    const endedHandler = () => {
      totalVideosPlaying = Math.max(0, totalVideosPlaying - 1);
      this.cleanupVideoResources(video);
    };
    
    // Add error handler to clean up resources on error
    const errorHandler = () => {
      console.error('Video playback error - cleaning up resources');
      this.cleanupVideoResources(video);
    };
    
    // Store event handlers on the element for later removal
    video._podplayrHandlers = {
      play: playHandler,
      pause: pauseHandler,
      ended: endedHandler,
      error: errorHandler
    };
    
    // Add event listeners
    video.addEventListener('play', playHandler);
    video.addEventListener('pause', pauseHandler);
    video.addEventListener('ended', endedHandler);
    video.addEventListener('error', errorHandler);
    
    // Set up automatic cleanup after 2 minutes to prevent memory leaks
    video._podplayrCleanupTimeout = window.setTimeout(() => {
      console.log('🧹 Automatic video resource cleanup after timeout');
      this.cleanupVideoResources(video);
    }, 120 * 1000); // 2 minutes
    
    // Apply optimizations to the video element
    // Reduce quality for performance
    if (video.videoHeight > 480) {
      video.style.maxHeight = '480px';
      video.style.objectFit = 'contain';
    }
    
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.preload = 'metadata';
  },
  
  pruneBackgroundVideos() {
    // Find videos that are not in viewport and pause them
    const videos = Array.from(document.querySelectorAll('video'));
    
    videos.forEach(video => {
      if (!video.paused) {
        const rect = video.getBoundingClientRect();
        const isVisible = 
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth;
        
        if (!isVisible) {
          console.log('Pausing background video for performance');
          video.pause();
        }
      }
    });
  },
  
  isInLowPerformanceMode() {
    return isLowPerformanceMode;
  },
  
  hasDetectedFrameDrops() {
    return frameDropDetected;
  },
  
  cleanupVideoResources(video: HTMLVideoElement) {
    if (!video) return;
    
    // Remove from active videos set
    activeVideoElements.delete(video);
    
    // Clear cleanup timeout
    if (video._podplayrCleanupTimeout) {
      clearTimeout(video._podplayrCleanupTimeout);
      video._podplayrCleanupTimeout = undefined;
    }
    
    // Remove event listeners
    if (video._podplayrHandlers) {
      Object.entries(video._podplayrHandlers).forEach(([event, handler]) => {
        video.removeEventListener(event, handler);
      });
      video._podplayrHandlers = undefined;
    }
    
    // Pause and reset video
    video.pause();
    video.src = '';
    video.load();
  },
  
  cleanupAllVideoResources() {
    // Clean up all active video elements
    activeVideoElements.forEach(video => {
      this.cleanupVideoResources(video);
    });
    activeVideoElements.clear();
  }
}; 