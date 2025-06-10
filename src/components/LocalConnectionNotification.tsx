import React, { useCallback, useEffect, useState, useRef } from 'react';

interface LocalConnectionNotificationProps {
  selectedUser: any;
  nfts: any[];
  isLoadingNFTs: boolean;
  isNFTLiked: (nft: any, skipAnimation?: boolean) => boolean;
  onHide?: () => void;
}

const LocalConnectionNotification: React.FC<LocalConnectionNotificationProps> = ({
  selectedUser,
  nfts,
  isLoadingNFTs,
  isNFTLiked,
  onHide
}) => {
  // Local state for this component only
  const [showNotification, setShowNotification] = useState(false);
  const [username, setUsername] = useState('');
  const [likedCount, setLikedCount] = useState(0);
  
  // Add refs for direct DOM manipulation
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animationInProgress = useRef(false);
  
  // CRITICAL: Reset notification when user or loading state changes
  useEffect(() => {
    console.log('🔴 USER OR LOADING CHANGED - completely resetting notification');
    // Complete reset of all state variables
    setShowNotification(false);
    setUsername('');
    setLikedCount(0);
    setIsBackgroundVisible(false);
    setIsContentVisible(false);
    animationInProgress.current = false;
  }, [selectedUser, isLoadingNFTs]);
  
  // Check for connections only after everything is fully loaded
  useEffect(() => {
    // Safety check - don't proceed unless everything is ready
    if (!selectedUser || !isNFTLiked || isLoadingNFTs || nfts.length === 0) {
      setShowNotification(false);
      return;
    }
    
    console.log(`🔍 Checking for liked NFTs from ${selectedUser.username} now that loading is complete`);
    
    // Count liked NFTs
    let count = 0;
    for (const nft of nfts) {
      if (isNFTLiked(nft, true)) {
        count++;
      }
    }
    
    console.log(`📊 Found ${count} liked NFTs for ${selectedUser.username}`);
    
    // Only show notification if there are liked NFTs
    if (count > 0) {
      console.log(`💜 SHOWING connection for ${selectedUser.username} with ${count} liked NFTs`);
      setUsername(selectedUser.username);
      setLikedCount(count);
      setShowNotification(true);
    } else {
      console.log(`❌ NO connection for ${selectedUser.username} - hiding notification`);
      setShowNotification(false);
    }
  }, [selectedUser, nfts, isNFTLiked, isLoadingNFTs]);
  
  // Use separate states for background and content to stagger transitions - same as NotificationHeader
  const [isBackgroundVisible, setIsBackgroundVisible] = useState(showNotification);
  const [isContentVisible, setIsContentVisible] = useState(showNotification);
  
  // Smoother transition handling with staggered timing - same as NotificationHeader
  useEffect(() => {
    if (showNotification) {
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
  }, [showNotification]);
  
  // Create a properly exposed method that can be called from outside
  const hideWithAnimation = useCallback(() => {
    // Prevent multiple calls during animation
    if (animationInProgress.current) {
      console.log('🔴 Animation already in progress, ignoring call');
      return;
    }

    console.log('🔴 FORCE ANIMATION: Hiding connection notification');
    animationInProgress.current = true;
    
    // 1. Directly manipulate the DOM for guaranteed animation
    if (contentRef.current) {
      // Force a repaint to ensure animation works
      void contentRef.current.offsetHeight;
      
      // Apply styles directly to the DOM
      contentRef.current.style.opacity = '0';
      contentRef.current.style.transform = 'scale(0.95)';
      console.log('🔴 Step 1: Content fade-out animation applied directly to DOM');
    }
    
    // 2. After content fades, animate the header
    setTimeout(() => {
      if (headerRef.current) {
        // Force repaint again
        void headerRef.current.offsetHeight;
        
        // Apply header animation directly
        headerRef.current.style.opacity = '0';
        headerRef.current.style.transform = 'translateY(-20px)';
        console.log('🔴 Step 2: Header fade-out animation applied directly to DOM');
      }
      
      // 3. Finally update React state after animations complete
      setTimeout(() => {
        console.log('🔴 Step 3: Animations complete, updating React state');
        setShowNotification(false);
        setIsContentVisible(false);
        setIsBackgroundVisible(false);
        animationInProgress.current = false;
        
        // Call onHide if provided
        if (onHide) {
          console.log('🔴 Step 4: Calling onHide callback');
          onHide();
        }
      }, 250); // Much shorter to prevent noticeable lag
    }, 150); // Quicker animation while still visible
  }, [onHide]);
  
  // Make hideWithAnimation available to the parent component
  useEffect(() => {
    // Store reference to the method in the DOM so ExploreView can access it
    if (typeof window !== 'undefined') {
      (window as any).__hideConnectionNotification = hideWithAnimation;
      
      // CRITICAL: Add a FORCED animation mode that delays unmounting
      (window as any).__FORCE_CONNECTION_ANIMATION_DELAY = (callback: () => void) => {
        // If there's no notification showing, just call the callback immediately
        if (!showNotification) {
          callback();
          return;
        }
        
        console.log('💥 CRITICAL: FORCING ANIMATION TO COMPLETE before navigation');
        
        // Run the animation only once
        hideWithAnimation();
        
        // Use a much shorter delay that still allows some animation but doesn't feel laggy
        setTimeout(() => {
          console.log('💥 Navigation proceeding with partial animation');
          callback();
        }, 250); // Shorter delay for better responsiveness
      };
    }
    
    // Clean up on unmount
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__hideConnectionNotification;
        delete (window as any).__FORCE_CONNECTION_ANIMATION_DELAY;
      }
    };
  }, [hideWithAnimation, showNotification]);

  // STRICT VALIDATION: Don't render if ANY condition isn't met
  if (!showNotification || !selectedUser || isLoadingNFTs || nfts.length === 0 || likedCount === 0) {
    console.log(`🛑 Not rendering connection notification - validation failed`);
    return null;
  }
  
  // Extra debug logging to help track the notification state
  console.log(`✅ Rendering connection notification for ${username} with ${likedCount} liked NFTs`);

  return (
    <header className={`fixed top-0 left-0 right-0 h-16 flex items-center justify-center z-50 transition-all duration-700 ease-out ${
      isBackgroundVisible ? 'bg-purple-600 border-b border-purple-700' : 'bg-black border-b border-black'
    }`}>
      <div className={`relative w-full h-full flex items-center justify-center transition-all duration-700 ease-in-out transform ${
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
            {username} (×{likedCount})
          </span>
        </div>
      </div>
    </header>
  );
};

export default LocalConnectionNotification;
