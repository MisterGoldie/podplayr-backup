import React, { useEffect, useState } from 'react';
import NotificationHeader from './NotificationHeader';
import { useNFTNotification } from '../context/NFTNotificationContext';

// Enhanced animation for notifications with smoother transitions

interface NFTNotificationProps {
  onReset?: () => void;
  // Remove connection-related props
}

const NFTNotification: React.FC<NFTNotificationProps> = ({ 
  onReset
}) => {
  const { isVisible, hideNotification, notificationType, nftName } = useNFTNotification();
  const [animationKey, setAnimationKey] = useState(0);
  
  // Force re-render of component when notification becomes visible
  // This ensures animation plays every time with no delay
  useEffect(() => {
    if (isVisible) {
      // Immediately increment key to force component re-render with fresh animation
      setAnimationKey(prev => prev + 1);
      
      // Log notification details for debugging
      console.log('🔔 NFTNotification is visible:', { 
        type: notificationType, 
        name: nftName,
        isVisible,
        animationKey
      });
    }
  }, [isVisible, notificationType, nftName]);

  // Determine notification type and message - only when dependencies change
  const notificationProps = React.useMemo(() => {
    if (!notificationType || !isVisible) return null;
    
    // Log once when notification changes
    console.log('🔔 Notification changed:', { notificationType, nftName, isVisible });
    
    // Force logo visibility when notification appears
    // This ensures we can always see the logo after notification disappears
    const allLogos = document.querySelectorAll('.logo-image');
    allLogos.forEach(logo => {
      // Store original state for restoration
      if (!(logo as any)._originalOpacity) {
        (logo as any)._originalOpacity = (logo as HTMLElement).style.opacity;
        (logo as any)._originalVisibility = (logo as HTMLElement).style.visibility;
      }
    });
    
    switch (notificationType) {
      case 'like':
        return {
          type: 'success',
          message: 'Added to library',
          highlightText: nftName ? nftName.replace(/\s*[×Xx]\s*$/, '') : ''
        };
      case 'unlike':
        return {
          type: 'error',
          message: 'Removed from library',
          highlightText: nftName ? nftName.replace(/\s*[×Xx]\s*$/, '') : ''
        };
      // Remove connection case
      default:
        return null;
    }
  }, [notificationType, nftName, isVisible]);

  return (
    <div key={animationKey} className="notification-wrapper">
      {/* Unified notification system */}
      {notificationProps && (
        <NotificationHeader
          show={isVisible}
          onHide={hideNotification}
          type={notificationProps.type as any}
          message={notificationProps.message}
          highlightText={notificationProps.highlightText}
          autoHideDuration={4000} // Remove connection check
          onLogoClick={onReset}
          key={animationKey}
        />
      )}
      <style jsx>{`
        .notification-wrapper {
          position: relative;
          z-index: 9999;
        }
      `}</style>
    </div>
  );
};

export default NFTNotification;
