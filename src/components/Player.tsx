'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { NFT } from '../types/user';
import { getMediaKey } from '../utils/media';
import { cacheAudioMetadata, getCachedAudioMetadata, getFastestGateway } from '../utils/audioPreloader';

type AudioQuality = 'high' | 'low';

interface PlayerProps {
  nft: NFT | null;
  onPlaybackComplete?: () => void;
  onError?: (error: Error) => void;
}

export const Player: React.FC<PlayerProps> = ({ nft, onPlaybackComplete, onError }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('high');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<'poor'|'medium'|'good'>('medium');

  // Handle network quality changes
  useEffect(() => {
    const handleNetworkChange = () => {
      const connection = (navigator as any).connection;
      if (connection) {
        // Adjust quality based on network type and effective type
        const newQuality: AudioQuality = 
          connection.type === 'wifi' || 
          (connection.effectiveType === '4g' && connection.downlink >= 5)
            ? 'high'
            : 'low';
        
        setAudioQuality(newQuality);
      }
    };

    if ('connection' in navigator) {
      (navigator as any).connection.addEventListener('change', handleNetworkChange);
      // Initial check
      handleNetworkChange();
      
      return () => {
        (navigator as any).connection.removeEventListener('change', handleNetworkChange);
      };
    }
  }, []);

  // Network quality detection
  useEffect(() => {
    const updateNetworkQuality = () => {
      if (!('connection' in navigator)) return;
      
      const connection = (navigator as any).connection;
      const effectiveType = connection?.effectiveType || 'unknown';
      const downlink = connection?.downlink || 0;
      
      if (effectiveType === 'slow-2g' || effectiveType === '2g' || downlink < 0.5) {
        setNetworkQuality('poor');
      } else if (effectiveType === '3g' || downlink < 2) {
        setNetworkQuality('medium');
      } else {
        setNetworkQuality('good');
      }
      
      console.log(`Network quality detected: ${effectiveType}, ${downlink}Mbps`);
    };
    
    updateNetworkQuality();
    
    if ('connection' in navigator) {
      (navigator as any).connection.addEventListener('change', updateNetworkQuality);
      return () => {
        (navigator as any).connection.removeEventListener('change', updateNetworkQuality);
      };
    }
  }, []);

  // Load audio when NFT changes
  useEffect(() => {
    const loadAudio = async () => {
      if (!nft || !audioRef.current) return;

      try {
        // Get the fastest gateway URL
        const gatewayUrl = await getFastestGateway(nft);
        if (!gatewayUrl) {
          throw new Error('No working gateway found');
        }

        // Load cached metadata if available
        const cached = getCachedAudioMetadata(nft);
        if (cached) {
          setDuration(cached.duration);
        }

        // Set audio source and quality
        audioRef.current.src = gatewayUrl;
        audioRef.current.preload = audioQuality === 'high' ? 'auto' : 'metadata';
        
        // Cache metadata once loaded
        audioRef.current.addEventListener('loadedmetadata', () => {
          cacheAudioMetadata(nft, audioRef.current);
          setDuration(audioRef.current?.duration || 0);
        }, { once: true });

      } catch (error) {
        console.error('Error loading audio:', error);
        onError?.(error as Error);
      }
    };

    loadAudio();
  }, [nft, audioQuality]);

  // Handle playback
  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Update progress
  useEffect(() => {
    if (!audioRef.current) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audioRef.current?.currentTime || 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onPlaybackComplete?.();
    };

    audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
    audioRef.current.addEventListener('ended', handleEnded);

    return () => {
      audioRef.current?.removeEventListener('timeupdate', handleTimeUpdate);
      audioRef.current?.removeEventListener('ended', handleEnded);
    };
  }, [onPlaybackComplete]);

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4">
      <audio ref={audioRef} />
      
      <div className="max-w-screen-xl mx-auto flex items-center gap-4">
        {/* NFT Info */}
        {nft && (
          <div className="flex items-center gap-3 flex-1">
            <img 
              src={nft.image} 
              alt={nft.name} 
              className="w-12 h-12 rounded-lg object-cover"
            />
            <div>
              <h3 className="text-sm font-medium text-white">{nft.name}</h3>
              <p className="text-xs text-gray-400">
                Quality: {audioQuality === 'high' ? 'High' : 'Low'}
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-purple-500 text-black flex items-center justify-center hover:bg-purple-400 transition-colors"
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M520-200h80v-560h-80v560Zm-160 0h80v-560h-80v560Z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24">
                <path d="M320-200v-560l440 280-440 280Z"/>
              </svg>
            )}
          </button>

          {/* Progress Bar */}
          <div className="flex-1 max-w-md">
            <div className="bg-gray-700 rounded-full h-1">
              <div 
                className="bg-purple-500 h-1 rounded-full"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};