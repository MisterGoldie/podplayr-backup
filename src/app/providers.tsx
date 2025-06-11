"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from 'react';
import { isFarcasterMiniApp } from '../utils/platform';
import { RenderProtection } from '../lib/RenderProtection';
import { Frame } from '~/components/frame/Frame';
import type { FrameContext } from '@farcaster/frame-core';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { UserImageProvider } from '../contexts/UserImageContext';
import { Toaster } from 'react-hot-toast';
import NetworkProvider from '../providers/NetworkProvider';
import { ensurePodplayrFollow, updatePodplayrFollowerCount } from '../lib/firebase';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { ConnectionProvider } from '../context/ConnectionContext';
import { TermsProvider } from '../context/TermsContext';
import { NFTCacheProvider } from '../contexts/NFTCacheContext';
import dynamic from "next/dynamic";
import { useRouter } from 'next/navigation';

// Create a new QueryClient instance
const queryClient = new QueryClient();

// Import ALL wallet-related components dynamically to avoid SSR issues and control initialization order
const WagmiProvider = dynamic(
  () => import("~/components/providers/WagmiProvider").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div className="hidden">Loading wallet...</div>
  }
);

// Our WalletConnect protection happens via the client component in layout.tsx
// Privy provider is already imported at the top of the file

// Create a context for the user's Farcaster ID
export const UserFidContext = createContext<{
  fid?: number;
  setFid: (fid: number | undefined) => void;
}>({
  setFid: () => {},
});

// Create a context for Farcaster-specific state
export const FarcasterContext = createContext<{
  isFarcaster: boolean;
  initialProfileImage: string | null;
}>({
  isFarcaster: false,
  initialProfileImage: null,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [fid, setFid] = useState<number>();
  const [isFarcaster, setIsFarcaster] = useState(false);
  const [initialProfileImage, setInitialProfileImage] = useState<string | null>(null);
  const router = useRouter();

  // Update PODPLAYR follower count when the app starts
  useEffect(() => {
    // Run this once when the app loads
    const updatePodplayrCount = async () => {
      try {
        console.log('App started - updating PODPlayr follower count');
        const totalUsers = await updatePodplayrFollowerCount();
        console.log(`PODPlayr follower count updated to ${totalUsers}`);
      } catch (error) {
        console.error('Error updating PODPlayr follower count on app start:', error);
      }
    }
    
    updatePodplayrCount();
  }, []);
  
  // Aggressive Farcaster environment detection
  useEffect(() => {
    async function checkFarcaster() {
      const isFarcaster = await isFarcasterMiniApp();
      setIsFarcaster(isFarcaster);
    }
    checkFarcaster();
  }, []);
  
  console.log(`🚨 App is ${isFarcaster ? 'RUNNING in Farcaster mini-app' : 'NOT in Farcaster mini-app'}`);
  
  // Ensure user follows PODPlayr whenever they have a valid FID
  useEffect(() => {
    if (fid) {
      console.log('🔑 User has FID:', fid);
    }
  }, [fid]);

  return (
    <UserFidContext.Provider value={{ fid, setFid }}>
      <FarcasterContext.Provider value={{ isFarcaster, initialProfileImage }}>
        <VideoPlayProvider>
          <NFTNotificationProvider>
            {children}
          </NFTNotificationProvider>
        </VideoPlayProvider>
      </FarcasterContext.Provider>
    </UserFidContext.Provider>
  );
}