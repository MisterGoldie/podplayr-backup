import React, { useState, useRef, useEffect, useContext } from 'react';
import { FarcasterContext } from '../../app/providers';
import Image from 'next/image';

interface UserInfo {
  farcasterInfo: {
    username?: string;
    fid?: number;
    profileImage?: string;
    displayName?: string;
    isConnected: boolean;
  };
}

const UserDropdownMenu: React.FC = () => {
  const { isFarcaster, initialProfileImage } = useContext(FarcasterContext);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    farcasterInfo: {
      isConnected: false
    }
  });

  // Update user info when Farcaster context changes
  useEffect(() => {
    if (isFarcaster && initialProfileImage) {
      setUserInfo({
        farcasterInfo: {
          isConnected: true,
          profileImage: initialProfileImage
        }
      });
    }
  }, [isFarcaster, initialProfileImage]);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-700 text-white transition-colors duration-200"
      >
        {userInfo.farcasterInfo.isConnected ? (
          // User avatar when logged in - show Farcaster profile image if available
          <div className="flex items-center justify-center w-full h-full text-sm font-medium overflow-hidden">
            {userInfo.farcasterInfo.profileImage ? (
              <Image 
                src={userInfo.farcasterInfo.profileImage} 
                alt="Profile" 
                width={20} 
                height={20} 
                className="rounded-full object-cover"
              />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor"/>
              </svg>
            )}
          </div>
        ) : (
          // Login icon when not logged in
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor"/>
          </svg>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 overflow-hidden">
          <div className="py-1">
            {userInfo.farcasterInfo.isConnected ? (
              <>
                {/* Farcaster Section */}
                <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="currentColor"/>
                    </svg>
                    <span className="font-medium">Farcaster</span>
                  </div>
                  <div className="mt-1 ml-6">
                    {userInfo.farcasterInfo.displayName || userInfo.farcasterInfo.username || 'Farcaster User'}
                  </div>
                </div>
              </>
            ) : (
              <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                Please sign in with Farcaster to access your profile
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDropdownMenu;
