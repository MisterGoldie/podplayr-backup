import React from 'react';
import { PrivyProvider, usePrivy, WalletListEntry } from '@privy-io/react-auth';
// Don't import from wagmi directly when using with Privy
// import { useAccount, useConnect } from 'wagmi';

// Utility to detect Farcaster mini-app with much more aggressive detection
export function isFarcasterMiniApp() {
  if (typeof window === 'undefined') return false;
  
  // Log the user agent once for debugging
  const userAgent = navigator.userAgent;
  if (!(window as any).hasLoggedUserAgent) {
    console.log('USER AGENT:', userAgent);
    (window as any).hasLoggedUserAgent = true;
  }
  
  // Multi-pronged approach to detect Farcaster mini-app environment
  const hasFrameContext = !!(window as any)?.farcasterFrameContext;
  const hasFrameInUA = userAgent.includes('FarcasterFrame') || userAgent.includes('Farcaster');
  const hasWarpcastInUA = userAgent.includes('Warpcast');
  const hasMobileAppSignature = userAgent.includes('Mobile') && (userAgent.includes('wv') || userAgent.includes('WebView'));
  
  // If we're inside an iframe, check parent URL for farcaster.xyz, warpcast.com
  const isInIframe = window !== window.parent;
  const frameCheck = isInIframe && (
    document.referrer.includes('farcaster') || 
    document.referrer.includes('warpcast')
  );
  
  // Forced override for testing (remove in production)
  const forceDetect = (window as any)?.FORCE_FARCASTER_DETECTION === true;
  
  const result = hasFrameContext || hasFrameInUA || hasWarpcastInUA || frameCheck || forceDetect;
  
  // Log diagnostics on first run
  if (!(window as any).hasLoggedFrameDetection) {
    console.log('FARCASTER DETECTION:', {
      result,
      hasFrameContext,
      hasFrameInUA,
      hasWarpcastInUA,
      hasMobileAppSignature,
      isInIframe,
      frameCheck,
      referrer: document.referrer,
      forceDetect
    });
    (window as any).hasLoggedFrameDetection = true;
  }
  
  return result;
}

