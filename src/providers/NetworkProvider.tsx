import React, { createContext, useContext, useState, useEffect } from 'react';

// Network quality types
type NetworkQuality = 'unknown' | 'poor' | 'medium' | 'good';

// Network context interface
interface NetworkContextType {
  quality: NetworkQuality;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  isMobile: boolean;
  isOnline: boolean;
}

// Default network context
const defaultNetworkContext: NetworkContextType = {
  quality: 'unknown',
  effectiveType: 'unknown',
  downlink: 0,
  rtt: 0,
  saveData: false,
  isMobile: false,
  isOnline: true
};

// Create context
const NetworkContext = createContext<NetworkContextType>(defaultNetworkContext);

// Hook to use network context
export const useNetwork = () => useContext(NetworkContext);

// Network provider component
export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [networkState, setNetworkState] = useState<NetworkContextType>(defaultNetworkContext);
  
  useEffect(() => {
    // Function to check if device is mobile
    const checkIfMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    };
    
    // Function to determine network quality based on parameters
    const determineNetworkQuality = (
      effectiveType: string, 
      downlink: number, 
      rtt: number
    ): NetworkQuality => {
      if (effectiveType === 'slow-2g' || effectiveType === '2g' || downlink < 0.5) {
        return 'poor';
      } else if (effectiveType === '3g' || (downlink >= 0.5 && downlink < 2)) {
        return 'medium';
      } else if (effectiveType === '4g' || downlink >= 2) {
        return 'good';
      }
      return 'unknown';
    };
    
    // Function to update network information
    const updateNetworkInfo = () => {
      // @ts-ignore - Modern browsers support the Network Information API
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      
      const newState = {
        effectiveType: connection?.effectiveType || 'unknown',
        downlink: connection?.downlink || 0,
        rtt: connection?.rtt || 0,
        saveData: connection?.saveData || false,
        isMobile: checkIfMobile(),
        isOnline: navigator.onLine,
        quality: 'unknown' as NetworkQuality
      };
      
      // Determine network quality
      newState.quality = determineNetworkQuality(
        newState.effectiveType, 
        newState.downlink, 
        newState.rtt
      );
      
      setNetworkState(newState);
    };
    
    // Update initial state
    updateNetworkInfo();
    
    // Set up event listeners for changes
    window.addEventListener('online', updateNetworkInfo);
    window.addEventListener('offline', updateNetworkInfo);
    
    // Listen for connection changes on supported browsers
    // @ts-ignore
    if (navigator.connection) {
      // @ts-ignore
      navigator.connection.addEventListener('change', updateNetworkInfo);
    }
    
    // Periodic check for network changes (fallback for browsers without events)
    const intervalId = setInterval(updateNetworkInfo, 30000); // Check every 30 seconds
    
    // Cleanup
    return () => {
      window.removeEventListener('online', updateNetworkInfo);
      window.removeEventListener('offline', updateNetworkInfo);
      
      // @ts-ignore
      if (navigator.connection) {
        // @ts-ignore
        navigator.connection.removeEventListener('change', updateNetworkInfo);
      }
      
      clearInterval(intervalId);
    };
  }, []);
  
  return (
    <NetworkContext.Provider value={networkState}>
      {children}
    </NetworkContext.Provider>
  );
};

export default NetworkProvider;
