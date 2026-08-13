"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isFarcasterMiniApp } from '../utils/platform';
import { ensurePodplayrFollow } from '../lib/firebase';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { PlayerProvider } from '../contexts/PlayerContext';
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

  // Note: PODPlayr's follower count used to be force-recomputed with a full
  // subcollection scan on every single app start here. followUser/unfollowUser
  // now keep the cached counter correct incrementally, and getFollowersCount
  // reads it in O(1), so this hot-path scan was removed entirely. Use
  // updatePodplayrFollowerCount() by hand if drift is ever suspected.

  // Initialize environment detection.
  // Farcaster's own SDK is checked FIRST and is authoritative: Farcaster
  // clients can also populate a MiniKit-shaped context (they share the same
  // underlying frame/postMessage protocol as Base), so "MiniKit context is
  // present" is not on its own reliable evidence that we're in Coinbase/Base.
  // If we skipped the Farcaster check whenever MiniKit context existed (as
  // this used to), a real Farcaster session could get mislabeled as
  // 'coinbase' with isFarcaster stuck false for the whole session — which
  // silently breaks any UX gated on isFarcaster (haptics, profile nav icon).
  useEffect(() => {
    async function initializeEnvironmentContext() {
      try {
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

          setIsFidReady(true);
          return;
        }

        // Not Farcaster — fall back to MiniKit (Base/Coinbase) context if present.
        if (miniKitContext) {
          console.log('🔍 MiniKit context detected:', miniKitContext);
          setIsMiniKit(true);
          setEnvironment('coinbase');
          
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
            
            if (miniKitContext.client) {
              setClientContext({
                clientFid: miniKitContext.client.clientFid || miniKitContext.user.fid,
                added: miniKitContext.client.added || false,
                safeAreaInsets: miniKitContext.client.safeAreaInsets,
              });
            }
            
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

        console.log('🌐 App is running in WEB environment');
        setEnvironment('web');
        setIsFidReady(true);
      } catch (error) {
        console.error('❌ Error initializing environment context:', error);
        setEnvironment('web');
        setIsFidReady(true);
      }
    }

    initializeEnvironmentContext();
  }, [miniKitContext]);
  
  // Ensure user follows PODPlayr whenever they have a valid FID.
  // Keyed on fid only (not environment) — the environment label can flip
  // from a transient MiniKit false-positive to the correct Farcaster result
  // moments later without the fid actually changing, and we don't want to
  // re-run this (and its Firestore read/write) for the same fid twice.
  const followedFidRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (fid && followedFidRef.current !== fid) {
      followedFidRef.current = fid;
      console.log(`🔑 User has FID: ${fid} in ${environment} environment`);
      ensurePodplayrFollow(fid).catch(error => {
        console.error('Error ensuring PODPlayr follow:', error);
      });
    }
  }, [fid]);

  // Memoized so consumers only re-render when the actual values change,
  // instead of on every render of InnerProviders (e.g. from unrelated state
  // updates elsewhere in the app tree).
  const userFidContextValue = useMemo(
    () => ({ fid, setFid, isFidReady, environment }),
    [fid, setFid, isFidReady, environment]
  );

  const unifiedContextValue = useMemo(
    () => ({
      isFarcaster,
      isMiniKit,
      environment,
      user: userContext,
      client: clientContext,
      location: locationContext,
      miniKitContext,
    }),
    [isFarcaster, isMiniKit, environment, userContext, clientContext, locationContext, miniKitContext]
  );

  return (
    <UserFidContext.Provider value={userFidContextValue}>
      <UnifiedContext.Provider value={unifiedContextValue}>
        <VideoPlayProvider>
          <PlayerProvider>
            <NFTNotificationProvider>
              {/* Remove ConnectionProvider wrapper */}
              {children}
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