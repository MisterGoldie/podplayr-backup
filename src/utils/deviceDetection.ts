/**
 * Utility functions for detecting device type and network capabilities 
 * to optimize media playback on different devices and networks
 */

// Function to detect if the current device is mobile
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  return Boolean(
    navigator.userAgent.match(/Android/i) ||
    navigator.userAgent.match(/iPhone/i) ||
    navigator.userAgent.match(/iPad/i) ||
    navigator.userAgent.match(/iPod/i) ||
    navigator.userAgent.match(/BlackBerry/i) ||
    navigator.userAgent.match(/Windows Phone/i)
  );
};

// Function to detect if the current device is a tablet
export const isTabletDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const userAgent = navigator.userAgent.toLowerCase();
  return (
    /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|puffin)/.test(userAgent)
  );
};

// Get network information if available
export const getNetworkInfo = () => {
  if (typeof navigator === 'undefined') {
    return {
      effectiveType: 'unknown',
      saveData: false,
      rtt: 0,
      downlink: 0,
    };
  }
  
  // @ts-ignore - Newer browsers support the Connection API
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  
  if (!connection) {
    return {
      effectiveType: 'unknown',
      saveData: false,
      rtt: 0,
      downlink: 0,
    };
  }
  
  return {
    effectiveType: connection.effectiveType || 'unknown',
    saveData: connection.saveData || false,
    rtt: connection.rtt || 0,
    downlink: connection.downlink || 0,
  };
};

// Should we use high quality media?
export const shouldUseHighQualityMedia = (): boolean => {
  const { effectiveType, saveData, downlink } = getNetworkInfo();
  const isMobile = isMobileDevice();
  
  // Always use lower quality on mobile with data saver
  if (saveData) return false;
  
  // Only use high quality on fast connections
  if (isMobile) {
    return (
      effectiveType === '4g' || 
      downlink >= 5 || // 5+ Mbps is considered fast enough
      effectiveType === 'unknown' // If we can't detect, default to high quality
    );
  }
  
  // Default to high quality for desktops
  return true;
};

// Get optimal video resolution based on device and network
export const getOptimalVideoResolution = (): string => {
  const { effectiveType, saveData, downlink } = getNetworkInfo();
  const isMobile = isMobileDevice();
  const isTablet = isTabletDevice();
  
  // Data saver mode - use lowest quality
  if (saveData) return '240p';
  
  // Mobile-specific logic
  if (isMobile && !isTablet) {
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return '240p';
    if (effectiveType === '3g' || downlink < 2) return '360p';
    return '480p'; // Default for most mobile devices
  }
  
  // Tablet-specific logic
  if (isTablet) {
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return '360p';
    if (effectiveType === '3g' || downlink < 2) return '480p';
    return '720p'; // Default for tablets
  }
  
  // Desktop - based on connection speed
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return '480p';
  if (effectiveType === '3g' || downlink < 5) return '720p';
  return '1080p'; // Default for desktop with good connection
};

// Function to optimize preload strategy based on device and network
export const getOptimalPreloadStrategy = (): 'none' | 'metadata' | 'auto' => {
  const { effectiveType, saveData } = getNetworkInfo();
  const isMobile = isMobileDevice();
  
  if (saveData) return 'none';
  
  if (isMobile) {
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'none';
    if (effectiveType === '3g') return 'metadata';
    return 'metadata'; // Even on 4G, just preload metadata for mobile
  }
  
  // For desktop
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'metadata';
  return 'auto';
};
