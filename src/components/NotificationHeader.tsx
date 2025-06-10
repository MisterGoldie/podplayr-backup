import React, { useState, useEffect, memo } from 'react';
import Image from 'next/image';

type NotificationType = 'success' | 'info' | 'warning' | 'error' | 'connection' | 'profile';

interface NotificationHeaderProps {
  show: boolean;
  onHide?: () => void;
  type?: NotificationType;
  message: string;
  highlightText?: string;
  autoHideDuration?: number;
  icon?: React.ReactNode;
  logo?: string;
  onReset?: () => void;
  onLogoClick?: () => void; // New prop for logo click to go home
}

// Use memo to prevent unnecessary re-renders
const NotificationHeader: React.FC<NotificationHeaderProps> = memo(({
  show,
  onHide,
  type = 'info',
  message,
  highlightText,
  autoHideDuration = 3000,
  icon,
  logo = '/fontlogo.png',
  onReset,
  onLogoClick, // Add the new prop
}) => {
  // Remove console.log in production
  if (process.env.NODE_ENV !== 'production') {
    // Only log when props actually change
    React.useEffect(() => {
      console.log('NotificationHeader Props:', { show, type, message, highlightText });
    }, [show, type, message, highlightText]);
  }
  
  // Use separate states for background and content to stagger transitions
  const [isBackgroundVisible, setIsBackgroundVisible] = useState(show);
  const [isContentVisible, setIsContentVisible] = useState(show);
  
  // Smoother transition handling with staggered timing
  useEffect(() => {
    if (show) {
      // When showing, change background first, then content
      setIsBackgroundVisible(true);
      const timer = setTimeout(() => setIsContentVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      // When hiding, change content first, then background
      setIsContentVisible(false);
      const timer = setTimeout(() => setIsBackgroundVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [show]);
  
  // Auto-hide functionality
  useEffect(() => {
    if (show && autoHideDuration && autoHideDuration > 0) {
      const timer = setTimeout(() => {
        if (onHide) onHide();
      }, autoHideDuration);
      
      return () => clearTimeout(timer);
    }
  }, [show, autoHideDuration, onHide]);
  
  // Get appropriate styles for different notification types
  const getStyles = () => {
    switch(type) {
      case 'success':
        return 'bg-green-600 border-b border-green-700';
      case 'warning':
        return 'bg-yellow-600 border-b border-yellow-700';
      case 'error':
        return 'bg-red-600 border-b border-red-700';
      case 'connection':
        return 'bg-purple-600 border-b border-purple-700';
      case 'profile':
        return 'bg-orange-500 border-b border-orange-600';
      default:
        return 'bg-blue-600 border-b border-blue-700';
    }
  };
  
  // Get default icon if none provided
  const getDefaultIcon = () => {
    switch(type) {
      case 'success':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'error':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'connection':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
          </svg>
        );
      case 'profile':
        // No icon for profile notifications
        return null;
      default:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  // Force logo visible when notification is hidden, but don't interfere with animations
  useEffect(() => {
    if (!show) {
      // Wait for animations to complete before forcing logo visibility
      const timer = setTimeout(() => {
        console.log('🟢 FORCING LOGO VISIBLE IN NOTIFICATION HEADER');
        
        // Find ALL logo images in this component and force them to be visible
        const logoImages = document.querySelectorAll('.logo-image');
        logoImages.forEach(logo => {
          (logo as HTMLElement).style.opacity = '1';
          (logo as HTMLElement).style.visibility = 'visible';
          (logo as HTMLElement).style.display = 'block';
        });
      }, 700); // Match the animation duration
      
      return () => clearTimeout(timer);
    }
  }, [show]);
  
  return (
    <header 
      className={`fixed top-0 left-0 right-0 h-16 flex items-center justify-center z-50 transition-all duration-700 ease-out ${
        isBackgroundVisible ? getStyles() : 'bg-black border-b border-black'
      }`}
    >
      {/* Container for both logo and notification */}
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Logo container - always centered */}
        <button 
          onClick={onLogoClick || onReset} 
          className="cursor-pointer absolute inset-0 flex items-center justify-center"
          style={{ 
            opacity: show ? 0 : 1,
            visibility: show ? 'hidden' : 'visible',
            transition: 'opacity 0.3s ease-out, visibility 0.3s ease-out',
            zIndex: 10
          }}
        >
          <Image
            src={logo}
            alt="PODPlayr Logo"
            width={120}
            height={30}
            className="logo-image"
            priority={true}
          />
        </button>
        
        {/* Notification content - UPDATED */}
        {show && (
          <div 
            className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ease-in-out transform ${
              isContentVisible 
                ? 'opacity-100 scale-100' 
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
            style={{ willChange: 'transform, opacity' }}
          >
            {/* Fixed-width container to ensure consistent layout */}
            <div className="w-full max-w-md flex items-center justify-center px-4">
              {(icon || getDefaultIcon()) && (
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                  {icon || getDefaultIcon()}
                </div>
              )}
              <div className="text-white text-lg flex items-center overflow-hidden">
                <span className="flex-shrink-0 whitespace-nowrap">{message}</span>
                {highlightText && (
                  <span className="font-semibold ml-2 truncate">
                    {highlightText}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
});

export default NotificationHeader; 