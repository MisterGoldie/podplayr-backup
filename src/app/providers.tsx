"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { isFarcasterMiniApp } from '../utils/platform';
import { updatePodplayrFollowerCount } from '../lib/firebase';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { PlayerProvider } from '../contexts/PlayerContext';
import { ConnectionProvider } from '../context/ConnectionContext';

// Create a context for the user's Farcaster ID
export const UserFidContext = createContext<{
  fid?: number;
  setFid: (fid: number | undefined) => void;
  isFidReady: boolean;
}>({
  setFid: () => {},
  isFidReady: false,
});

// Enhanced context interfaces
export interface FarcasterUserContext {
  fid: number;
  username?: string;
  displayName?: string;
  pfp?: string;
  bio?: string;
  location?: {
    placeId?: string;
    description?: string;
  };
}

export interface FarcasterClientContext {
  clientFid: number;
  added: boolean;
  safeAreaInsets?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  notificationDetails?: {
    url: string;
    token: string;
  };
}

export interface FarcasterLocationContext {
  type: string;
  cast?: {
    fid: number;
    hash: string;
  };
}

// Enhanced Farcaster context
export const FarcasterContext = createContext<{
  isFarcaster: boolean;
  user: FarcasterUserContext | null;
  client: FarcasterClientContext | null;
  location: FarcasterLocationContext | null;
}>({
  isFarcaster: false,
  user: null,
  client: null,
  location: null,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [fid, setFid] = useState<number>();
  const [isFarcaster, setIsFarcaster] = useState(false);
  const [isFidReady, setIsFidReady] = useState(false);
  
  // Add missing state variables
  const [userContext, setUserContext] = useState<FarcasterUserContext | null>(null);
  const [clientContext, setClientContext] = useState<FarcasterClientContext | null>(null);
  const [locationContext, setLocationContext] = useState<FarcasterLocationContext | null>(null);

  // Update PODPLAYR follower count when the app starts
  useEffect(() => {
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
        const isInMiniApp = await isFarcasterMiniApp();
        setIsFarcaster(isInMiniApp);
        
        console.log(`🚨 App is ${isInMiniApp ? 'RUNNING in Farcaster mini-app' : 'NOT in Farcaster mini-app'}`);
        
        if (isInMiniApp) {
          const { sdk } = await import('@farcaster/miniapp-sdk');
          const context = await sdk.context;
          
          console.log('🔍 FULL USER CONTEXT:', context);
          
          // Extract comprehensive user data
          if (context?.user?.fid) {
            console.log('🔑 Setting user FID from SDK context:', context.user.fid);
            setFid(context.user.fid);
            
            // Set comprehensive user context - use type assertion to tell TypeScript this is SDK context
            const sdkUser = context.user as any;
            setUserContext({
              fid: sdkUser.fid,
              username: sdkUser.username,
              displayName: sdkUser.displayName,
              pfp: sdkUser.pfpUrl, // Use pfpUrl instead of pfp
              bio: sdkUser.bio,
              location: sdkUser.location
            });
            
            // Set client context
            if (context.client) {
              setClientContext({
                clientFid: context.client.clientFid,
                added: context.client.added,
                safeAreaInsets: context.client.safeAreaInsets,
                notificationDetails: context.client.notificationDetails
              });
            }
            
            // Set location context
            if (context.location) {
              const sdkLocation = context.location as any; // Type assertion
              setLocationContext({
                type: sdkLocation.type,
                cast: sdkLocation.cast // This should work with type assertion
              });
            }
            
            // Mark FID as ready after all context is set
            setIsFidReady(true);
          } else {
            console.warn('⚠️ No FID found in Farcaster context');
            setIsFidReady(true);
          }
        } else {
          // For non-Farcaster environments, mark as ready immediately
          setIsFidReady(true);
        }
      } catch (error) {
        console.error('❌ Error initializing Farcaster context:', error);
        setIsFidReady(true); // Mark as ready even on error
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
    <UserFidContext.Provider value={{ fid, setFid, isFidReady }}>
      <FarcasterContext.Provider value={{ 
        isFarcaster, 
        user: userContext,
        client: clientContext,
        location: locationContext
      }}>
        <VideoPlayProvider>
          <PlayerProvider>
            <NFTNotificationProvider>
              <ConnectionProvider>
                {children}
              </ConnectionProvider>
            </NFTNotificationProvider>
          </PlayerProvider>
        </VideoPlayProvider>
      </FarcasterContext.Provider>
    </UserFidContext.Provider>
  );
}

// Add this hook for backward compatibility
export const useFarcasterContext = () => {
  const context = useContext(FarcasterContext);
  return {
    isFarcaster: context.isFarcaster,
    fid: context.user?.fid || null,
    setFid: () => {}, // This would need to be implemented if needed
  };
};