import React, { createContext, useContext, useState, ReactNode } from 'react';
import { NFT } from '../types/user';

type NotificationType = 'like' | 'unlike';

interface NFTNotificationContextType {
  showNotification: (type: NotificationType, nft: NFT) => void;
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

  return (
    <NFTNotificationContext.Provider
      value={{
        showNotification,
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
