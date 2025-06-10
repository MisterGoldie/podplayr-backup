'use client';

import React, { createContext, useContext, useState } from 'react';

interface VideoPlayContextType {
  playCount: number;
  incrementPlayCount: () => void;
  resetPlayCount: () => void;
}

const VideoPlayContext = createContext<VideoPlayContextType | undefined>(undefined);

export const VideoPlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playCount, setPlayCount] = useState(0);

  const incrementPlayCount = () => {
    setPlayCount(prev => prev + 1);
  };

  const resetPlayCount = () => {
    setPlayCount(0);
  };

  return (
    <VideoPlayContext.Provider value={{ playCount, incrementPlayCount, resetPlayCount }}>
      {children}
    </VideoPlayContext.Provider>
  );
};

export const useVideoPlay = () => {
  const context = useContext(VideoPlayContext);
  if (context === undefined) {
    throw new Error('useVideoPlay must be used within a VideoPlayProvider');
  }
  return context;
};