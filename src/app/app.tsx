"use client";

import React, { useEffect, useState } from 'react';
import { PlayerProvider } from '../contexts/PlayerContext';
import { FirebaseProvider } from '../contexts/FirebaseContext';
import dynamic from 'next/dynamic';
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";

const Demo = dynamic(() => import('../components/Demo').then(mod => mod.Demo), {
  ssr: false
});

const App: React.FC = () => {
  const [isAppReady, setIsAppReady] = useState(false);

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
        
        console.log('🚀 Initializing Farcaster mini-app SDK...');
        
        // Check if we're in a Farcaster mini-app environment
        const isInMiniApp = await sdk.isInMiniApp();
        console.log('📱 Is in Farcaster mini-app:', isInMiniApp);
        
        if (isInMiniApp) {
          // Get the user context
          const context = await sdk.context;
          console.log('👤 Farcaster user context:', context);
          
          // Wait for the app to be fully loaded
          // This ensures all components are mounted and ready
          setTimeout(async () => {
            try {
              // CRITICAL: Call ready() to hide splash screen and show content
              await sdk.actions.ready();
              console.log('✅ Farcaster SDK ready() called successfully');
              setIsAppReady(true);
            } catch (readyError) {
              console.error('❌ Error calling sdk.actions.ready():', readyError);
              // Still mark as ready even if ready() fails
              setIsAppReady(true);
            }
          }, 1000); // Give the app 1 second to fully load
        } else {
          console.log('🌐 Not in Farcaster mini-app, running as web app');
          setIsAppReady(true);
        }
      } catch (error) {
        console.error('❌ Error initializing Farcaster SDK:', error);
        // Still mark as ready even if SDK fails
        setIsAppReady(true);
      }
    };

    initializeFarcasterSDK();
  }, []);

  return (
    <FirebaseProvider>
      <PlayerProvider>
        <main className="min-h-screen flex flex-col">
          {isAppReady && <Demo />}
        </main>
      </PlayerProvider>
    </FirebaseProvider>
  );
};

export default App;