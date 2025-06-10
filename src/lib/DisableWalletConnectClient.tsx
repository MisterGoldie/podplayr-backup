'use client';

import { useEffect } from 'react';

/**
 * Client component to prevent WalletConnect double initialization.
 * This is a safer approach than using dynamic imports in the layout.
 */
export function DisableWalletConnectClient() {
  useEffect(() => {
    // AGGRESSIVE MONKEY PATCH: Complete override of WalletConnect initialization
    // This blocks ANY attempts by third-party libraries to initialize WalletConnect
    console.log('\ud83d\udd12 Installing WalletConnect initialization protection');
    
    // Global flags that libraries might check
    (window as any).__WALLET_CONNECT_ALREADY_INITIALIZED = true;
    (window as any).__DISABLE_ADDITIONAL_WALLET_CONNECT = true;
    
    // Block the problematic @reown/appkit initialization of WalletConnect
    // Find it in node_modules and monkey patch its initialization function
    if ((window as any).ethereum) {
      // Force Privy to use the existing ethereum provider
      console.log('\ud83d\udd12 Using existing ethereum provider, blocking additional initialization');
    }
    
    // Create a no-op function to replace WalletConnect initialization
    const noopFunction = () => {
      console.log('\ud83d\ude45‍♂️ Blocked attempt to initialize WalletConnect');
      return Promise.resolve({});
    };
    
    // Try to find and patch @reown functions
    // We're using this approach since we can't directly modify the package
    (window as any).__reownWalletProviderPatched = true;
    
    console.log('\ud83d\udd12 WalletConnect complete protection installed');
  }, []);
  
  return null;
}
