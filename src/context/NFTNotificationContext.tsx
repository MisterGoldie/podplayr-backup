import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { NFT } from '../types/user';

export type HeaderBannerType = 'success' | 'info' | 'warning' | 'error';
export type NFTNotificationAction = 'like' | 'unlike';

interface NFTNotificationContextType {
  showNotification: (type: NFTNotificationAction, nft: NFT) => void;
  showBanner: (type: HeaderBannerType, message: string, highlightText?: string) => void;
  hideNotification: () => void;
  isVisible: boolean;
  bannerId: number;
  bannerType: HeaderBannerType;
  message: string;
  highlightText: string;
}

const NFTNotificationContext = createContext<NFTNotificationContextType | undefined>(undefined);

export const useNFTNotification = () => {
  const context = useContext(NFTNotificationContext);
  if (!context) {
    throw new Error('useNFTNotification must be used within an NFTNotificationProvider');
  }
  return context;
};

const ACTION_BANNER: Record<NFTNotificationAction, { type: HeaderBannerType; message: string }> = {
  like: { type: 'success', message: 'Added to library' },
  unlike: { type: 'error', message: 'Removed from library' },
};

function cleanNftName(name?: string) {
  return name ? name.replace(/\s*[×Xx]\s*$/, '') : '';
}

interface NFTNotificationProviderProps {
  children: ReactNode;
}

export const NFTNotificationProvider: React.FC<NFTNotificationProviderProps> = ({ children }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [bannerId, setBannerId] = useState(0);
  const [bannerType, setBannerType] = useState<HeaderBannerType>('info');
  const [message, setMessage] = useState('');
  const [highlightText, setHighlightText] = useState('');

  const revealBanner = useCallback((type: HeaderBannerType, nextMessage: string, nextHighlight = '') => {
    setBannerType(type);
    setMessage(nextMessage);
    setHighlightText(nextHighlight);
    setBannerId((id) => id + 1);
    setIsVisible(true);
  }, []);

  const showNotification = useCallback((type: NFTNotificationAction, nft: NFT) => {
    const banner = ACTION_BANNER[type];
    revealBanner(banner.type, banner.message, cleanNftName(nft.name) || 'NFT');
  }, [revealBanner]);

  const showBanner = useCallback((type: HeaderBannerType, nextMessage: string, nextHighlight = '') => {
    revealBanner(type, nextMessage, nextHighlight);
  }, [revealBanner]);

  const hideNotification = useCallback(() => {
    setIsVisible(false);
  }, []);

  const value = useMemo(() => ({
    showNotification,
    showBanner,
    hideNotification,
    isVisible,
    bannerId,
    bannerType,
    message,
    highlightText,
  }), [showNotification, showBanner, hideNotification, isVisible, bannerId, bannerType, message, highlightText]);

  return (
    <NFTNotificationContext.Provider value={value}>
      {children}
    </NFTNotificationContext.Provider>
  );
};
