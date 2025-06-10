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
      
      // Don't log the warning if it's one we want to suppress
      if (!isDialogWarning) {
        originalConsoleError.apply(console, args);
      }
    };
  }
} 