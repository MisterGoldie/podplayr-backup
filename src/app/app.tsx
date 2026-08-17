"use client";

import React, { useEffect } from 'react';
import { FirebaseProvider } from '../contexts/FirebaseContext';
import dynamic from 'next/dynamic';
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";
import { useMiniKit } from '@coinbase/onchainkit/minikit';

const Demo = dynamic(() => import('../components/Demo').then(mod => mod.Demo), {
  ssr: false
});

const App: React.FC = () => {
  const { setFrameReady, isFrameReady } = useMiniKit();

  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [isFrameReady, setFrameReady]);

  // Set up network handlers
  useEffect(() => {
    // Set up Arweave URL interceptor in all environments
    setupArweaveUrlInterceptor();
  }, []);

  // CRITICAL: Initialize Farcaster mini-app SDK and call ready()
  useEffect(() => {
    const initializeFarcasterSDK = async () => {
      try {
        // Dynamically import the correct SDK
        const { sdk } = await import('@farcaster/miniapp-sdk');
        
        
        // Check if we're in a Farcaster mini-app environment
        const isInMiniApp = await sdk.isInMiniApp();
        
        if (isInMiniApp) {
          await sdk.context;
          
          // Wait for the app to be fully loaded
          // This ensures all components are mounted and ready
          setTimeout(async () => {
            try {
              // CRITICAL: Call ready() to hide splash screen and show content
              await sdk.actions.ready();
            } catch (readyError) {
              console.error('❌ Error calling sdk.actions.ready():', readyError);
            }
          }, 1000); // Give the app 1 second to fully load
        }
      } catch (error) {
        console.error('❌ Error initializing Farcaster SDK:', error);
      }
    };

    initializeFarcasterSDK();
  }, []);

  return (
    <FirebaseProvider>
      {/* Remove PlayerProvider from here since it's already in providers.tsx */}
      <main className="flex flex-col">
        <Demo />
      </main>
    </FirebaseProvider>
  );
};

export default App;