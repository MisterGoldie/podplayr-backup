import React, { useState, useEffect } from 'react';
import type { FarcasterUser } from '../../types/user';

interface UserInfoPanelProps {
  user: FarcasterUser;
  totalPlays: number;
  nftCount: number;
  likedNFTsCount: number;
  onClose: () => void;
}

const UserInfoPanel: React.FC<UserInfoPanelProps> = ({ 
  user, 
  totalPlays, 
  nftCount, 
  likedNFTsCount,
  onClose 
}) => {
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match this to the animation duration
  };

  // Reset closing state when component mounts
  useEffect(() => {
    setIsClosing(false);
  }, [user]);

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-none">
      {/* Backdrop overlay with fade animation */}
      <div 
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto ${
          isClosing ? 'animate-fade-out' : 'animate-fade-in'
        }`}
        onClick={handleClose}
      ></div>
      
      {/* Info panel centered in the viewport */}
      <div 
        className={`relative bg-gray-900/95 backdrop-blur-lg rounded-xl p-5 shadow-2xl border border-purple-400/30 w-full max-w-sm mx-4 pointer-events-auto ${
          isClosing ? 'animate-slide-down' : 'animate-slide-up'
        }`}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h2 className="text-purple-300 font-mono text-base font-semibold">@{user.username}</h2>
            {user.display_name && (
              <p className="text-white text-sm">{user.display_name}</p>
            )}
          </div>
          <button 
            onClick={handleClose}
            className="text-purple-300 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        
        {/* User Stats */}
        <div className="space-y-4">
          {/* Total Plays Badge */}
          <div className="bg-blue-500/20 rounded-lg p-3 flex items-center gap-3">
            <div className="bg-blue-500/30 rounded-full p-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-blue-300 font-medium">Number of NFT Plays</h3>
              <p className="font-mono text-lg text-white font-bold">
                {totalPlays.toLocaleString()}
              </p>
            </div>
          </div>
          
          {/* Media NFTs Badge */}
          <div className="bg-green-500/20 rounded-lg p-3 flex items-center gap-3">
            <div className="bg-green-500/30 rounded-full p-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-green-300 font-medium">Media NFTs</h3>
              <p className="font-mono text-lg text-white font-bold">
                {nftCount.toLocaleString()}
              </p>
            </div>
          </div>
          
          {/* Liked NFTs Badge */}
          <div className="bg-red-500/20 rounded-lg p-3 flex items-center gap-3">
            <div className="bg-red-500/30 rounded-full p-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-red-300 font-medium">NFTs Liked</h3>
              <p className="font-mono text-lg text-white font-bold">
                {likedNFTsCount.toLocaleString()}
              </p>
            </div>
          </div>
          
          {/* User Info */}
          <div className="bg-purple-500/20 rounded-lg p-3 mt-4">
            <h3 className="text-purple-300 font-medium mb-2">Bio</h3>
            <p className="text-white text-sm">
              {(() => {
                // Handle different possible bio formats safely
                const bio = user.profile?.bio;
                if (typeof bio === 'string') {
                  return bio || "No bio available";
                } else if (bio && typeof bio === 'object') {
                  // Check if bio is an object with a text property
                  const bioObj = bio as any; // Use type assertion to avoid TypeScript errors
                  return bioObj.text || "No bio available";
                } else {
                  return "No bio available";
                }
              })()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserInfoPanel;
