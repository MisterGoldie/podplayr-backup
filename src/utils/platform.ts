// Utility for platform detection

// Global indicator that can be forced externally for testing
let _FORCE_FARCASTER_MODE = false;

/**
 * Force the app to run in Farcaster mini-app mode, regardless of actual environment
 * This is useful for debugging and development
 */
export function forceFarcasterMode(force: boolean = true) {
  _FORCE_FARCASTER_MODE = force;
  console.log(`🔧 FORCE FARCASTER MODE SET TO: ${force}`);
  
  // Also set a window flag for persistence across renders
  if (typeof window !== 'undefined') {
    (window as any).FORCE_FARCASTER_MODE = force;
  }
}

/**
 * EXTREMELY aggressive detection for Farcaster mini-app environment
 * This combines multiple heuristics and will err on the side of detecting Farcaster
 */
export function isFarcasterMiniApp() {
  // SSR check
  if (typeof window === 'undefined') return false;
  
  // Development override
  if (_FORCE_FARCASTER_MODE || (window as any).FORCE_FARCASTER_MODE) {
    return true;
  }
  
  // Get important environment variables for logging
  const ua = navigator.userAgent;
  const href = window.location.href;
  const referrer = document.referrer;
  const isIframe = window !== window.parent;
  
  // Log detection attempt only once
  if (!(window as any)._farcasterDetectionLogged) {
    console.log('🔍 FARCASTER DETECTION ATTEMPT:', {
      userAgent: ua,
      url: href,
      referrer: referrer,
      isIframe
    });
    (window as any)._farcasterDetectionLogged = true;
  }
  
  // Check for farcaster-specific globals
  const hasFarcasterContext = !!(window as any)?.farcasterFrameContext;
  const hasFarcasterSDK = !!(window as any)?.FarcasterFramesSDK;
  
  // Check for farcaster/warpcast in user agent
  const hasFarcasterUA = /farcaster|warpcast/i.test(ua);
  
  // Check for iframe and potential farcaster context
  const isFarcasterFrame = isIframe && (
    /farcaster|warpcast/i.test(referrer) ||
    /farcaster|warpcast/i.test(href)
  );
  
  // If URL has special params or hash indicating embedded context
  const hasEmbedParams = /[?&]embedded=true|[?&]context=frame|#frame/.test(href);
  
  // Check for mobile specific webview signals
  const isMobileWebview = /mobile.*webview|wv/.test(ua.toLowerCase());
  
  // Specific checks for iOS and Android Farcaster app WebViews
  const hasIOSWebKit = !!(window as any)?.webkit?.messageHandlers;
  const hasAndroidBridge = !!(window as any)?.FarcasterNativeBridge;
  const hasNativeFarcasterBridge = hasIOSWebKit || hasAndroidBridge;
  
  // Additional WebView hints that may indicate Farcaster app
  const hasMobileFarcasterHints = isMobileWebview && (
    /farcaster|warpcast/i.test(ua) || 
    /farcaster|warpcast/i.test(href) ||
    /farcaster|warpcast/i.test(document.title)
  );
  
  // CRITICAL: Check specifically for direct mini-app launch context (launched via Warpcast)
  // This is a special case that needs explicit handling
  const isDirectMiniAppLaunch = 
    isIframe && 
    (href.includes('ngrok-free.app') || href.includes('warpcast.com')) && 
    (referrer.includes('warpcast.com') || referrer === '');

  // If we're in a direct launch context, we MUST treat this as a Farcaster mini-app
  if (isDirectMiniAppLaunch) {
    console.log('🔥 DETECTED DIRECT MINI-APP LAUNCH CONTEXT - forcing Farcaster mode');
    return true;
  }
  
  // Combine all signals for normal detection
  const result = hasFarcasterContext || hasFarcasterSDK || hasFarcasterUA || 
               isFarcasterFrame || hasEmbedParams || hasNativeFarcasterBridge || hasMobileFarcasterHints;
  
  // Previously forced all ngrok URLs to be Farcaster mode, but that was too aggressive
  // Now we'll only use it as one signal among many, not as an automatic override
  const isNgrokDev = href.includes('ngrok') && process.env.NODE_ENV === 'development';
  
  if (isNgrokDev) {
    // Only log that we detected ngrok, but don't use it as the sole determinant
    console.log('ℹ️ Detected ngrok URL in development, using other signals for Farcaster detection');
  }
  
  // Debug output for the final decision only once
  if (!(window as any)._farcasterResultLogged) {
    console.log('🔎 FARCASTER DETECTION RESULT:', {
      result,
      hasFarcasterContext,
      hasFarcasterSDK,
      hasFarcasterUA,
      isFarcasterFrame,
      hasEmbedParams,
      isMobileWebview,
      hasIOSWebKit,
      hasAndroidBridge,
      hasNativeFarcasterBridge,
      hasMobileFarcasterHints
    });
    (window as any)._farcasterResultLogged = true;
  }
  
  return result;
}

export function isDesktopWeb(): boolean {
  if (typeof window === 'undefined') return false;
  // Not a Farcaster mini-app and not a mobile device
  return !isFarcasterMiniApp() && !/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase());
}
