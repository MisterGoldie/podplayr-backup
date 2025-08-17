// Utility for platform detection

// Official Farcaster mini-app detection
export async function isFarcasterMiniApp() {
  try {
    // Dynamically import the correct SDK
    const { sdk } = await import('@farcaster/miniapp-sdk');
    return await sdk.isInMiniApp();
  } catch (error) {
    console.warn('Failed to import Farcaster mini-app SDK:', error);
    return false;
  }
}

export function isDesktopWeb(): boolean {
  if (typeof window === 'undefined') return false;
  // Not a Farcaster mini-app and not a mobile device
  return !/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
}

// MiniKit-based environment detection using official Base SDK
export async function detectMiniKitEnvironment(): Promise<{
  environment: 'farcaster' | 'coinbase' | 'web';
  context?: any;
}> {
  try {
    // First check if we're in a MiniKit environment
    const { useMiniKit } = await import('@coinbase/onchainkit/minikit');
    
    // This will only work inside a React component, so we need to handle this differently
    // For now, we'll use a simpler detection method
    if (typeof window !== 'undefined') {
      // Check for MiniKit indicators
      const isMiniKit = !!(window as any).__MINIKIT__ || 
                       !!(window as any).ethereum?.isCoinbaseWallet ||
                       window.parent !== window; // Fixed: removed !! for iframe detection
      
      if (isMiniKit) {
        return { environment: 'coinbase' };
      }
    }
    
    // Fall back to Farcaster detection
    const isFarcaster = await isFarcasterMiniApp();
    if (isFarcaster) {
      return { environment: 'farcaster' };
    }
    
    return { environment: 'web' };
  } catch (error) {
    console.warn('Error detecting MiniKit environment:', error);
    return { environment: 'web' };
  }
}

// Legacy function for backward compatibility
export async function isCoinbaseEnvironment(): Promise<boolean> {
  const result = await detectMiniKitEnvironment();
  return result.environment === 'coinbase';
}

export async function detectMiniAppEnvironment(): Promise<'farcaster' | 'coinbase' | 'web'> {
  const result = await detectMiniKitEnvironment();
  return result.environment;
}
//