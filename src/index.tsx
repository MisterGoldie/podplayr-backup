// In development, you might want to keep logs
// In production, filter out noisy logs
if (process.env.NODE_ENV === 'production') {
  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  
  // Filter patterns to ignore
  const ignorePatterns = [
    'NotificationHeader Props',
    'NFT .* liked status',
    // Add other patterns here
  ];
  
  // Replace console.log with filtered version
  console.log = function(...args) {
    const message = args.join(' ');
    const shouldIgnore = ignorePatterns.some(pattern => 
      new RegExp(pattern).test(message)
    );
    
    if (!shouldIgnore) {
      originalConsoleLog.apply(console, args);
    }
  };
  
  // Do the same for console.info if needed
  console.info = function(...args) {
    const message = args.join(' ');
    const shouldIgnore = ignorePatterns.some(pattern => 
      new RegExp(pattern).test(message)
    );
    
    if (!shouldIgnore) {
      originalConsoleInfo.apply(console, args);
    }
  };
} 