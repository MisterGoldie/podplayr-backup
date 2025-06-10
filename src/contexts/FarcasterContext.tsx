import React, { createContext, useContext, useState, useEffect } from 'react';

interface FarcasterContextType {
  isFarcaster: boolean;
  fid: number | null;
  setFid: (fid: number | null) => void;
}

const FarcasterContext = createContext<FarcasterContextType>({
  isFarcaster: false,
  fid: null,
  setFid: () => {},
});

export const useFarcasterContext = () => useContext(FarcasterContext);

export const FarcasterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isFarcaster, setIsFarcaster] = useState(false);
  const [fid, setFid] = useState<number | null>(null);

  useEffect(() => {
    // Check if we're in a Farcaster environment
    const checkFarcaster = () => {
      if (typeof window === 'undefined') return false;
      
      // Check for explicit FORCE_FARCASTER_MODE flag
      if ((window as any).FORCE_FARCASTER_MODE === true) {
        return true;
      }
      
      // Check if app is inside an iframe
      const isInIframe = window !== window.parent;
      
      // Check for Farcaster-specific signals
      const hasFarcasterContext = !!(window as any)?.farcasterFrameContext;
      const hasFarcasterUA = navigator.userAgent.includes('Farcaster') || 
                            navigator.userAgent.includes('Warpcast');
      
      return isInIframe || hasFarcasterContext || hasFarcasterUA;
    };

    setIsFarcaster(checkFarcaster());
  }, []);

  return (
    <FarcasterContext.Provider value={{ isFarcaster, fid, setFid }}>
      {children}
    </FarcasterContext.Provider>
  );
}; 