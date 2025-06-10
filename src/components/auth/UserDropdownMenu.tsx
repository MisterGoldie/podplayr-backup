import React, { useState, useRef, useEffect, useContext } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { PrivyLoginButton } from './PrivyLoginButton';
import { isFarcasterMiniApp } from '../../utils/platform';
import { FarcasterContext } from '../../app/providers';
import Image from 'next/image';
import { useEnsName } from 'wagmi';

// Helper function to truncate wallet addresses
const truncateAddress = (address: string): string => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

interface UserDropdownMenuProps {
  onLogin: (user: any) => void;
}

interface UserInfo {
  walletAddress: string;
  farcasterInfo: {
    username?: string;
    fid?: number;
    profileImage?: string;
    displayName?: string;
    isConnected: boolean;
  };
}

const UserDropdownMenu: React.FC<UserDropdownMenuProps> = ({ onLogin }) => {
  const { authenticated, user } = usePrivy();
  const farcasterContext = useContext(FarcasterContext);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    walletAddress: '',
    farcasterInfo: {
      isConnected: false
    }
  });

  // ENS name resolution
  const { data: ensName } = useEnsName({
    address: userInfo.walletAddress ? userInfo.walletAddress as `0x${string}` : undefined,
    chainId: 1, // Mainnet
  });
  
  // Extract user information when authenticated
  useEffect(() => {
    if (authenticated && user) {
      try {
        // Create a new user info object
        const newUserInfo: UserInfo = {
          walletAddress: '',
          farcasterInfo: {
            isConnected: false
          }
        };
        
        // Check for linked wallet accounts
        const walletAccounts = user.linkedAccounts?.filter(account => 
          account.type === 'wallet'
        );
        
        if (walletAccounts && walletAccounts.length > 0) {
          // Get the first wallet address
          const address = walletAccounts[0].address;
          if (address) {
            newUserInfo.walletAddress = address;
          }
        }
        
        // Check for Farcaster account
        const farcasterAccounts = user.linkedAccounts?.filter(account => 
          account.type === 'farcaster'
        );
        
        // If Farcaster accounts are available, use them
        if (farcasterAccounts && farcasterAccounts.length > 0) {
          // Log the account structure to help debug
          console.log('Farcaster account structure:', farcasterAccounts[0]);
          
          // Get Farcaster information using type assertion to avoid TypeScript errors
          const farcasterAccount = farcasterAccounts[0];
          const accountAny = farcasterAccount as any;
          
          // Create Farcaster info with required properties
          newUserInfo.farcasterInfo = {
            username: farcasterAccount.username as string,
            fid: farcasterAccount.fid as number,
            isConnected: true
          };
          
          // Safely add optional properties if they exist
          if (accountAny.pfp) {
            newUserInfo.farcasterInfo.profileImage = accountAny.pfp;
          } else if (accountAny.pfp_url) {
            newUserInfo.farcasterInfo.profileImage = accountAny.pfp_url;
          } else if (accountAny.profileImage) {
            newUserInfo.farcasterInfo.profileImage = accountAny.profileImage;
          }
          
          if (accountAny.displayName) {
            newUserInfo.farcasterInfo.displayName = accountAny.displayName;
          } else if (accountAny.display_name) {
            newUserInfo.farcasterInfo.displayName = accountAny.display_name;
          }
        } else if (farcasterContext.fid) {
          // If not in Privy but in Farcaster context (mini-app)
          newUserInfo.farcasterInfo = {
            fid: farcasterContext.fid,
            isConnected: true
          };
        }
        
        // Update state with all user info
        setUserInfo(newUserInfo);
      } catch (error) {
        console.error('Error getting user information:', error);
      }
    }
  }, [authenticated, user, farcasterContext]);
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
        {authenticated ? (
          // User avatar when logged in - show Farcaster profile image if available
          <div className="flex items-center justify-center w-full h-full text-sm font-medium overflow-hidden">
            {userInfo.farcasterInfo.isConnected && userInfo.farcasterInfo.profileImage ? (
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
            {authenticated ? (
              <>
                {/* Wallet Section */}
                <div className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M21 7.28V5c0-1.1-.9-2-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-2.28A2 2 0 0022 15V9a2 2 0 00-1-1.72zM20 9v6h-7V9h7zM5 19V5h14v2h-6c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h6v2H5z" fill="currentColor"/>
                      <circle cx="16" cy="12" r="1.5" fill="currentColor"/>
                    </svg>
                    <span className="font-medium">Wallet</span>
                  </div>
                  <div className="mt-1 ml-6">
                    {ensName ? (
                      <span className="font-medium">{ensName}</span>
                    ) : userInfo.walletAddress ? (
                      truncateAddress(userInfo.walletAddress)
                    ) : (
                      'Wallet Connecting...'
                    )}
                  </div>
                </div>
                
                {/* Logout Button */}
                <div className="px-4 py-2">
                  <PrivyLoginButton 
                    onLogin={onLogin} 
                    customButtonClass="w-full text-center bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded transition-colors duration-200"
                    customButtonText="Log out"
                  />
                </div>
              </>
            ) : (
              <div className="px-4 py-2">
                <PrivyLoginButton 
                  onLogin={onLogin} 
                  customButtonClass="w-full text-center bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded transition-colors duration-200"
                  customButtonText="Log in with Privy"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDropdownMenu;
