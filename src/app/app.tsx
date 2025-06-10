"use client";

import dynamic from "next/dynamic";
import { PlayerProvider } from "../contexts/PlayerContext";
import { useEffect } from "react";
import { setupWarningSuppressions } from "../utils/suppressWarnings";
import { setupArweaveUrlInterceptor } from "../utils/networkErrorHandler";

const Demo = dynamic(() => import("../components/Demo"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#2D1B3D] to-[#151515]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
    </div>
  ),
});

export default function App() {
  // Set up warning suppressions and network handlers
  useEffect(() => {
    // Only suppress warnings in development
    if (process.env.NODE_ENV === 'development') {
      setupWarningSuppressions();
    }
    
    // Set up Arweave URL interceptor in all environments
    setupArweaveUrlInterceptor();
  }, []);

  return (
    <PlayerProvider>
      <main className="min-h-screen flex flex-col">
        <Demo />
      </main>
    </PlayerProvider>
  );
}