import React, { useState, useRef, useEffect } from 'react';
import { PageState } from '../../types/user';
import { PrivyLoginButton } from '../auth/PrivyLoginButton';
import { usePrivy } from '@privy-io/react-auth';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

interface BottomNavProps {
  currentPage: PageState;
  onNavigate: (page: keyof PageState) => void;
  onReset?: () => void;
  className?: string;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentPage, onNavigate, onReset, className = '' }) => {
  const { authenticated, user } = usePrivy();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  
  // Close menu when clicking outside
  useOnClickOutside(profileMenuRef as React.RefObject<HTMLElement>, () => setShowProfileMenu(false));
  
  // Track double-click on profile button
  const [lastClickTime, setLastClickTime] = useState(0);
  const DOUBLE_CLICK_THRESHOLD = 500; // ms
  
  // Handle profile button click - detect double clicks and navigate
  const handleProfileClick = (e: React.MouseEvent) => {
    // Prevent event bubbling
    e.stopPropagation();
    
    const now = Date.now();
    console.log('👆 Profile button clicked', { currentView: currentPage, isProfilePage: currentPage.isProfile });
    
    if (currentPage.isProfile) {
      // Check if this is a double-click
      if (now - lastClickTime < DOUBLE_CLICK_THRESHOLD) {
        console.log('🔄 Double-click detected, showing login modal');
        // Set timeout to ensure other click events are processed first
        setTimeout(() => {
          setShowProfileMenu(true);
        }, 50);
      }
      setLastClickTime(now);
    } else {
      console.log('📱 Navigating to profile page');
      onNavigate('isProfile');
      setShowProfileMenu(false);
      setLastClickTime(0);
    }
  };
  
  // Close menu when page changes
  useEffect(() => {
    console.log('🔄 Page changed, closing menu if open', { currentPage, wasMenuOpen: showProfileMenu });
    setShowProfileMenu(false);
  }, [currentPage]);
  
  // Debug menu state changes
  useEffect(() => {
    console.log('🔍 Profile menu state changed:', { showProfileMenu, currentPage });
  }, [showProfileMenu, currentPage]);
  
  // Handle login/logout callback
  const handleLoginUpdate = (userData: any) => {
    console.log('Login status updated:', userData ? 'Logged in' : 'Logged out');
    
    // If userData is null, it means user has logged out - close the modal
    if (userData === null) {
      console.log('User logged out, closing modal');
      setShowProfileMenu(false);
    }
    
    // Always reset the app state when needed
    if (onReset) onReset();
  };
  
  return (
    <nav className={`fixed bottom-0 left-0 right-0 h-20 pb-4 bg-black border-t border-purple-400/30 flex items-center justify-around z-50 ${className}`}>
      <button
        onClick={() => onNavigate('isHome')}
        className={`flex flex-col items-center justify-center w-16 h-16 ${
          currentPage.isHome ? 'text-purple-400' : 'text-gray-400'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
        <span className="text-xs mt-1">Home</span>
      </button>

      <button
        onClick={() => onNavigate('isExplore')}
        className={`flex flex-col items-center justify-center w-16 h-16 ${
          currentPage.isExplore ? 'text-purple-400' : 'text-gray-400'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <span className="text-xs mt-1">Explore</span>
      </button>

      <button
        onClick={() => onNavigate('isLibrary')}
        className={`flex flex-col items-center justify-center w-16 h-16 ${
          currentPage.isLibrary ? 'text-purple-400' : 'text-gray-400'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
        <span className="text-xs mt-1">Library</span>
      </button>

      <div className="relative">
        <button
          onClick={handleProfileClick}
          className={`flex flex-col items-center justify-center w-16 h-16 ${
            currentPage.isProfile ? 'text-purple-400' : 'text-gray-400'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span className="text-xs mt-1">Profile</span>
        </button>
        
        {/* Modal Login Overlay */}
        {(() => { console.log('🧩 Rendering check for menu:', { showProfileMenu, currentPage, shouldShow: showProfileMenu && currentPage.isProfile }); return null; })()}
        {showProfileMenu && currentPage.isProfile && (
          <div 
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
            onClick={(e: React.MouseEvent) => {
              // Ensure this event doesn't overlap with button clicks
              if (e.target === e.currentTarget) {
                setShowProfileMenu(false);
              }
            }}
          >
            <div 
              ref={profileMenuRef}
              className="bg-gray-900 rounded-lg shadow-2xl overflow-hidden border border-purple-400/30 w-80 max-w-sm animate-fadeIn" 
              onClick={(e) => {
                // Prevent any click events from propagating through this container
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <div className="p-6 text-center">
                <h3 className="text-xl font-bold text-white mb-4">
                  {authenticated ? 'Profile Account' : 'Sign In'}
                </h3>
                
                {authenticated && user ? (
                  <div className="text-white mb-4">
                    <p className="opacity-70 mb-1">Signed in as:</p>
                    <p className="font-semibold text-lg">
                      {(() => {
                        // Safely extract user identifier
                        if (typeof user.email === 'string') return user.email;
                        if (user.google?.email && typeof user.google.email === 'string') return user.google.email;
                        
                        // For Farcaster users, prioritize display name or username
                        if (user.farcaster) {
                          if (user.farcaster.username) return user.farcaster.username;
                          if (user.farcaster.displayName) return user.farcaster.displayName;
                          if (user.farcaster.fid) return `Farcaster #${user.farcaster.fid}`;
                        }
                        if (user.wallet?.address) return `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`;
                        return 'User';
                      })()}
                    </p>
                  </div>
                ) : (
                  <div className="text-white mb-4">
                    <p>Sign in to access your profile</p>
                  </div>
                )}
                
                <div className="mt-6">
                  <PrivyLoginButton 
                    onLogin={handleLoginUpdate}
                    customButtonClass="w-full bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
                    customButtonText={authenticated ? "Sign Out" : "Sign In with Privy"}
                  />
                </div>
                
                <button
                  onClick={() => setShowProfileMenu(false)}
                  className="mt-4 text-purple-400 hover:text-purple-300 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};