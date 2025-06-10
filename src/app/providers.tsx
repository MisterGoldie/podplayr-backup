"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useState, useEffect, useRef } from 'react';
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
import { PrivyAuthProvider } from '../components/auth/PrivyLoginButton';
import dynamic from "next/dynamic";

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

export const FarcasterContext = createContext<{ fid?: number }>({});

export function Providers({ children }: { children: React.ReactNode }) {
  const [fid, setFid] = useState<number>();
  const [initialProfileImage, setInitialProfileImage] = useState<string>();
  
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
  
  // FORCE the app to recognize Farcaster mini-app environment
  // This is a hard-coded override because the normal detection is failing
  const [isFarcaster, setIsFarcaster] = useState<boolean>(false);
  
  // Check aggressively for Farcaster environment
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // First check: normal detection function
    const isDetectedByFunction = isFarcasterMiniApp();
    
    // Second check: directly look for Farcaster SDK
    const hasSDKGlobal = !!(window as any)?.FarcasterFramesSDK;
    
    // Third check: look for parent/iframe relationship
    const isInIframe = window !== window.parent;
    
    // Fourth check: Check URL params
    const urlHasFarcaster = window.location.href.includes('farcaster') || 
                           window.location.href.includes('warpcast');
    
    // For debugging
    console.log('🧪 FARCASTER ENVIRONMENT CHECKS:', {
      isDetectedByFunction,
      hasSDKGlobal,
      isInIframe,
      urlHasFarcaster,
      userAgent: navigator.userAgent
    });
    
    // VERY AGGRESSIVE detection - treat as Farcaster miniapp if ANY sign points to it
    const shouldBeFarcaster = isDetectedByFunction || hasSDKGlobal || isInIframe || urlHasFarcaster;
    
    // Update state if needed
    if (shouldBeFarcaster !== isFarcaster) {
      console.log(`🔄 Setting isFarcaster to ${shouldBeFarcaster}`);
      setIsFarcaster(shouldBeFarcaster);
    }
  }, [isFarcaster]);
  
  console.log(`🚨 App is ${isFarcaster ? 'RUNNING in Farcaster mini-app' : 'NOT in Farcaster mini-app'}`);
  
  // Only track fid if in Farcaster mini-app to prevent loops
  const prevFidRef = useRef<number | undefined>(undefined);
  
  // Ensure user follows PODPlayr account whenever they have a valid fid
  useEffect(() => {
    // Only run for Farcaster users to prevent unnecessary processing
    if (isFarcaster && fid && fid !== prevFidRef.current) {
      prevFidRef.current = fid;
      console.log(`Farcaster user with fid ${fid} - ensuring PODPlayr follow`); 
      
      // Add a small delay to ensure Firebase is ready
      const timer = setTimeout(() => {
        ensurePodplayrFollow(fid);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [fid, isFarcaster]);

  return (
    <RenderProtection maxRendersPerSecond={20} timeWindowMs={1000}>
      <FarcasterContext.Provider value={{ fid }}>
        {isFarcaster ? (
          /* In Farcaster mini-app, skip PrivyAuthProvider to avoid iframe CSP violations */
          <QueryClientProvider client={queryClient}>
            <WagmiProvider>
              <ConnectionProvider>
                <NetworkProvider>
                  <VideoPlayProvider>
                    <UserImageProvider 
                      fid={fid}
                      initialProfileImage={initialProfileImage}
                    >
                      <TermsProvider>
                        <NFTCacheProvider>
                          <NFTNotificationProvider>
                            {/* Only render Frame in Farcaster mini-app */}
                            {isFarcaster && (
                              <Frame onContextUpdate={(context) => {
                                // Add a guard to prevent redundant state updates
                                if (context?.user?.fid && context.user.fid !== prevFidRef.current) {
                                  console.log(`Frame context update with fid: ${context.user.fid}`);
                                  setFid(context.user.fid);
                                  if (context.user.pfpUrl) {
                                    setInitialProfileImage(context.user.pfpUrl);
                                  }
                                }
                              }} />
                            )}
                            {children}
                            <Toaster
                              position="bottom-center"
                              reverseOrder={false}
                              toastOptions={{ duration: 3000 }}
                            />
                          </NFTNotificationProvider>
                        </NFTCacheProvider>
                      </TermsProvider>
                    </UserImageProvider>
                  </VideoPlayProvider>
                </NetworkProvider>
              </ConnectionProvider>
            </WagmiProvider>
          </QueryClientProvider>
        ) : (
          /* Outside Farcaster mini-app -> use full Privy authentication */
          <PrivyAuthProvider onFarcasterLogin={(farcasterFid) => {
            console.log('🔑 Setting Farcaster FID from Privy login:', farcasterFid);
            setFid(farcasterFid);
          }}>
            <QueryClientProvider client={queryClient}>
              <WagmiProvider>
                <ConnectionProvider>
                  <NetworkProvider>
                    <VideoPlayProvider>
                      <UserImageProvider 
                        fid={fid}
                        initialProfileImage={initialProfileImage}
                      >
                        <TermsProvider>
                          <NFTCacheProvider>
                            <NFTNotificationProvider>
                              {children}
                              <Toaster
                                position="bottom-center"
                                reverseOrder={false}
                                toastOptions={{ duration: 3000 }}
                              />
                            </NFTNotificationProvider>
                          </NFTCacheProvider>
                        </TermsProvider>
                      </UserImageProvider>
                    </VideoPlayProvider>
                  </NetworkProvider>
                </ConnectionProvider>
              </WagmiProvider>
            </QueryClientProvider>
          </PrivyAuthProvider>
        )}
      </FarcasterContext.Provider>
    </RenderProtection>
  );
}