// The Privy Login Button, only renders if not in Farcaster mini-app
export const PrivyLoginButton: React.FC<{ 
  onLogin?: (user: any) => void;
  customButtonClass?: string;
  customButtonText?: string;
  onFarcasterLogin?: (fid: number) => void; // Add callback for Farcaster login
}> = ({ 
  onLogin, 
  customButtonClass, 
  customButtonText,
  onFarcasterLogin
}) => {
  // Use standard Privy hooks as documented
  const { login, ready, authenticated, user, logout } = usePrivy();
  
  // Track if we've already handled this authentication to prevent loops
  const [authHandled, setAuthHandled] = React.useState(false);
  
  // Use a ref to track the login callback to prevent re-renders
  const onLoginRef = React.useRef(onLogin);
  React.useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);
  
  // Handle login success with a more aggressive loop prevention
  React.useEffect(() => {
    // Only trigger on initial auth, then lock it down completely
    if (authenticated && user && !authHandled) {
      console.log('Privy login successful');
      // Lock this down to prevent ANY possibility of re-firing
      setAuthHandled(true);
      
      // Check for Farcaster account in linked accounts
      const farcasterAccounts = user.linkedAccounts?.filter(account => 
        account.type === 'farcaster'
      );
      
      // If Farcaster accounts are available, extract FID
      if (farcasterAccounts && farcasterAccounts.length > 0) {
        const farcasterAccount = farcasterAccounts[0] as any;
        if (farcasterAccount.fid && typeof farcasterAccount.fid === 'number') {
          console.log('🌟 Farcaster login detected via Privy with FID:', farcasterAccount.fid);
          // Call onFarcasterLogin if provided
          if (onFarcasterLogin) {
            onFarcasterLogin(farcasterAccount.fid);
          }
        }
      }
      
      // CRITICAL: Use setTimeout to break the React rendering cycle completely
      // This prevents potential state updates from cascading during the current render
      setTimeout(() => {
        if (onLoginRef.current) {
          // Only call once, with extreme caution to prevent loops
          const callback = onLoginRef.current;
          // Clear the ref immediately to prevent any chance of repeat calls
          onLoginRef.current = undefined;
          // Call with the user info
          callback(user);
        }
      }, 100); // Increased timeout to ensure state updates have time to process
    }
  }, [authenticated, user, authHandled, onFarcasterLogin]);

  // Don't show button in Farcaster mini-app
  if (isFarcasterMiniApp()) return null;
  
  // If authenticated, show logout button instead
  if (authenticated) {
    return (
      <button 
        onClick={() => {
          console.log('Privy logout button clicked!');
          try {
            // Use Privy's built-in logout method
            // This will handle the logout process properly without full page reload
            if (typeof logout === 'function') {
              logout();
              console.log('Privy logout initiated');
              
              // If there's an onLogin callback, we can use it to update the UI state
              if (onLoginRef.current) {
                // Call with null to indicate logout
                setTimeout(() => {
                  if (onLoginRef.current) {
                    onLoginRef.current(null);
                  }
                }, 100);
              }
            }
          } catch (error) {
            console.error('Error during Privy logout:', error);
          }
        }}
        className={customButtonClass || "bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full transition-colors duration-200 flex items-center justify-center gap-2"}
      >
        {!customButtonText && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" fill="currentColor"/>
          </svg>
        )}
        {customButtonText || "Log out"}
      </button>
    );
  }

  return (
    <button 
      onClick={() => {
        console.log('Privy login button clicked!');
        try {
          // Use Privy login which will handle wallet connection
          login();
        } catch (error) {
          console.error('Error during Privy login:', error);
        }
      }} 
      disabled={!ready}
      className={customButtonClass || "bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full transition-colors duration-200 flex items-center justify-center gap-2"}
    >
      {!customButtonText && (
        <>
          {/* Farcaster icon */}
          <svg width="20" height="20" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M250 50C138.97 50 50 138.97 50 250C50 361.03 138.97 450 250 450C361.03 450 450 361.03 450 250C450 138.97 361.03 50 250 50ZM250 83.33C342.75 83.33 416.67 157.25 416.67 250C416.67 342.75 342.75 416.67 250 416.67C157.25 416.67 83.33 342.75 83.33 250C83.33 157.25 157.25 83.33 250 83.33ZM145.83 175C145.83 154.29 162.79 137.5 183.33 137.5C203.88 137.5 220.83 154.29 220.83 175C220.83 195.71 203.88 212.5 183.33 212.5C162.79 212.5 145.83 195.71 145.83 175ZM279.17 175C279.17 154.29 296.12 137.5 316.67 137.5C337.21 137.5 354.17 154.29 354.17 175C354.17 195.71 337.21 212.5 316.67 212.5C296.12 212.5 279.17 195.71 279.17 175ZM354.17 341.67H146.08C146.08 262.25 191.29 225 250.12 225C308.96 225 354.17 262.25 354.17 341.67Z" fill="currentColor"/>
          </svg>
        </>
      )}
      {customButtonText || "Log in with Farcaster"}
    </button>
  );
};

