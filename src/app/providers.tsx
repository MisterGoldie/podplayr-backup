"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { isFarcasterMiniApp } from '../utils/platform';
import { updatePodplayrFollowerCount } from '../lib/firebase';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { PlayerProvider } from '../contexts/PlayerContext';
import { ConnectionProvider } from '../context/ConnectionContext';
import { useMiniKit } from '@coinbase/onchainkit/minikit';

// Create a context for the user's Farcaster ID
export const UserFidContext = createContext<{
  fid?: number;
  setFid: (fid: number | undefined) => void;
  isFidReady: boolean;
  environment: 'farcaster' | 'coinbase' | 'web';
}>({
  setFid: () => {},
  isFidReady: false,
  environment: 'web',
});

// Enhanced context interfaces
export interface FarcasterUserContext {
  fid: number;
  username?: string;
  displayName?: string;
  pfp?: string;
  bio?: string; // This is already optional, which is correct
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

// Enhanced context that supports both Farcaster and MiniKit
export const UnifiedContext = createContext<{
  isFarcaster: boolean;
  isMiniKit: boolean;
  environment: 'farcaster' | 'coinbase' | 'web';
  user: FarcasterUserContext | null;
  client: FarcasterClientContext | null;
  location: FarcasterLocationContext | null;
  miniKitContext?: any;
}>({
  isFarcaster: false,
  isMiniKit: false,
  environment: 'web',
  user: null,
  client: null,
  location: null,
});

// Inner provider that has access to MiniKit
function InnerProviders({ children }: { children: React.ReactNode }) {
  const [fid, setFid] = useState<number>();
  const [isFarcaster, setIsFarcaster] = useState(false);
  const [isFidReady, setIsFidReady] = useState(false);
  const [environment, setEnvironment] = useState<'farcaster' | 'coinbase' | 'web'>('web');
  
  // Add missing state variables
  const [userContext, setUserContext] = useState<FarcasterUserContext | null>(null);
  const [clientContext, setClientContext] = useState<FarcasterClientContext | null>(null);
  const [locationContext, setLocationContext] = useState<FarcasterLocationContext | null>(null);

  // Get MiniKit context
  const { context: miniKitContext } = useMiniKit();
  const [isMiniKit, setIsMiniKit] = useState(false);

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
  
  // Initialize environment detection using MiniKit context
  useEffect(() => {
    async function initializeEnvironmentContext() {
      try {
        // Check MiniKit context first (Coinbase environment)
        if (miniKitContext) {
          console.log('🔍 MiniKit context detected:', miniKitContext);
          setIsMiniKit(true);
          setEnvironment('coinbase');
          
          // Extract user data from MiniKit context
          if (miniKitContext.user?.fid) {
            console.log('🔑 Setting user FID from MiniKit context:', miniKitContext.user.fid);
            setFid(miniKitContext.user.fid);
            
            setUserContext({
              fid: miniKitContext.user.fid,
              username: miniKitContext.user.username,
              displayName: miniKitContext.user.displayName,
              pfp: miniKitContext.user.pfpUrl,
              bio: (miniKitContext.user as any).bio,
            });
            
            // Set client context from MiniKit
            if (miniKitContext.client) {
              setClientContext({
                clientFid: miniKitContext.client.clientFid || miniKitContext.user.fid,
                added: miniKitContext.client.added || false,
                safeAreaInsets: miniKitContext.client.safeAreaInsets,
              });
            }
            
            // Set location context from MiniKit
            if (miniKitContext.location) {
              setLocationContext({
                type: typeof miniKitContext.location === 'string' 
                  ? miniKitContext.location 
                  : miniKitContext.location.type || 'unknown',
              });
            }
          }
          
          setIsFidReady(true);
          return;
        }
        
        // Fall back to Farcaster detection
        const isInMiniApp = await isFarcasterMiniApp();
        setIsFarcaster(isInMiniApp);
        
        if (isInMiniApp) {
          setEnvironment('farcaster');
          console.log('🚨 App is RUNNING in Farcaster mini-app');
          
          const { sdk } = await import('@farcaster/miniapp-sdk');
          const context = await sdk.context;
          
          console.log('🔍 FULL FARCASTER CONTEXT:', context);
          
          // Extract comprehensive user data
          if (context?.user?.fid) {
            console.log('🔑 Setting user FID from Farcaster SDK context:', context.user.fid);
            setFid(context.user.fid);
            
            const sdkUser = context.user as any;
            setUserContext({
              fid: sdkUser.fid,
              username: sdkUser.username,
              displayName: sdkUser.displayName,
              pfp: sdkUser.pfpUrl,
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
              const sdkLocation = context.location as any;
              setLocationContext({
                type: sdkLocation.type,
                cast: sdkLocation.cast
              });
            }
          } else {
            console.warn('⚠️ No FID found in Farcaster context');
          }
        } else {
          console.log('🌐 App is running in WEB environment');
          setEnvironment('web');
        }
        
        setIsFidReady(true);
      } catch (error) {
        console.error('❌ Error initializing environment context:', error);
        setEnvironment('web');
        setIsFidReady(true);
      }
    }

    initializeEnvironmentContext();
  }, [miniKitContext]);
  
  // Ensure user follows PODPlayr whenever they have a valid FID
  useEffect(() => {
    if (fid) {
      console.log(`🔑 User has FID: ${fid} in ${environment} environment`);
    }
  }, [fid, environment]);

  return (
    <UserFidContext.Provider value={{ fid, setFid, isFidReady, environment }}>
      <UnifiedContext.Provider value={{ 
        isFarcaster, 
        isMiniKit,
        environment,
        user: userContext,
        client: clientContext,
        location: locationContext,
        miniKitContext
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
      </UnifiedContext.Provider>
    </UserFidContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <InnerProviders>
      {children}
    </InnerProviders>
  );
}

// Updated hooks
export const useFarcasterContext = () => {
  const context = useContext(UnifiedContext);
  return {
    isFarcaster: context.isFarcaster,
    fid: context.user?.fid || null,
    setFid: () => {},
  };
};

export const useUnifiedContext = () => {
  return useContext(UnifiedContext);
};

// Legacy export for backward compatibility
export const FarcasterContext = UnifiedContext;