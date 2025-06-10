/**
 * Specialized utilities for optimizing video playback on cellular networks
 */

// Check if user is on a cellular connection with generation detection
export const isCellularConnection = (): { isCellular: boolean; generation: '5G' | '4G' | '3G' | '2G' | 'unknown' } => {
  if (typeof navigator === 'undefined' || !('connection' in navigator)) {
    return { isCellular: false, generation: 'unknown' };
  }

  const connection = (navigator as any).connection;
  const effectiveType = connection?.effectiveType || '';
  const downlink = connection?.downlink || 0; // Mbps
  const rtt = connection?.rtt || 0; // ms

  // Detect cellular connection
  const isCellular = connection?.type === 'cellular' || 
                    effectiveType.includes('g') ||
                    connection?.type?.includes('cell');

  // Determine generation based on network capabilities
  let generation: '5G' | '4G' | '3G' | '2G' | 'unknown' = 'unknown';
  
  if (isCellular) {
    // 5G detection: Very high bandwidth (>50Mbps) and very low latency (<50ms)
    if (downlink >= 50 && rtt < 50) {
      generation = '5G';
    }
    // 4G detection: Good bandwidth (>10Mbps) and low latency (<100ms)
    else if (downlink >= 10 || (effectiveType === '4g' && downlink > 5)) {
      generation = '4G';
    }
    // 3G detection: Moderate bandwidth and higher latency
    else if (effectiveType === '3g' || downlink > 1) {
      generation = '3G';
    }
    // 2G detection: Low bandwidth and high latency
    else if (effectiveType === '2g' || effectiveType === 'slow-2g') {
      generation = '2G';
    }
  }

  return { isCellular, generation };
};

// Get optimized video settings based on network generation
export const getCellularVideoSettings = () => {
  const { generation } = isCellularConnection();
  
  switch (generation) {
    case '5G':
      return {
        maxResolution: '4K',
        preferredResolution: '1440p',
        maxBitrate: 25000000, // 25 Mbps for 5G
        bufferSize: 10,       // 10 seconds buffer
        preloadSegments: 4,   // Preload 4 segments ahead
        hlsConfig: {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,     // Auto quality selection
          capLevelToPlayerSize: true,
          maxLoadingDelay: 4,
        }
      };
      
    case '4G':
      return {
        maxResolution: '1080p',
        preferredResolution: '720p',
        maxBitrate: 8000000,  // 8 Mbps for 4G
        bufferSize: 15,       // 15 seconds buffer
        preloadSegments: 3,   // Preload 3 segments ahead
        hlsConfig: {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,     // Auto quality selection
          capLevelToPlayerSize: true,
          maxLoadingDelay: 4,
        }
      };
      
    case '3G':
      return {
        maxResolution: '720p',
        preferredResolution: '480p',
        maxBitrate: 2500000,  // 2.5 Mbps for 3G
        bufferSize: 20,       // 20 seconds buffer
        preloadSegments: 2,   // Preload 2 segments ahead
        hlsConfig: {
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,
          capLevelToPlayerSize: true,
          maxLoadingDelay: 8,
        }
      };
      
    case '2G':
    default:
      return {
        maxResolution: '480p',
        preferredResolution: '360p',
        maxBitrate: 800000,   // 800 Kbps for 2G
        bufferSize: 30,       // 30 seconds buffer
        preloadSegments: 1,   // Preload 1 segment ahead
        hlsConfig: {
          maxBufferLength: 40,
          maxMaxBufferLength: 60,
          startLevel: 0,      // Start with lowest quality
          capLevelToPlayerSize: true,
          maxLoadingDelay: 10,
        }
      };
  }
};

