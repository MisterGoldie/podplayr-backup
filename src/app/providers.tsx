"use client";

import { createContext, useEffect, useState } from 'react';
import { isFarcasterMiniApp } from '../utils/platform';
import { updatePodplayrFollowerCount } from '../lib/firebase';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { PlayerProvider } from '../contexts/PlayerContext';

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
  
  // CRITICAL: Get Farcaster user context and environment detection
  useEffect(() => {
    async function initializeFarcasterContext() {
      try {
        // Check if we're in a Farcaster mini-app
        const isInMiniApp = await isFarcasterMiniApp();
        setIsFarcaster(isInMiniApp);
        
        console.log(`🚨 App is ${isInMiniApp ? 'RUNNING in Farcaster mini-app' : 'NOT in Farcaster mini-app'}`);
        
        if (isInMiniApp) {
          // Get the user context from the SDK
          const { sdk } = await import('@farcaster/miniapp-sdk');
          const context = await sdk.context;
          
          console.log('👤 Farcaster user context:', context);
          
          if (context?.user?.fid) {
            console.log('🔑 Setting user FID from SDK context:', context.user.fid);
            setFid(context.user.fid);
            
            // Set initial profile image if available
            if (context.user.pfpUrl) {
              setInitialProfileImage(context.user.pfpUrl);
            }
          } else {
            console.warn('⚠️ No FID found in Farcaster context');
          }
        }
      } catch (error) {
        console.error('❌ Error initializing Farcaster context:', error);
      }
    }
    
    initializeFarcasterContext();
  }, []);
  
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
          <PlayerProvider>
            <NFTNotificationProvider>
              {children}
            </NFTNotificationProvider>
          </PlayerProvider>
        </VideoPlayProvider>
      </FarcasterContext.Provider>
    </UserFidContext.Provider>
  );
}