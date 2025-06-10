'use client';

import { useEffect, useState } from 'react';
// Direct SDK import
import sdk from "@farcaster/frame-sdk";
import type { FrameContext } from '@farcaster/frame-core';

interface FrameProps {
  onContextUpdate?: (context: FrameContext) => void;
}

// No helpers needed - we're loading the SDK script in layout.tsx

// Simple, no-frills Frame component
export const Frame: React.FC<FrameProps> = ({ onContextUpdate }) => {
  const [error, setError] = useState<string | null>(null);

  // Enhanced SDK initialization with retry logic and mobile support
  useEffect(() => {
    async function init() {
      const isFarcaster = await sdk.isInMiniApp();
      console.log('🔄 Frame component mounted, isInMiniApp:', isFarcaster);
      
      // Check if the SDK script is available, inject if not
      const ensureSDKScript = (): Promise<boolean> => {
        return new Promise((resolve) => {
          if (typeof window === 'undefined') {
            resolve(false);
            return;
          }
          
          // More thorough SDK detection - check multiple ways the SDK might be available
          if ((window as any).FarcasterFramesSDK || 
              (window as any).sdk || 
              document.querySelector('script[src*="frames/sdk.js"]')) {
            console.log('✅ Farcaster SDK is available');
            resolve(true);
            return;
          }
          
          // Wait a bit to see if the SDK is just loading
          setTimeout(() => {
            if ((window as any).FarcasterFramesSDK || (window as any).sdk) {
              console.log('✅ Farcaster SDK became available after short delay');
              resolve(true);
              return;
            }
            
            // Script doesn't exist, inject it
            console.log('⚠️ Farcaster SDK script not found, injecting...');
            const script = document.createElement('script');
            script.src = 'https://cdn.farcaster.xyz/frames/sdk.js';
            script.async = false;
            script.onload = () => {
              console.log('✅ Farcaster SDK script injected and loaded');
              resolve(true);
            };
            script.onerror = () => {
              console.error('❌ Failed to inject Farcaster SDK script');
              resolve(false);
            };
            document.head.appendChild(script);
          }, 500); // Allow 500ms for the SDK to load from layout.tsx
        });
      };
      
      // Try to get context with retries
      const getContextWithRetry = async (maxRetries = 3, retryDelay = 1000): Promise<FrameContext | null> => {
        let attempt = 0;
        
        while (attempt < maxRetries) {
          try {
            console.log(`📱 Requesting Farcaster context... (attempt ${attempt + 1}/${maxRetries})`);
            
            // Try to get context with timeout
            const contextPromise = sdk.context;
            const timeoutPromise = new Promise<null>((_, reject) => {
              setTimeout(() => reject(new Error('Context request timed out')), 5000);
            });
            
            const context = await Promise.race([contextPromise, timeoutPromise]) as FrameContext;
            
            if (context) {
              console.log('✅ Got context on attempt', attempt + 1, context);
              return context;
            }
          } catch (err) {
            console.warn(`⚠️ Context request failed (attempt ${attempt + 1}/${maxRetries}):`, err);
          }
          
          // Wait before retry
          if (attempt < maxRetries - 1) {
            console.log(`⏱️ Waiting ${retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay = Math.min(retryDelay * 1.5, 5000); // Exponential backoff up to 5s
          }
          
          attempt++;
        }
        
        return null;
      };
      
      // Try to get context from native bridge (mobile WebView)
      const tryNativeBridge = (): FrameContext | null => {
        try {
          // Try iOS WebKit bridge
          if ((window as any)?.webkit?.messageHandlers) {
            console.log('🍎 Detected iOS WebKit, trying bridge...');
            // This would normally make a native bridge call
            // return iosSpecificBridgeCall();
          }
          
          // Try Android bridge
          if ((window as any)?.FarcasterNativeBridge) {
            console.log('🤖 Detected Android bridge, trying...');
            // This would normally make a native bridge call
            // return androidSpecificBridgeCall();
          }
        } catch (err) {
          console.warn('⚠️ Native bridge attempt failed:', err);
        }
        
        return null;
      };
      
      // Main initialization logic
      const initializeSDK = async () => {
        try {
          // CRITICAL: In mini-app launch mode, send ready immediately to prevent white screen
          // This helps handle the case where the app is launched directly
          const isMiniAppLaunch = window.location.href.includes('firmly-organic-kite.ngrok-free.app') && 
                                window !== window.parent;
          
          if (isMiniAppLaunch) {
            console.log('🚀 Detected direct mini-app launch, sending early ready signal');
            try {
              // Send ready signal immediately to prevent white screen
              sdk.actions?.ready?.();
            } catch (e) {
              console.log('Early ready signal failed, will retry after initialization');
            }
          }
          
          // Ensure SDK script is loaded
          const sdkLoaded = await ensureSDKScript();
          if (!sdkLoaded) {
            throw new Error('Failed to load Farcaster SDK script');
          }
          
          // Try to get context with retries
          let context = await getContextWithRetry();
          
          // If SDK context failed, try native bridge
          if (!context) {
            console.log('🔄 SDK context failed, trying native bridge...');
            context = tryNativeBridge();
          }
          
          // Process context if we got it
          if (context?.user?.fid) {
            console.log(`🧩 Found user FID: ${context.user.fid}`);
            onContextUpdate?.(context);
            
            // Always send ready signal
            try {
              await sdk.actions.ready();
              console.log('✅ SDK ready signal sent');
            } catch (readyErr) {
              console.warn('⚠️ Error sending ready signal:', readyErr);
            }
          } else {
            console.warn('⚠️ No FID in context', context);  
            // Still send ready signal even without FID to ensure screen shows
            try {
              await sdk.actions.ready();
              console.log('✅ SDK ready signal sent without FID');
            } catch (readyErr) {
              console.warn('⚠️ Error sending ready signal:', readyErr);
            }
            setError('No Farcaster user found');
          }
        } catch (err) {
          console.error('❌ Frame SDK error:', err);
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      };
      
      // Start initialization after a short delay
      const timer = setTimeout(initializeSDK, 500);
      
      return () => clearTimeout(timer);
    }
    init();
  }, [onContextUpdate]);

  return null;
};