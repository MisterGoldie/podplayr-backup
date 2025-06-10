// Utility for platform detection

import sdk from '@farcaster/frame-sdk';

// Official Farcaster mini-app detection
export async function isFarcasterMiniApp() {
  return await sdk.isInMiniApp();
}

export function isDesktopWeb(): boolean {
  if (typeof window === 'undefined') return false;
  // Not a Farcaster mini-app and not a mobile device
  return !isFarcasterMiniApp() && !/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
}
