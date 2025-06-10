import { isCellularConnection } from './cellularOptimizer';

// Get optimal resolution based on network conditions
export const getOptimalResolution = (): string => {
  const { isCellular, generation } = isCellularConnection();
  
  // Get network speed if available
  let speed = 0;
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    speed = (navigator.connection as any).downlink || 0; // in Mbps
  }
  
  // Determine resolution based on network type and speed
  if (isCellular) {
    if (generation === '5G' || speed > 10) return "1080p";
    if (generation === '4G' || speed > 5) return "720p";
    if (generation === '3G' || speed > 1.5) return "480p";
    return "360p"; // 2G or unknown
  } else {
    // WiFi or Ethernet
    if (speed > 20) return "1080p";
    if (speed > 10) return "720p";
    return "480p";
  }
};

// Get video URL with appropriate resolution
export const getOptimizedVideoUrl = (url: string): string => {
  const resolution = getOptimalResolution();
  
  // If URL contains resolution pattern, replace it
  if (url.match(/\/\d+p\//)) {
    return url.replace(/\/\d+p\//, `/${resolution}/`);
  }
  
  // Otherwise return original URL
  return url;
}; 