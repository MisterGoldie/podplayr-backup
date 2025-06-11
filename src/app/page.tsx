'use client';

import App from "./app";
import { useEffect } from 'react';
import { useMiniKit } from '@coinbase/onchainkit/minikit';

const appUrl = process.env.NEXT_PUBLIC_URL;

const frame = {
  version: "next",
  imageUrl: `${appUrl}/image.png`,
  button: {
    title: "Enter PODPLAYR",
    action: {
      type: "launch_frame",
      name: "PODPLAYR",
      url: appUrl,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#000000",
    },
  },
};

export default function Home() {
  const { setFrameReady, isFrameReady } = useMiniKit();

  // The setFrameReady() function is called when your mini-app is ready to be shown
  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [setFrameReady, isFrameReady]);

  return (
    <main>
      <App />
    </main>
  );
}