// CRITICAL: Only import shared base dependencies
import React from 'react';
import { base } from 'wagmi/chains';
import { http } from 'wagmi';
import { sdk } from '@farcaster/frame-sdk';

// Updated detection using the official @farcaster/frame-sdk
async function detectFarcasterMiniApp(): Promise<boolean> {
  try {
    return await sdk.isInMiniApp();
  } catch (error) {
    console.error('Error detecting Farcaster mini-app:', error);
    return false;
  }
}

// Create wrapper components that use a different approach to avoid module resolution issues
const FarcasterProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Import components only when this component renders
  const [Provider, setProvider] = React.useState<any>(null);
  
  React.useEffect(() => {
    // Dynamic import with .then() instead of import() syntax to avoid resolution issues
    import('wagmi').then(wagmi => {
      import('../../lib/connector').then(({ frameConnector }) => {
        // Create configuration here instead of importing
        const config = wagmi.createConfig({
          chains: [base],
          transports: {
            [base.id]: http()
          },
          connectors: [
            frameConnector()
          ]
        });
        
        // Create a component on the fly
        const FarcasterWagmiProvider = ({ children }: {children: React.ReactNode}) => {
          console.log('⚡ Using Farcaster-specific WagmiProvider');
          return (
            <wagmi.WagmiProvider config={config}>
              {children}
            </wagmi.WagmiProvider>
          );
        };
        
        setProvider(() => FarcasterWagmiProvider);
      });
    });
  }, []);
  
  if (!Provider) {
    return <div className="hidden">Loading Farcaster provider...</div>;
  }
  
  return <Provider>{children}</Provider>;
};

// Top-level provider that decides which implementation to use
const Provider = React.memo(function WagmiProviderComponent({ children }: { children: React.ReactNode }) {
  // Direct check for Farcaster mode without external dependencies
  const [isInFarcasterMode, setIsInFarcasterMode] = React.useState(false);
  
  // Only run the detection on the client side
  React.useEffect(() => {
    detectFarcasterMiniApp().then(isFarcaster => {
      setIsInFarcasterMode(isFarcaster);
      console.log(`🧩 Using ${isFarcaster ? 'FARCASTER' : 'WEB'} WagmiProvider mode`);
    });
  }, []);
  
  return (
    <React.Suspense fallback={<div className="hidden">Loading wallet provider...</div>}>
      <FarcasterProvider>
        {children}
      </FarcasterProvider>
    </React.Suspense>
  );
});

// Add display name for debugging
Provider.displayName = 'WagmiProvider';

export default Provider;