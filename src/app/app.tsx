"use client";

import React from 'react';
import { PlayerProvider } from '../contexts/PlayerContext';
import { FirebaseProvider } from '../contexts/FirebaseContext';
import dynamic from 'next/dynamic';
import { useEffect } from "react";
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";

const Demo = dynamic(() => import('../components/Demo').then(mod => mod.Demo), {
  ssr: false
});

const App: React.FC = () => {
  // Set up network handlers
  useEffect(() => {
    // Set up Arweave URL interceptor in all environments
    setupArweaveUrlInterceptor();
  }, []);

  return (
    <FirebaseProvider>
      <PlayerProvider>
        <main className="min-h-screen flex flex-col">
          <Demo />
        </main>
      </PlayerProvider>
    </FirebaseProvider>
  );
};

export default App;