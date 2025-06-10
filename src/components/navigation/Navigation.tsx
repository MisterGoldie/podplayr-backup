import React, { useState, useRef, useEffect } from 'react';
import { PrivyLoginButton } from '../auth/PrivyLoginButton';
import { usePrivy } from '@privy-io/react-auth';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

type View = 'home' | 'explore' | 'library' | 'profile';

interface NavigationProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentView, onViewChange }) => {
  const { authenticated, user } = usePrivy();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  
  // Close menu when clicking outside
  useOnClickOutside(profileMenuRef as React.RefObject<HTMLElement>, () => setShowProfileMenu(false));
  
  // Handle profile button click - toggle menu or navigate
  const handleProfileClick = () => {
    console.log('👆 Profile button clicked', { currentView, isProfilePage: currentView === 'profile' });
    if (currentView === 'profile') {
      console.log('🔄 Toggling profile menu', { current: showProfileMenu, next: !showProfileMenu });
      setShowProfileMenu(prev => !prev);
    } else {
      console.log('📱 Navigating to profile page');
      onViewChange('profile');
      setShowProfileMenu(false);
    }
  };
  
  // Close menu when view changes
  useEffect(() => {
    console.log('🔄 View changed, closing menu if open', { currentView, wasMenuOpen: showProfileMenu });
    setShowProfileMenu(false);
  }, [currentView]);
  
  // Debug menu state changes
  useEffect(() => {
    console.log('🔍 Profile menu state changed:', { showProfileMenu, currentView });
  }, [showProfileMenu, currentView]);
  
  // Handle login callback
  const handleLoginUpdate = (userData: any) => {
    console.log('Login status updated:', userData ? 'Logged in' : 'Logged out');
    setShowProfileMenu(false);
  };
  
  return (
    <nav className="flex items-center justify-around p-4 bg-black border-t border-green-400/30 relative">
      <button
        onClick={() => onViewChange('home')}
        className={`flex flex-col items-center p-2 ${
          currentView === 'home' ? 'text-green-400' : 'text-gray-400'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
          <path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"/>
        </svg>
        <span className="text-sm mt-1">Home</span>
      </button>

      <button
        onClick={() => onViewChange('explore')}
        className={`flex flex-col items-center p-2 ${
          currentView === 'explore' ? 'text-green-400' : 'text-gray-400'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
          <path d="M784-160 532-412q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-620q0-109 75.5-184.5T380-880q109 0 184.5 75.5T640-620q0 44-14 83t-38 69l252 252-56 56ZM380-400q92 0 156-64t64-156q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 92 64 156t156 64Z"/>
        </svg>
        <span className="text-sm mt-1">Explore</span>
      </button>

      <button
        onClick={() => onViewChange('library')}
        className={`flex flex-col items-center p-2 ${
          currentView === 'library' ? 'text-green-400' : 'text-gray-400'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
          <path d="m480-240 160-160-160-160v320ZM320-280v-400l240 200-240 200Zm160-120Z"/>
        </svg>
        <span className="text-sm mt-1">Library</span>
      </button>

      <div className="relative">
        <button
          onClick={handleProfileClick}
          className={`flex flex-col items-center p-2 ${
            currentView === 'profile' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/>
          </svg>
          <span className="text-sm mt-1">Profile</span>
        </button>
        
        {/* Profile Dropdown Menu */}
        {(() => { console.log('🧩 Rendering check for menu:', { showProfileMenu, currentView, shouldShow: showProfileMenu && currentView === 'profile' }); return null; })()} 
        {showProfileMenu && currentView === 'profile' && (
          <div 
            ref={profileMenuRef}
            className="absolute bottom-full mb-2 right-0 w-48 bg-gray-900 rounded-lg shadow-lg overflow-hidden z-50 border border-green-400/30"
          >
            <div className="py-2 px-3">
              {authenticated && user ? (
                <div className="text-white text-sm mb-2">
                  <p className="opacity-70 font-light">Signed in as:</p>
                  <p className="font-semibold truncate">{String(user.email || user.google?.email || 'User')}</p>
                </div>
              ) : (
                <div className="text-white text-sm mb-2">
                  <p>Sign in to access your profile</p>
                </div>
              )}
              
              <div className="mt-3">
                <PrivyLoginButton 
                  onLogin={handleLoginUpdate}
                  customButtonClass="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md transition-colors duration-200"
                  customButtonText={authenticated ? "Sign Out" : "Sign In with Privy"}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};