import { useState, useRef, useMemo } from 'react';
import { processMediaUrl } from '../../utils/media';

interface MediaRendererProps {
  url: string;
  alt: string;
  className: string;
}

export const MediaRenderer: React.FC<MediaRendererProps> = ({ url, alt, className }) => {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const mediaUrl = useMemo(() => {
    if (!url) return null;
    return processMediaUrl(url);
  }, [url]);

  if (!mediaUrl || error) {
    return (
      <div className={`${className} bg-gray-800 flex items-center justify-center`}>
        <div className="text-green-400 font-mono text-sm break-all p-2">{alt}</div>
      </div>
    );
  }

  const isVideo = /\.(mp4|webm|mov)$/i.test(mediaUrl);
  const videoFormat = mediaUrl.split('.').pop()?.toLowerCase();
  
  // Check if the video format is supported on this device
  const isVideoSupported = useMemo(() => {
    if (!isVideo || !videoFormat) return false;
    const video = document.createElement('video');
    return video.canPlayType(`video/${videoFormat}`) !== '';
  }, [isVideo, videoFormat]);

  if (isVideo && isVideoSupported) {
    return (
      <video 
        ref={videoRef}
        src={mediaUrl}
        className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'}`}
        playsInline
        loop={false}
        muted={true}
        controls={false}
        preload="none"
        poster={url ? processMediaUrl(url.replace(/\.(mp4|webm|mov)/, '.jpg')) : undefined}
        onError={() => setError(true)}
        onLoadedData={() => setLoaded(true)}
      />
    );
  }

  return (
    <img 
      src={mediaUrl} 
      alt={alt} 
      className={className}
      onError={() => setError(true)}
    />
  );
}; 