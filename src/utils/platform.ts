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
