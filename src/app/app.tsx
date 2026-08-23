"use client";

import React, { useEffect } from 'react';
import { FirebaseProvider } from '../contexts/FirebaseContext';
import dynamic from 'next/dynamic';
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";
import { useMiniKit } from '@coinbase/onchainkit/minikit';

function hideFarcasterSplash() {
  let cancelled = false;

  void (async () => {
    try {
      const { sdk } = await import('@farcaster/miniapp-sdk');
      if (!(await sdk.isInMiniApp())) return;
      await sdk.context;
      if (!cancelled) await sdk.actions.ready();
    } catch (error) {
      console.error('Error initializing Farcaster SDK:', error);
    }
  })();

  return () => {
    cancelled = true;
  };
}

const Demo = dynamic(
  () =>
    import('../components/Demo').then((mod) => {
      const LoadedDemo = mod.Demo;
      function DemoWithSplashHidden() {
        useEffect(() => hideFarcasterSplash(), []);
        return <LoadedDemo />;
      }
      return DemoWithSplashHidden;
    }),
  { ssr: false }
);

const App: React.FC = () => {
  const { setFrameReady, isFrameReady } = useMiniKit();

  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [isFrameReady, setFrameReady]);

  useEffect(() => {
    setupArweaveUrlInterceptor();
  }, []);

  return (
    <FirebaseProvider>
      <main className="flex flex-col">
        <Demo />
      </main>
    </FirebaseProvider>
  );
};

export default App;