// Get optimized video URL with quality parameters
export const getOptimizedCellularVideoUrl = (originalUrl: string): string => {
  const { generation } = isCellularConnection();
  const settings = getCellularVideoSettings();
  
  // If URL is a streaming URL (HLS/DASH)
  if (originalUrl.includes('.m3u8') || originalUrl.includes('streaming')) {
    // Add quality parameters based on network generation
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}maxBitrate=${settings.maxBitrate}&preferredResolution=${settings.preferredResolution}`;
  }
  
  return originalUrl;
};

// Create very low bitrate preview URL
export const getPreviewVideoUrl = (originalUrl: string): string => {
  // This would be implemented based on your backend capabilities
  // For example, appending a parameter like ?preview=true
  
  // For demo purposes:
  if (originalUrl.includes('?')) {
    return `${originalUrl}&preview=true`;
  } else {
    return `${originalUrl}?preview=true`;
  }
};

/**
 * Apply cellular-specific optimizations to video element
 */
export const optimizeVideoForCellular = (
  video: HTMLVideoElement, 
  generation: '2G' | '3G' | '4G' | '5G'
): void => {
  // Get cellular settings
  const settings = getCellularVideoSettings();
  
  // Base optimizations for all cellular connections
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  
  // Modify actual video rendering quality
  if (generation === '2G' || generation === '3G') {
    // Low-end optimizations
    // Convert resolution string to height number (e.g. "480p" -> 480)
    const maxHeight = parseInt(settings.preferredResolution.replace('p', ''));
    video.style.maxHeight = `${maxHeight}px`;
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';
    video.style.imageRendering = 'optimizeSpeed';
    
    // iOS-specific hints
    video.setAttribute('x-webkit-airplay', 'allow');
    video.preload = 'none';
    
    // Disable picture-in-picture to save resources
    if ('disablePictureInPicture' in video) {
      (video as any).disablePictureInPicture = true;
    }
  } else if (generation === '4G') {
    // Medium optimizations
    // Convert resolution string to height number (e.g. "720p" -> 720)
    const maxHeight = parseInt(settings.preferredResolution.replace('p', ''));
    video.style.maxHeight = `${maxHeight}px`;
    video.preload = 'metadata';
  }
  
  // Add data attributes for debugging
  video.setAttribute('data-cellular', generation);
  
  // Pause other videos when this one plays
  video.addEventListener('play', function pauseOthers() {
    document.querySelectorAll('video').forEach(otherVideo => {
      if (otherVideo !== video && !otherVideo.paused) {
        otherVideo.pause();
      }
    });
  });
  
  // Monitor playback quality
  let lowPerformanceDetected = false;
  let lastTime = 0;
  let checkInterval: any = null;
  
  // Watch for stuttering playback
  const startPerformanceMonitoring = () => {
    if (checkInterval) clearInterval(checkInterval);
    
    lastTime = video.currentTime;
    let stallCount = 0;
    
    checkInterval = setInterval(() => {
      if (!video.paused) {
        const currentTime = video.currentTime;
        const expectedDelta = (Date.now() - lastTime) / 1000;
        const actualDelta = currentTime - lastTime;
        
        // If actual progress is significantly less than expected
        if (actualDelta < expectedDelta * 0.5 && actualDelta < 0.1) {
          stallCount++;
          
          if (stallCount >= 3 && !lowPerformanceDetected) {
            lowPerformanceDetected = true;
            console.log('Cellular performance issues detected - enabling further optimizations');
            
            // Additional optimizations for low performance
            video.style.imageRendering = 'optimizeSpeed';
            video.style.filter = 'brightness(1.05)'; // Slight brightness boost for perceptual quality
            
            if (generation === '2G' || generation === '3G') {
              // Extreme measures for very low performance
              video.playbackRate = 0.9; // Slightly slower playback
            }
          }
        } else {
          stallCount = 0;
        }
        
        lastTime = currentTime;
      }
    }, 2000);
  };
  
  video.addEventListener('playing', startPerformanceMonitoring);
  
  video.addEventListener('pause', () => {
    if (checkInterval) clearInterval(checkInterval);
  });
  
  video.addEventListener('emptied', () => {
    if (checkInterval) clearInterval(checkInterval);
    lowPerformanceDetected = false;
  });
}; 