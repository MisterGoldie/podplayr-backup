import { useState, useEffect } from 'react';

interface DeviceInfo {
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isTablet: boolean;
  isLowPowerDevice: boolean;
  connection: 'slow' | 'medium' | 'fast' | 'unknown';
}

export function useDeviceDetection(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    isMobile: false,
    isIOS: false,
    isAndroid: false,
    isTablet: false,
    isLowPowerDevice: false,
    connection: 'unknown'
  });

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return;

    const userAgent = navigator.userAgent.toLowerCase();
    
    const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isAndroid = /android/i.test(userAgent);
    const isTablet = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)))/.test(userAgent);
    
    // Try to detect low power devices
    // This is a rough estimation - older or budget devices tend to have fewer cores/less memory
    const isLowPowerDevice = isMobile && typeof window.navigator.hardwareConcurrency === 'number' && 
      window.navigator.hardwareConcurrency <= 4;
    
    // Check connection speed if available
    let connection: 'slow' | 'medium' | 'fast' | 'unknown' = 'unknown';
    const nav = navigator as any;
    
    if (nav.connection) {
      const { effectiveType, downlink } = nav.connection;
      
      if (effectiveType === '4g' || downlink > 1.5) {
        connection = 'fast';
      } else if (effectiveType === '3g' || (downlink > 0.5 && downlink <= 1.5)) {
        connection = 'medium';
      } else {
        connection = 'slow';
      }
    }
    
    setDeviceInfo({
      isMobile,
      isIOS,
      isAndroid,
      isTablet,
      isLowPowerDevice,
      connection
    });
    
    // Listen for connection changes if available
    if (nav.connection) {
      const updateConnectionInfo = () => {
        const { effectiveType, downlink } = nav.connection;
        let newConnection: 'slow' | 'medium' | 'fast' | 'unknown' = 'unknown';
        
        if (effectiveType === '4g' || downlink > 1.5) {
          newConnection = 'fast';
        } else if (effectiveType === '3g' || (downlink > 0.5 && downlink <= 1.5)) {
          newConnection = 'medium';
        } else {
          newConnection = 'slow';
        }
        
        setDeviceInfo(prev => ({ ...prev, connection: newConnection }));
      };
      
      nav.connection.addEventListener('change', updateConnectionInfo);
      
      return () => {
        nav.connection.removeEventListener('change', updateConnectionInfo);
      };
    }
  }, []);

  return deviceInfo;
} 