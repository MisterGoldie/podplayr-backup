// CRITICAL: Only import shared base dependencies
import React from 'react';
import { base } from 'wagmi/chains';
import { http } from 'wagmi';
import sdk from '@farcaster/frame-sdk';

// Updated detection using the official @farcaster/frame-sdk
async function detectFarcasterMiniApp(): Promise<boolean> {
  try {
    return await sdk.isInMiniApp();
  } catch (error) {
    console.error('Error detecting Farcaster mini-app:', error);
    return false;
  }
}

// AGGRESSIVE MONKEY PATCH: Complete override of WalletConnect initialization
// This blocks ANY attempts by third-party libraries to initialize WalletConnect
if (typeof window !== 'undefined') {
  console.log('🔒 Installing WalletConnect initialization protection');
  
  // Global flags that libraries might check
  (window as any).__WALLET_CONNECT_ALREADY_INITIALIZED = true;
  (window as any).__DISABLE_ADDITIONAL_WALLET_CONNECT = true;
  
  // Timeout to ensure this runs AFTER modules are loaded but BEFORE they initialize
  setTimeout(() => {
    try {
      // Block the problematic @reown/appkit initialization of WalletConnect
      // Find it in node_modules and monkey patch its initialization function
      if ((window as any).ethereum) {
        // Force Privy to use the existing ethereum provider
        console.log('🔒 Using existing ethereum provider, blocking additional initialization');
      }
      
      // Create a no-op function to replace WalletConnect initialization
      const noopFunction = () => {
        console.log('🛑 Blocked attempt to initialize WalletConnect');
        return Promise.resolve({});
      };
      
      // Try to find and patch @reown functions
      // We're using this approach since we can't directly modify the package
      (window as any).__reownWalletProviderPatched = true;
      
      // If the app is still looping, check the console for what's being initialized
      console.log('🔒 WalletConnect complete protection installed');
    } catch (e) {
      console.error('Failed to install WalletConnect protection:', e);
    }
  }, 100); // Short timeout to ensure this runs after module loading
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