// PrivyProvider wrapper for context
// Use React.memo to prevent unnecessary re-renders of the provider
// Use an even more aggressive memoization approach
export const PrivyAuthProvider: React.FC<{ 
  children: React.ReactNode;
  onFarcasterLogin?: (fid: number) => void;
}> = React.memo(({ children, onFarcasterLogin }) => {
  // Skip rendering Privy in Farcaster mini-app
  if (isFarcasterMiniApp()) return <>{children}</>;
  
  // Use a fallback empty string if the environment variable is undefined
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
  console.log('PrivyAppId used for PrivyProvider:', privyAppId);
  console.log('Current environment:', process.env.NODE_ENV);
  console.log('Current URL:', typeof window !== 'undefined' ? window.location.href : 'Server-side rendering');
  
  // Log and check if we should bypass origin restrictions in development
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 Using DEVELOPMENT MODE for Privy - bypassing origin restrictions');
  }
  
  // Verify that we have a valid Privy app ID
  if (!privyAppId) {
    console.error('❌ ERROR: No Privy App ID found! Check your .env.local file');
    return <div className="text-red-500 p-4">Error: Missing Privy App ID. Check .env.local</div>;
  }
  
  // Memoize the Privy config with a stable reference that won't change
  // Using a ref ensures the config object maintains reference equality
  const privyConfigRef = React.useRef({
    // CRITICAL: Put farcaster FIRST to prioritize it in the login UI
    loginMethods: ['farcaster', 'wallet', 'email'] as ('farcaster' | 'wallet' | 'email')[],
    // Override default scope for farcaster to include more permissions
    farcaster: {
      // Active Farcaster login configuration to enhance visibility and functionality
      requireWarpcastRecovery: true,
      // These scopes allow for the most functionality
      scopes: ['email', 'storage_write', 'fid', 'cast', 'publishData', 'linkFarcaster'],
    },
    appearance: {
      theme: 'dark' as const,
      accentColor: '#8b5cf6' as `#${string}`,
      walletList: ['metamask', 'coinbase_wallet', 'rainbow'] as WalletListEntry[],
      // Add PODPlayr logo to the Privy login screen
      logo: '/privylogo.png',
      // Customize text on the login screen
      showWalletLoginFirst: false, // Set to false to prioritize Farcaster
      // Set the text that appears at the top of the login modal
      logoText: 'PODPlayr',
      // Customize the modal to highlight Farcaster login
      modal: {
        // These settings will make Farcaster more prominent
        welcomeMessage: 'Connect to PODPlayr with Farcaster',
        // Hide email verification if possible to streamline Farcaster login
        emailVerification: {
          hideEmailVerification: true,
        },
      }
    }
  });
  
  // Never recreate this object, ever
  const privyConfig = privyConfigRef.current;
  
  // Add callback for login events to handle Farcaster logins
  const handleLogin = React.useCallback((user: any) => {
    console.log('Privy login event detected:', user);
    if (!user) return;
    
    // Check if this was a Farcaster login
    try {
      const farcasterAccounts = user.linkedAccounts?.filter((account: any) => 
        account.type === 'farcaster'
      );
      
      if (farcasterAccounts && farcasterAccounts.length > 0) {
        const farcasterAccount = farcasterAccounts[0] as any;
        if (farcasterAccount.fid && typeof farcasterAccount.fid === 'number') {
          console.log('🔥 FARCASTER LOGIN SUCCESS:', farcasterAccount.fid);
          // Call the callback to handle the Farcaster login
          if (onFarcasterLogin) {
            onFarcasterLogin(farcasterAccount.fid);
          }
        }
      }
    } catch (error) {
      console.error('Error processing Farcaster login:', error);
    }
  }, [onFarcasterLogin]);
  
  return (
    <PrivyProvider
      appId={privyAppId}
      config={privyConfig}
    >
      {/* Add a Privy event listener to handle login success */}
      <PrivyEventHandler onLoginCallback={handleLogin}>
        {/* Rest of the application */}
        {/* Wrap children with a component that can access Privy context and extract Farcaster FID */}
        <PrivyFarcasterExtractor onFarcasterLogin={onFarcasterLogin}>
          {children}
        </PrivyFarcasterExtractor>
      </PrivyEventHandler>
    </PrivyProvider>
  );
});  // End of PrivyAuthProvider


// Helper component to extract Farcaster FID from Privy context
// Helper component to extract Farcaster FID from Privy context
const PrivyFarcasterExtractor = React.memo(({ children, onFarcasterLogin }: {
  children: React.ReactNode;
  onFarcasterLogin?: (fid: number) => void;
}) => {
  const { authenticated, user } = usePrivy();
  const processedRef = React.useRef(false);
  
  // Extract Farcaster FID when user authenticates
  React.useEffect(() => {
    if (authenticated && user && !processedRef.current && onFarcasterLogin) {
      try {
        // Check for Farcaster account in linked accounts
        const farcasterAccounts = user.linkedAccounts?.filter(account => 
          account.type === 'farcaster'
        );
        
        // If Farcaster accounts are available, extract FID
        if (farcasterAccounts && farcasterAccounts.length > 0) {
          const farcasterAccount = farcasterAccounts[0] as any;
          if (farcasterAccount.fid && typeof farcasterAccount.fid === 'number') {
            console.log('🔄 Farcaster login detected in PrivyFarcasterExtractor with FID:', farcasterAccount.fid);
            // Mark as processed to prevent duplicate calls
            processedRef.current = true;
            // Call onFarcasterLogin with the FID
            onFarcasterLogin(farcasterAccount.fid);
          }
        }
      } catch (error) {
        console.error('Error extracting Farcaster FID from Privy user:', error);
      }
    }
  }, [authenticated, user, onFarcasterLogin]);
  
  return <>{children}</>;
});

// Helper component to handle Privy auth events
const PrivyEventHandler = React.memo(({ children, onLoginCallback }: {
  children: React.ReactNode;
  onLoginCallback?: (user: any) => void;
}) => {
  const { authenticated, user } = usePrivy();
  const handledRef = React.useRef(false);
  
  // Handle Privy login event
  React.useEffect(() => {
    if (authenticated && user && !handledRef.current && onLoginCallback) {
      console.log('🔥 Privy auth event detected in event handler');
      onLoginCallback(user);
      handledRef.current = true;
    }
  }, [authenticated, user, onLoginCallback]);
  
  return <>{children}</>;
});

// Add display names for debugging
PrivyAuthProvider.displayName = 'PrivyAuthProvider';
PrivyFarcasterExtractor.displayName = 'PrivyFarcasterExtractor';
PrivyEventHandler.displayName = 'PrivyEventHandler';
