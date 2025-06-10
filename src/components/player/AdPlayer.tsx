'use client';

import React, { useRef, useEffect, useState } from 'react';

interface AdPlayerProps {
  onAdComplete: () => void;
  key?: string;
}

// Ad configuration with URLs
const AD_CONFIG = [
  {
    video: '/ad-video-2.mp4',
    url: 'https://acyl.world',  
    title: 'ACYL Radio',
    domain: 'acyl.world'
  },
  {
    video: '/ad-video-3.mp4',
    url: 'https://acyl.world/TV',  
    title: 'Art House',
    domain: 'acyl.world/TV'
  },
  {
    video: '/ad-video-4.mp4',
    url: 'https://www.coinbase.com/',
    title: 'More Bitcoin',
    domain: 'coinbase.com/learn'
  },
  {
    video: '/ad-video-5.mp4',
    url: 'https://acyl.world',
    title: 'ACYL Radio',
    domain: 'acyl.world',
    isVertical: true
  },
  {
    video: '/ad-video-6.mp4',
    url: 'https://acyl.world',
    title: 'ACYL',
    domain: 'acyl.world',
    isVertical: true
  },
   {
    video: '/podplayrad1.mp4',
  },
];

export const AdPlayer: React.FC<AdPlayerProps> = ({ onAdComplete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [canSkip, setCanSkip] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [videoOrientation, setVideoOrientation] = useState<'landscape' | 'portrait'>('landscape');
  
  // Function to check if a video format is supported
  const isVideoFormatSupported = (videoPath: string) => {
    const video = document.createElement('video');
    return video.canPlayType(`video/${videoPath.split('.').pop()}`) !== '';
  };

  const [selectedAd] = useState(() => {
    // Filter ads to only include supported formats for the current device
    const supportedAds = AD_CONFIG.filter(ad => isVideoFormatSupported(ad.video));
    if (supportedAds.length === 0) {
      console.error('No supported ad formats found');
      setError(true);
      return AD_CONFIG[0]; // Fallback to first ad
    }
    // Randomly select from supported ads
    const randomIndex = Math.floor(Math.random() * supportedAds.length);
    return supportedAds[randomIndex];
  });

  // Set initial orientation based on selected ad
  useEffect(() => {
    if (selectedAd.isVertical) {
      setVideoOrientation('portrait');
    }
  }, [selectedAd]);

  // Track elapsed time and enable skip after 5 seconds
  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedTime(elapsed);
      if (elapsed >= 5 && !canSkip) {
        setCanSkip(true);
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [canSkip]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      onAdComplete();
    };

    const handleTimeUpdate = () => {
      if (video) {
        const remaining = Math.max(0, Math.round(video.duration - video.currentTime));
        setTimeRemaining(remaining);
      }
    };

    const handleLoadedMetadata = () => {
      if (video) {
        setTimeRemaining(Math.round(video.duration));
        setAudioDuration(video.duration);
        
        // Check video dimensions to confirm orientation
        if (video.videoWidth < video.videoHeight) {
          setVideoOrientation('portrait');
        } else {
          setVideoOrientation('landscape');
        }
        
        // Log video dimensions for debugging
        console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
      }
    };

    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.play().catch(console.error);

    return () => {
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onAdComplete]);

  // Add this effect to handle headers when vertical ads are playing
  useEffect(() => {
    // Hide all headers to ensure they don't overlap with vertical ads
    const headers = document.querySelectorAll('header');
    headers.forEach(header => {
      header.style.display = 'none';
    });
    
    // Cleanup function to restore headers if component unmounts unexpectedly
    return () => {
      headers.forEach(header => {
        header.style.display = 'flex';
      });
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[100] flex items-center justify-center overflow-hidden">
      <div className={videoOrientation === 'portrait' 
        ? "w-full h-full flex items-center justify-center" 
        : "w-full h-full"}>
        <video
          ref={videoRef}
          src={selectedAd.video}
          className={videoOrientation === 'portrait' 
            ? "w-full h-full object-contain" // Changed to ensure vertical videos display properly
            : "w-full h-full object-contain"} 
          playsInline
        />
      </div>
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        {canSkip && (
          <button
            onClick={onAdComplete}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-1 rounded-full font-medium text-sm transition-colors"
          >
            Skip Ad
          </button>
        )}
        <div className="bg-black/80 text-white px-3 py-1 rounded-full font-mono text-sm">
          Ad: {timeRemaining}s / {Math.round(audioDuration)}s
        </div>
      </div>
      {/* Ad link container - only show if the ad has a URL */}
      {selectedAd.url && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-purple-900/90 rounded-lg overflow-hidden border border-purple-500/30">
          <div className="flex items-center space-x-3 p-3">
            <div className="flex-1">
              <p className="text-white text-sm font-medium">{selectedAd.title}</p>
              <p className="text-gray-400 text-xs">{selectedAd.domain}</p>
            </div>
            <a
              href={selectedAd.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
            >
              Learn more
            </a>
          </div>
        </div>
      )}
    </div>
  );
};