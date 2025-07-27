import React, { createContext, useContext, useState, ReactNode } from 'react';
import { NFT } from '../types/user';

// Update the NotificationType to remove 'connection'
type NotificationType = 'like' | 'unlike';

interface NFTNotificationContextType {
  showNotification: (type: NotificationType, nft: NFT) => void;
  // Remove this line:
  // showConnectionNotification: (username: string, likedCount?: number) => void;
  hideNotification: () => void;
  isVisible: boolean;
  notificationType: NotificationType | null;
  nftName: string;
}

const NFTNotificationContext = createContext<NFTNotificationContextType | undefined>(undefined);

export const useNFTNotification = () => {
  const context = useContext(NFTNotificationContext);
  if (!context) {
    throw new Error('useNFTNotification must be used within an NFTNotificationProvider');
  }
  return context;
};

interface NFTNotificationProviderProps {
  children: ReactNode;
}

export const NFTNotificationProvider: React.FC<NFTNotificationProviderProps> = ({ children }) => {
  // Initialize with explicitly false visibility and null type to prevent showing on startup
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [notificationType, setNotificationType] = useState<NotificationType | null>(null);
  const [nftName, setNftName] = useState<string>('');
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const showNotification = (type: NotificationType, nft: NFT) => {
    console.log('🔔 Showing notification:', { type, nftName: nft.name });
    
    // Clear any existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }

    // Set notification data
    setNotificationType(type);
    setNftName(nft.name || 'NFT');
    
    // Show notification immediately
    setIsVisible(true);
    console.log('🚨🚨 NOTIFICATION VISIBLE NOW:', { type, name: nft.name });
  };
  
  // New function to show connection notifications with optional liked count
  const showConnectionNotification = (username: string, likedCount?: number) => {
    const displayName = likedCount ? `${username} (×${likedCount})` : username;
    console.log('💜 Showing CONNECTION notification for:', displayName);
    
    // Clear any existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }

    // Set notification data
    setNotificationType(null); // Reset notification type since 'connection' is no longer a valid type
    setNftName(displayName); // Use the formatted username as the highlight text
    
    // Show notification immediately
    setIsVisible(true);
    console.log('🚨🚨 CONNECTION NOTIFICATION VISIBLE NOW for:', displayName);

    // DO NOT auto-hide connection notifications
    // They will stay visible until the user navigates away
    // or explicitly hides them by clicking back
    console.log('💜 Connection notification will stay visible until user navigates away');
  };

  const hideNotification = () => {
    setIsVisible(false);
    
    // Ensure the logo is visible after any notification is hidden
    setTimeout(() => {
      const logoElement = document.querySelector('.logo-image');
      if (logoElement) {
        // Force the logo to be visible
        (logoElement as HTMLElement).style.opacity = '1';
        (logoElement as HTMLElement).style.visibility = 'visible';
      }
    }, 700); // Wait for animation to finish
  };

  // Remove the entire showConnectionNotification function (lines ~50-75)

  return (
    <NFTNotificationContext.Provider
      value={{
        showNotification,
        // Remove this line:
        // showConnectionNotification,
        hideNotification,
        isVisible,
        notificationType,
        nftName
      }}
    >
      {children}
    </NFTNotificationContext.Provider>
  );
};
