/**
 * This file suppresses specific console warnings that are not relevant to our application.
 * These warnings come from Next.js development tools and won't appear in production.
 */

export function setupWarningSuppressions() {
  if (typeof window !== 'undefined') {
    // Store the original console.error
    const originalConsoleError = console.error;
    
    // Override console.error to filter out specific warnings
    console.error = function(...args: any[]) {
      // Check if this is a Dialog accessibility warning from Next.js
      const isDialogWarning = args.some(arg => 
        typeof arg === 'string' && (
          arg.includes('`DialogContent` requires a `DialogTitle`') ||
          arg.includes('Missing `Description` or `aria-describedby={undefined}` for {DialogContent}')
        )
      );

      // Check if this is an audio error that we want to handle
      const isAudioError = args.some(arg => 
        typeof arg === 'string' && (
          arg.includes('Audio error:') ||
          arg.includes('NS_ERROR_DOM_INVALID_STATE_ERR') ||
          arg.includes('MediaLoadInvalidURI')
        )
      );

      // Check if this is a Sentry DSN error
      const isSentryDsnError = args.some(arg => 
        typeof arg === 'string' && arg.includes('Invalid Sentry Dsn')
      );

      // Check if this is a Farcaster mini-app warning
      const isFarcasterWarning = args.some(arg => 
        typeof arg === 'string' && arg.includes('App is NOT in Farcaster mini-app')
      );
      
      // Don't log the warning if it's one we want to suppress
      if (!isDialogWarning && !isAudioError && !isSentryDsnError && !isFarcasterWarning) {
        originalConsoleError.apply(console, args);
      } else if (isAudioError) {
        // For audio errors, we want to log them in development but not in production
        if (process.env.NODE_ENV === 'development') {
          originalConsoleError.apply(console, args);
        }
      }
    };
  }
} 