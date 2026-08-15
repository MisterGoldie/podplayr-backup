'use client';

import React from 'react';
import NotificationHeader from './NotificationHeader';
import { useNFTNotification } from '../context/NFTNotificationContext';

interface NFTNotificationProps {
  onLogoClick?: () => void;
}

const NFTNotification: React.FC<NFTNotificationProps> = ({ onLogoClick }) => {
  const {
    isVisible,
    hideNotification,
    bannerId,
    bannerType,
    message,
    highlightText,
  } = useNFTNotification();

  return (
    <NotificationHeader
      key={bannerId}
      show={isVisible}
      onHide={hideNotification}
      type={bannerType}
      message={message}
      highlightText={highlightText}
      autoHideDuration={4000}
      onLogoClick={onLogoClick}
    />
  );
};

export default NFTNotification;
