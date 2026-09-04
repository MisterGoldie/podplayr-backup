"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { isBaseAppBrowser, isCoinbaseWalletClientFid, isFarcasterMiniApp, isRealFid } from '../utils/platform';
import { ensurePodplayrFollow, searchUsersByAddress } from '../lib/firebase';
import { VideoPlayProvider } from '../contexts/VideoPlayContext';
import { NFTNotificationProvider } from '../context/NFTNotificationContext';
import { PlayerProvider } from '../contexts/PlayerContext';
import { useMiniKit } from '@coinbase/onchainkit/minikit';
import { Toaster } from 'react-hot-toast';
import { getStoredBaseWalletAddress, signInWithBase } from '../lib/baseAccount';
import { signInToFirebaseWithQuickAuth } from '../lib/firebaseSession';
import { getBioText } from '../utils/format';

// Create a context for the user's Farcaster ID
export const UserFidContext = createContext<{
  fid?: number;
  setFid: (fid: number | undefined) => void;
  isFidReady: boolean;
  environment: 'farcaster' | 'coinbase' | 'web';
  walletAddress?: string;
  connectBaseWallet?: () => Promise<void>;
  firebaseUid?: string;
  isFirebaseAuthReady: boolean;
}>({
  setFid: () => {},
  isFidReady: false,
  environment: 'web',
  isFirebaseAuthReady: false,
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
  /** The embed URL that triggered this launch (present when type === 'cast_embed'). */
  embed?: string;
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
  const [walletAddress, setWalletAddress] = useState<string>();
  const [firebaseUid, setFirebaseUid] = useState<string>();
  const [isFirebaseAuthReady, setIsFirebaseAuthReady] = useState(false);
  
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

  // 2024: Base App was a Farcaster mini-app host (clientFid 309857).
  // April 9 2026: Base App is a standard webview — isInMiniApp() is false,
  // MiniKit still injects dummy context (fid -1) in regular browsers.
  // Detect Base App via clientFid 309857 or Coinbase's isCoinbaseBrowser flag.
  // Never treat MiniKit context presence or isCoinbaseWallet as Base App.
  useEffect(() => {
    async function initializeEnvironmentContext() {
      try {
        const applyMiniKitUser = () => {
          const miniUser = miniKitContext?.user;
          const miniFid = miniUser?.fid;
          if (!miniUser || !isRealFid(miniFid)) return;
          setFid(miniFid);
          setUserContext({
            fid: miniFid,
            username: miniUser.username,
            displayName: miniUser.displayName,
            pfp: miniUser.pfpUrl,
            bio: (miniUser as any).bio,
          });
          const miniClient = miniKitContext?.client;
          if (miniClient) {
            setClientContext({
              clientFid: miniClient.clientFid || miniFid,
              added: miniClient.added || false,
              safeAreaInsets: miniClient.safeAreaInsets,
            });
          }
        };

        const isInMiniApp = await isFarcasterMiniApp();

        if (isInMiniApp) {
          const { sdk } = await import('@farcaster/miniapp-sdk');

          // Applies a resolved sdk.context payload to React state. Pulled out
          // so a context that arrives AFTER our fast-path timeout below can
          // still be applied later instead of being silently discarded — on
          // a cold miniapp launch (e.g. tapping a shared NFT cast for the
          // first time) the host can easily take longer than the timeout to
          // deliver context, and losing it means losing location.embed too,
          // which is what deep-link routing falls back on.
          const applyContext = (context: Awaited<typeof sdk.context> | null) => {
            const clientFid = context?.client?.clientFid;
            const hostedByBase = isCoinbaseWalletClientFid(clientFid) || isBaseAppBrowser();

            if (hostedByBase) {
              setIsFarcaster(false);
              setIsMiniKit(true);
              setEnvironment('coinbase');
              applyMiniKitUser();
              return;
            }

            setIsFarcaster(true);
            setEnvironment('farcaster');

            const sdkUser = context?.user;
            if (context && sdkUser && isRealFid(sdkUser.fid)) {
              setFid(sdkUser.fid);
              const user = sdkUser as any;
              setUserContext({
                fid: sdkUser.fid,
                username: user.username,
                displayName: user.displayName,
                pfp: user.pfpUrl,
                bio: user.bio,
                location: user.location
              });

              if (context.client) {
                setClientContext({
                  clientFid: context.client.clientFid,
                  added: context.client.added,
                  safeAreaInsets: context.client.safeAreaInsets,
                  notificationDetails: context.client.notificationDetails
                });
              }

              if (context.location) {
                const sdkLocation = context.location as any;
                setLocationContext({
                  type: sdkLocation.type,
                  embed: sdkLocation.embed,
                  cast: sdkLocation.cast
                });
              }
            } else if (context) {
              console.warn('⚠️ No FID found in Farcaster context');
            }
          };

          const contextPromise = sdk.context;
          const context = await Promise.race([
            contextPromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);

          if (context) {
            applyContext(context);
          } else {
            // Timed out — don't block the UI on it, but keep listening in
            // the background and hydrate state the moment it does resolve.
            contextPromise
              .then((lateContext) => {
                if (lateContext) applyContext(lateContext);
              })
              .catch(() => {
                // Host never delivered context — nothing more to do.
              });
          }

          setIsFidReady(true);
          return;
        }

        if (isBaseAppBrowser()) {
          setIsMiniKit(true);
          setEnvironment('coinbase');
          applyMiniKitUser();
          setIsFidReady(true);
          return;
        }

        setEnvironment('web');
        setIsFidReady(true);
      } catch (error) {
        console.error('❌ Error initializing environment context:', error);
        if (isBaseAppBrowser()) {
          setEnvironment('coinbase');
          setIsMiniKit(true);
        } else {
          setEnvironment('web');
        }
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
      ensurePodplayrFollow(fid).catch(error => {
        console.error('Error ensuring PODPlayr follow:', error);
      });
    }
  }, [fid]);

  useEffect(() => {
    if (!isFidReady) return;

    if (environment !== 'farcaster' || !fid) {
      setIsFirebaseAuthReady(true);
      return;
    }

    let cancelled = false;
    setIsFirebaseAuthReady(false);

    signInToFirebaseWithQuickAuth(fid)
      .then((uid) => {
        if (!cancelled && uid) setFirebaseUid(uid);
      })
      .catch((error) => {
        console.error('Firebase Quick Auth sign-in failed:', error);
      })
      .finally(() => {
        if (!cancelled) setIsFirebaseAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isFidReady, environment, fid]);

  const applyWalletIdentity = useCallback(async (address: string) => {
    setWalletAddress(address.toLowerCase());
    const matches = await searchUsersByAddress(address);
    const matched = matches[0];
    if (!matched?.fid) return;

    setFid(matched.fid);
    setUserContext({
      fid: matched.fid,
      username: matched.username,
      displayName: matched.display_name,
      pfp: matched.pfp_url,
      bio: getBioText(matched.profile?.bio),
    });
  }, []);

  const connectBaseWallet = useCallback(async () => {
    const result = await signInWithBase();
    await applyWalletIdentity(result.address);
  }, [applyWalletIdentity]);

  useEffect(() => {
    if (environment !== 'coinbase' || fid || walletAddress) return;
    const saved = getStoredBaseWalletAddress();
    if (!saved) return;
    void applyWalletIdentity(saved);
  }, [environment, fid, walletAddress, applyWalletIdentity]);

  // Memoized so consumers only re-render when the actual values change,
  // instead of on every render of InnerProviders (e.g. from unrelated state
  // updates elsewhere in the app tree).
  const userFidContextValue = useMemo(
    () => ({
      fid,
      setFid,
      isFidReady,
      environment,
      walletAddress,
      connectBaseWallet,
      firebaseUid,
      isFirebaseAuthReady,
    }),
    [fid, setFid, isFidReady, environment, walletAddress, connectBaseWallet, firebaseUid, isFirebaseAuthReady]
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
          <PlayerProvider fid={fid}>
            <NFTNotificationProvider>
              {children}
              <Toaster
                position="top-center"
                toastOptions={{
                  style: {
                    background: '#1a1a1a',
                    color: '#fff',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  },
                }}
              />
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