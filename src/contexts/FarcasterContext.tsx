import React, { createContext, useContext, useState, useEffect } from 'react';
import sdk from '@farcaster/miniapp-sdk';

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
    async function checkMiniApp() {
      const result = await sdk.isInMiniApp();
      setIsFarcaster(result);
    }
    checkMiniApp();
  }, []);

  return (
    <FarcasterContext.Provider value={{ isFarcaster, fid, setFid }}>
      {children}
    </FarcasterContext.Provider>
  );
}; 