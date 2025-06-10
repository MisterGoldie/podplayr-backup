import React, { useState, useEffect } from 'react';
import { useConnection } from '../context/ConnectionContext';

// No props needed since we're using context
interface ConnectionHeaderProps {}

/**
 * A dedicated header component for showing connection notifications
 * This is completely separate from the regular notification system
 * and will stay visible as long as the user is viewing the connected wallet
 */
const ConnectionHeader: React.FC<ConnectionHeaderProps> = () => {
  const { connectionUsername, connectionLikedCount, showConnectionHeader } = useConnection();
  
  // Use separate states for background and content to stagger transitions - EXACTLY like NotificationHeader
  const [isBackgroundVisible, setIsBackgroundVisible] = useState(showConnectionHeader);
  const [isContentVisible, setIsContentVisible] = useState(showConnectionHeader);
  
  // Smooth transition handling with staggered timing - EXACTLY like NotificationHeader
  useEffect(() => {
    if (showConnectionHeader) {
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
  }, [showConnectionHeader]);
  
  // Format the display name with the like count
  const displayName = connectionLikedCount > 0 
    ? `${connectionUsername} (×${connectionLikedCount})` 
    : connectionUsername;
    
  // STRICT VALIDATION: Don't render if ANY condition isn't met
  // This is the critical check that prevents phantom notifications
  if (!showConnectionHeader || !connectionUsername || connectionLikedCount <= 0) {
    // If any of our state is inconsistent, don't show anything
    console.log('🛑 Connection validation failed - not rendering notification');
    return null;
  }
  
  // Extra debug logging to help track the notification state
  console.log(`✅ Rendering connection for ${connectionUsername} with ${connectionLikedCount} likes`);
  
  return (
    <header className={`fixed top-0 left-0 right-0 h-16 flex items-center justify-center z-50 transition-all duration-700 ease-out ${
      isBackgroundVisible ? 'bg-purple-600 border-b border-purple-700' : 'bg-black border-b border-black'
    }`}>
      <div className="relative w-full h-full flex items-center justify-center">
        <div className={`flex items-center justify-center max-w-full px-4 transition-all duration-700 ease-in-out transform ${
          isContentVisible 
            ? 'opacity-100 scale-100' 
            : 'opacity-0 scale-95 pointer-events-none'
        }`}>
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center mr-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="text-white text-lg flex items-center flex-shrink-0 overflow-hidden">
            <span className="flex-shrink-0">Connection with</span>
            <span className="font-semibold ml-2 truncate max-w-[150px]">
              {displayName}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default ConnectionHeader;
