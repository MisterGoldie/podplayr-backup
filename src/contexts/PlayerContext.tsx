import React, { createContext, useContext, useState, ReactNode } from 'react';
import { NFT } from '../types/user';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { PlaybackButton } from '../components/buttons/PlaybackButton';

interface PlayerContextType {
  isPlaying: boolean;
  currentPlayingNFT: NFT | null;
  currentlyPlaying: string | null;
  audioProgress: number;
  audioDuration: number;
  isPlayerMinimized: boolean;
  handlePlayPause: () => void;
  handlePlayNext: () => void;
  handlePlayPrevious: () => void;
  handleSeek: (time: number) => void;
  handlePlayAudio: (nft: NFT) => Promise<void>;
  setIsPlayerMinimized: (minimized: boolean) => void;
}

interface PlayerProviderProps {
  children: ReactNode;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children }) => {
  const [isPlayerMinimized, setIsPlayerMinimized] = useState(true);
  const player = useAudioPlayer();

  const value = {
    ...player,
    isPlayerMinimized,
    setIsPlayerMinimized,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};

interface PlayerControlsProps {
  isPlaying: boolean;
  handlePlayPause: () => void;
  handlePrevious: () => void;
  handleNext: () => void;
  handleSeek: (time: number) => void;
  currentTime: number;
  duration: number;
  isMinimized?: boolean;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  handlePlayPause,
  handlePrevious,
  handleNext,
  handleSeek,
  currentTime,
  duration,
  isMinimized = false,
}) => {
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col gap-2 ${isMinimized ? 'w-48' : 'w-full'}`}>
      {/* Progress Bar */}
      <div className="w-full flex items-center gap-2">
        <span className="text-xs font-mono text-gray-400 min-w-[40px]">
          {formatTime(currentTime)}
        </span>
        <div className="relative flex-1 h-1 bg-gray-700 rounded cursor-pointer group">
          <div
            className="absolute h-full bg-purple-400 rounded"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="absolute w-full h-full opacity-0 cursor-pointer"
          />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-purple-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        </div>
        <span className="text-xs font-mono text-gray-400 min-w-[40px]">
          {formatTime(duration)}
        </span>
      </div>

      {/* Playback Controls */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={handlePrevious}
          className="p-2 text-gray-400 hover:text-purple-500 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M220-240v-480h80v480h-80Zm520 0L380-480l360-240v480Z"/>
          </svg>
        </button>

        <PlaybackButton
          isPlaying={isPlaying}
          onClick={handlePlayPause}
          size={isMinimized ? "small" : "medium"}
          className="retro-button"
        />

        <button
          onClick={handleNext}
          className="p-2 text-gray-400 hover:text-purple-500 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M660-240v-480h80v480h-80ZM220-240v-480l360 240-360 240Z"/>
          </svg>
        </button>
      </div>

      {/* Cassette Animation when Playing */}
      {isPlaying && !isMinimized && (
        <div className="flex justify-center gap-8 mt-4">
          <div className="cassette-wheel animate-spin-slow" />
          <div className="cassette-wheel animate-spin-slow" />
        </div>
      )}

      {/* LED Light */}
      {!isMinimized && (
        <div className={`led-light ${isPlaying ? 'on' : ''} mx-auto mt-2`} />
      )}
    </div>
  );
};