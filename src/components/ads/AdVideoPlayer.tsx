import { useRef, useEffect } from 'react';
import { isCellularConnection } from '../../utils/cellularOptimizer';

export const AdVideoPlayer = ({ videoSrc }: { videoSrc: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isCellular } = isCellularConnection();
  
  useEffect(() => {
    if (!videoRef.current) return;
    
    // CRITICAL OPTIMIZATION FOR CELLULAR
    if (isCellular) {
      // 1. PRELOAD METADATA ONLY INITIALLY
      videoRef.current.preload = 'metadata';
      
      // 2. SET LOW RESOLUTION
      videoRef.current.style.filter = 'blur(0px)'; // Remove any blur
      videoRef.current.style.maxHeight = '360px'; // Limit resolution
      
      // 3. SET HIGH RESOURCE PRIORITY
      const linkEl = document.createElement('link');
      linkEl.rel = 'preload';
      linkEl.as = 'video';
      linkEl.href = videoSrc;
      linkEl.setAttribute('fetchpriority', 'high');
      document.head.appendChild(linkEl);
      
      // 4. CLEANUP FUNCTION
      return () => {
        document.head.removeChild(linkEl);
      };
    }
  }, [videoSrc, isCellular]);
  
  return (
    <video
      ref={videoRef}
      src={videoSrc}
      controls
      playsInline
      // Key optimizations:
      poster="/ad-poster.jpg" // Add a lightweight poster image
      style={{
        width: '100%',
        maxHeight: isCellular ? '360px' : 'auto',
      }}
      // Use range requests for faster startup
      onCanPlay={() => {
        // Once metadata is loaded, switch to auto quality
        if (videoRef.current) {
          videoRef.current.preload = 'auto';
        }
      }}
    />
  );
};

export default AdVideoPlayer; 