"use client";

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";
import { useMiniKit } from '@coinbase/onchainkit/minikit';

/** Upper bound on how long the splash may cover a deep-link resolve. */
const SPLASH_DEEP_LINK_MAX_WAIT_MS = 3000;

function hideFarcasterSplash() {
  let cancelled = false;

  void (async () => {
    try {
      const { sdk } = await import('@farcaster/miniapp-sdk');
      if (!(await sdk.isInMiniApp())) return;
      await sdk.context;
      // Hold the splash over the deep-link resolve so a shared cast opens
      // straight into the maximized player instead of flashing HomeView.
      const { waitForDeepLinkSettled } = await import('../lib/deepLinkReady');
      await waitForDeepLinkSettled(SPLASH_DEEP_LINK_MAX_WAIT_MS);
      if (!cancelled) await sdk.actions.ready();
      if (!cancelled) {
        const { promptEnableMiniAppNotifications } = await import('../lib/promptEnableNotifications');
        await promptEnableMiniAppNotifications();
      }
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
    <main className="flex flex-col">
      <Demo />
    </main>
  );
};

export default App;
