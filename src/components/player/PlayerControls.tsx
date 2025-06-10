'use client';

import React from 'react';

interface PlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  disabled?: boolean;
  onPictureInPicture?: () => void;
  showPiP?: boolean;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  disabled = false,
  onPictureInPicture,
  showPiP = false,
}) => {
  return (
    <div className="flex items-center gap-4">
      {/* Previous Track */}
      <button
        onClick={onPrevious}
        disabled={disabled}
        className={`text-purple-400 hover:text-purple-300 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} touch-manipulation`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor">
          <path d="M220-240v-480h80v480h-80Zm520 0L380-480l360-240v480Z" />
        </svg>
      </button>

      {/* Play/Pause */}
      <button
        onClick={onPlayPause}
        disabled={disabled}
        className={`w-12 h-12 rounded-full bg-purple-400 text-black flex items-center justify-center hover:bg-purple-300 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} touch-manipulation`}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M320-640v320h80V-640h-80Zm240 0v320h80V-640h-80Z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M320-200v-560l440 280-440 280Z"/>
          </svg>
        )}
      </button>

      {/* Next Track */}
      <button
        onClick={onNext}
        disabled={disabled}
        className={`text-purple-400 hover:text-purple-300 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} touch-manipulation`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="32" viewBox="0 -960 960 960" width="32" fill="currentColor">
          <path d="M660-240v-480h80v480h-80ZM140-240v-480l360 240-360 240Z" />
        </svg>
      </button>

      {/* Picture-in-Picture Toggle */}
      {showPiP && onPictureInPicture && (
        <button
          onClick={onPictureInPicture}
          disabled={disabled}
          className={`text-purple-400 hover:text-purple-300 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} touch-manipulation ml-2`}
          aria-label="Toggle Picture-in-Picture"
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M320-240h320v-240H320v240Zm-80 80v-400h480v400H240Zm80-480v-80h480v400h-80v-320H320Zm-160 0v-80h560v80H160Zm160 480v-240 240Z"/>
          </svg>
        </button>
      )}
    </div>
  );
};