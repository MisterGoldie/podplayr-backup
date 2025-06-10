import { logger } from './logger';

// Create a dedicated logger for adaptive streaming
const streamingLogger = logger.getModuleLogger('adaptiveStreaming');

// Interface for connection info
interface ConnectionInfo {
  effectiveType: string;  // 'slow-2g', '2g', '3g', '4g', or '5g'
  downlink: number;       // Mbps
  rtt: number;            // Round-trip time in ms
  saveData: boolean;      // Whether data saver is enabled
}

// Get the current connection information if available
export const getConnectionInfo = (): ConnectionInfo | null => {
  if (typeof navigator === 'undefined') return null;
  
  if ('connection' in navigator) {
    const connection = (navigator as any).connection;
    
    if (connection) {
      // The Network Information API doesn't officially report 5G yet,
      // so we'll infer it from very high downlink values
      let effectiveType = connection.effectiveType || '4g';
      const downlink = connection.downlink || 10;
      
      // Consider connections with extremely high bandwidth as 5G
      // Most 5G connections have downlink speeds well above 20 Mbps
      if (downlink > 20 && effectiveType === '4g') {
        effectiveType = '5g';
      }
      
      return {
        effectiveType,
        downlink,
        rtt: connection.rtt || 50,
        saveData: connection.saveData || false
      };
    }
  }
  
  return null;
};

// Optimize video element based on connection quality
export const optimizeVideoForConnection = (
  videoElement: HTMLVideoElement,
  mediaKey: string,
  isMobile: boolean
): void => {
  if (!videoElement) return;
  
  const connectionInfo = getConnectionInfo();
  
  // Always apply these optimizations for all mobile devices
  if (isMobile) {
    videoElement.setAttribute('playsinline', 'true');
    videoElement.style.transform = 'translateZ(0)'; // Hardware acceleration
  }
  
  // If we have connection info, make more specific optimizations
  if (connectionInfo) {
    const { effectiveType, downlink, saveData } = connectionInfo;
    
    streamingLogger.info('Optimizing video based on connection', {
      mediaKey,
      effectiveType,
      downlink,
      saveData,
      isMobile
    });
    
    // Data saver mode - lowest quality
    if (saveData) {
      videoElement.preload = 'none';
      return;
    }
    
    // Very slow connection - lowest quality
    if (effectiveType === 'slow-2g' || effectiveType === '2g' || downlink < 1) {
      videoElement.preload = 'none';
      // Lower resolution for slow connections
      if (videoElement.videoHeight > 240) {
        videoElement.style.maxHeight = '240px';
      }
    } 
    // Medium connection - medium quality
    else if (effectiveType === '3g' || downlink < 5) {
      videoElement.preload = 'metadata';
      // Medium resolution for moderate connections
      if (videoElement.videoHeight > 360) {
        videoElement.style.maxHeight = '360px';
      }
    } 
    // Fast 4G connection on mobile - higher quality but still optimized
    else if (effectiveType === '4g' && isMobile) {
      videoElement.preload = 'metadata';
      // Higher resolution for 4G
      if (videoElement.videoHeight > 720) {
        videoElement.style.maxHeight = '720px';
      }
    }
    // 5G or ultra-fast connection - highest quality
    else if (effectiveType === '5g' || downlink > 20) {
      videoElement.preload = 'auto';
      // Full resolution for 5G
      videoElement.style.maxHeight = 'none';
    }
    // Desktop with good connection - full quality
    else {
      videoElement.preload = 'auto';
    }
  } 
  // Fallback for browsers without Network Information API
  else {
    if (isMobile) {
      videoElement.preload = 'metadata';
    } else {
      videoElement.preload = 'auto';
    }
  }
  
  // Set up connection change listener
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    try {
      const connection = (navigator as any).connection;
      connection.addEventListener('change', () => {
        // Re-optimize when connection changes
        optimizeVideoForConnection(videoElement, mediaKey, isMobile);
      });
    } catch (e) {
      // Some browsers might not support this event
    }
  }
};

// Create HLS or DASH source based on connection quality
export const getAdaptiveStreamingSrc = (
  url: string,
  mediaKey: string,
  isMobile: boolean
): string => {
  // This is where you would implement adaptive streaming URL transformations
  // For now, we're just returning the original URL since we're optimizing at the player level
  
  // Add mediaKey as a query parameter for consistent tracking
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}mediaKey=${encodeURIComponent(mediaKey)}`;
};
