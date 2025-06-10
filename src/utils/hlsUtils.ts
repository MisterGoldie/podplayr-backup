import * as HlsModule from 'hls.js';

// Use the default export from the module
const Hls = HlsModule.default;

import { getNetworkInfo, isMobileDevice } from './deviceDetection';
import { isCellularConnection, getCellularVideoSettings } from './cellularOptimizer';

// You already have the types from the module import
type HlsType = typeof Hls;

// Store HLS instances to prevent memory leaks
const hlsInstances: Record<string, HlsModule.default> = {};

/**
 * Check if a URL is an HLS stream URL
 */
export function isHlsUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  
  try {
    // Properly parse the URL
    const parsedUrl = new URL(url);
    
    // Check if the pathname ends with .m3u8 extension
    // This is more secure than checking if .m3u8 appears anywhere in the URL
    return parsedUrl.pathname.toLowerCase().endsWith('.m3u8');
  } catch (error) {
    // Handle special case for relative URLs
    if (url.startsWith('/')) {
      return url.toLowerCase().endsWith('.m3u8');
    }
    
    // If URL parsing fails and it's not a relative path, log and return false
    console.warn('Invalid URL in isHlsUrl:', url);
    return false;
  }
}

/**
 * Get the HLS URL from a source URL
 */
export function getHlsUrl(url: string): string {
  // Validate input
  if (typeof url !== 'string') return '';
  
  // If it's already an HLS URL, return it
  if (isHlsUrl(url)) {
    return url;
  }
  
  // Otherwise, try to convert it to an HLS URL
  // SECURITY: Properly parse URL to prevent URL substring bypass attacks
  try {
    const parsedUrl = new URL(url);
    
    // Define allowed IPFS hostnames
    const allowedIpfsHosts = [
      'ipfs.io',
      'dweb.link',
      'cloudflare-ipfs.com',
      'gateway.ipfs.io'
    ];
    
    // Check if hostname exactly matches one of our allowed hosts
    // or is a direct subdomain of an allowed host
    if (allowedIpfsHosts.some(host => 
      parsedUrl.hostname === host || 
      parsedUrl.hostname.endsWith(`.${host}`))) {
      
      // For IPFS URLs, use the appropriate HLS endpoint
      if (parsedUrl.pathname.startsWith('/ipfs/')) {
        // Clone the URL to avoid modifying the original
        const hlsUrl = new URL(url);
        hlsUrl.pathname = hlsUrl.pathname.replace('/ipfs/', '/ipfs-hls/');
        return hlsUrl.toString();
      }
    }
  } catch (error) {
    // If URL parsing fails, log and return original URL
    console.warn('Invalid URL in getHlsUrl:', url);
  }
  
  return url;
}

/**
 * Set up HLS.js for a video element with cellular-specific optimizations
 */
export function setupHls(videoId: string, videoElement: HTMLVideoElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!Hls.isSupported()) {
      reject(new Error('HLS is not supported in this browser'));
      return;
    }
    
    // Check network conditions
    const { isCellular, generation } = isCellularConnection();
    const networkInfo = getNetworkInfo();
    const effectiveType = networkInfo.effectiveType;
    const downlink = networkInfo.downlink;
    
    // Get cellular settings if needed
    const cellularSettings = isCellular ? getCellularVideoSettings() : null;
    
    // Log network conditions
    const isMobile = isMobileDevice();
    console.log(`Network: ${isCellular ? `Cellular (${generation})` : 'WiFi/Ethernet'}, ` +
                `Effective type: ${effectiveType}, Downlink: ${downlink}Mbps`);
    
    // Base HLS configuration
    const hlsConfig: Partial<HlsModule.default['config']> = {
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
      maxBufferSize: 60 * 1000 * 1000, // 60MB
      maxBufferHole: 0.5,
      
      // Quality selection
      capLevelToPlayerSize: true,
      startLevel: -1, // Auto
      
      // Bandwidth estimation
      abrEwmaDefaultEstimate: 1000000, // 1Mbps default
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      
      // Fragment loading
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 10000,
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 4,
      fragLoadingMaxRetryTimeout: 4000
    };
    
    // Apply cellular optimizations if needed
    if (isCellular && cellularSettings) {
      console.log('Applying cellular optimizations:', {
        generation,
        maxResolution: cellularSettings.maxResolution,
        maxBitrate: cellularSettings.maxBitrate
      });
      
      // Use cellular-specific HLS config
      Object.assign(hlsConfig, cellularSettings.hlsConfig);
      
      // Additional cellular optimizations
      if (generation === '2G' || generation === '3G') {
        hlsConfig.abrBandWidthFactor = 0.7; // More conservative
        hlsConfig.fragLoadingMaxRetry = 8;  // More retries
        hlsConfig.manifestLoadingMaxRetry = 6;
        hlsConfig.fragLoadingMaxRetryTimeout = 8000;
      }
    }
    
    // Create HLS instance
    const hls = new Hls(hlsConfig);
    hlsInstances[videoId] = hls;
    
    // Attach media and load source
    hls.attachMedia(videoElement);
    hls.loadSource(src);
    
    // Handle events
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('HLS manifest parsed');
      resolve();
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('Fatal HLS error:', data);
        reject(new Error(`HLS fatal error: ${data.type}`));
      }
    });
  });
}

/**
 * Destroy an HLS instance
 */
export function destroyHls(videoId: string): void {
  const hls = hlsInstances[videoId];
  if (hls) {
    hls.destroy();
    delete hlsInstances[videoId];
    console.log(`HLS instance for ${videoId} destroyed`);
  }
}

/**
 * Get the current quality level of an HLS instance
 */
export function getCurrentHlsLevel(videoId: string): number {
  const hls = hlsInstances[videoId];
  if (!hls) return -1;
  return hls.currentLevel;
}

/**
 * Set the quality level of an HLS instance
 */
export function setHlsQualityLevel(videoId: string, level: number): void {
  const hls = hlsInstances[videoId];
  if (!hls) return;
  hls.currentLevel = level;
}

/**
 * Get or create an HLS instance for a video URL with optional config
 */
export function getHlsInstance(videoUrl: string, config?: Partial<HlsModule.default['config']>): HlsModule.default {
  // Create a unique key for this URL
  const key = `hls-${videoUrl}`;
  
  // Return existing instance if available
  if (hlsInstances[key]) {
    return hlsInstances[key];
  }
  
  // Base HLS config
  const baseConfig: Partial<HlsModule.default['config']> = {
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90,
    maxBufferLength: 30,
    maxMaxBufferLength: 600,
    maxBufferSize: 60 * 1000 * 1000, // 60MB
    maxBufferHole: 0.5,
    ...config // Merge with provided config
  };
  
  // Create new instance with merged config
  const hls = new Hls(baseConfig);
  
  // Load the source
  hls.loadSource(videoUrl);
  
  // Store the instance
  hlsInstances[key] = hls;
  
  return hls;
} 