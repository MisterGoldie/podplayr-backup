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
        className="flex items-center justify-center w-6 h-6 text-current transition-colors duration-200"
      >
        {userInfo.farcasterInfo.isConnected ? (
          // User avatar when logged in - show solid profile icon
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/>
          </svg>
        ) : (
          // Login icon when not logged in - same solid style
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/>
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
