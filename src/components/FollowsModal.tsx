'use client';

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { subscribeToFollowers, subscribeToFollowingUsers, toggleFollowUser, isUserFollowed, getFollowerProfiles } from '../lib/firebase';
import type { FollowedUser, FarcasterUser } from '../types/user';
import { AnimatePresence, motion } from 'framer-motion';

interface FollowsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userFid: number;
  type: 'followers' | 'following';
  currentUserFid: number;
  onFollowStatusChange?: (newFollowStatus: boolean, targetFid: number) => void;
  onUserProfileClick?: (user: FarcasterUser) => void;
}

interface NotificationProps {
  message: string;
  type: 'success' | 'info';
  isVisible: boolean;
}

// Follow notification component
const FollowNotification: React.FC<NotificationProps> = ({ message, type, isVisible }) => {
  if (!isVisible) return null;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }}
      className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-3 rounded-xl shadow-lg z-50 text-white text-sm font-medium ${type === 'success' ? 'bg-green-500/90' : 'bg-purple-500/90'}`}
    >
      {message}
    </motion.div>
  );
};

const FollowsModal: React.FC<FollowsModalProps> = ({
  isOpen,
  onClose,
  userFid,
  type,
  currentUserFid,
  onFollowStatusChange,
  onUserProfileClick
}) => {
  const [users, setUsers] = useState<FollowedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [followStatus, setFollowStatus] = useState<Record<number, boolean>>({});
  const [processingFollow, setProcessingFollow] = useState<Record<number, boolean>>({});
  const modalRef = useRef<HTMLDivElement>(null);
  
  // Notification state
  const [notification, setNotification] = useState({
    message: '',
    type: 'success' as 'success' | 'info',
    isVisible: false
  });
  
  // Load users based on type (followers or following)
  useEffect(() => {
    if (!isOpen || !userFid) return;
    
    setLoading(true);
    let unsubscribe: () => void;
    
    if (type === 'followers') {
      unsubscribe = subscribeToFollowers(userFid, (followers) => {
        setUsers(followers);
        setLoading(false);
      });
    } else {
      unsubscribe = subscribeToFollowingUsers(userFid, (following) => {
        setUsers(following);
        setLoading(false);
      });
    }
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isOpen, userFid, type]);
  
  // Update follow status for each user when the list changes
  useEffect(() => {
    const checkFollowStatus = async () => {
      if (!currentUserFid || users.length === 0) return;
      
      const statusMap: Record<number, boolean> = {};
      
      // Check follow status for each user
      await Promise.all(users.map(async (user) => {
        if (user.fid === currentUserFid) return; // Skip self
        const isFollowed = await isUserFollowed(currentUserFid, user.fid);
        statusMap[user.fid] = isFollowed;
      }));
      
      setFollowStatus(statusMap);
    };
    
    checkFollowStatus();
  }, [users, currentUserFid]);
  
  // Show notification
  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({
      message,
      type,
      isVisible: true
    });
    
    // Auto hide after 2 seconds
    setTimeout(() => {
      setNotification(prev => ({ ...prev, isVisible: false }));
    }, 2000);
  };

  const handleToggleFollow = async (user: FollowedUser) => {
    if (!currentUserFid || user.fid === currentUserFid) return;
    
    try {
      // Mark this user as processing to prevent multiple clicks
      setProcessingFollow(prev => ({ ...prev, [user.fid]: true }));
      
      // Convert FollowedUser to FarcasterUser format
      const farcasterUser: FarcasterUser = {
        fid: user.fid,
        username: user.username,
        display_name: user.display_name,
        pfp_url: user.pfp_url,
        follower_count: 0,    // Default value as we don't have this info
        following_count: 0     // Default value as we don't have this info
      };
      
      // Toggle follow status
      const newStatus = await toggleFollowUser(currentUserFid, farcasterUser);
      
      // Update local state immediately
      setFollowStatus(prev => ({
        ...prev,
        [user.fid]: newStatus
      }));
      
      // Show notification
      if (newStatus) {
        showNotification(`You are now following @${user.username}`);
      } else {
        showNotification(`You unfollowed @${user.username}`, 'info');
      }
      
      // Notify parent component about follow status change to update counts immediately
      if (onFollowStatusChange && currentUserFid === userFid) {
        onFollowStatusChange(newStatus, user.fid);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    } finally {
      // Clear processing state
      setProcessingFollow(prev => ({ ...prev, [user.fid]: false }));
    }
  };
  
  // We no longer need this early return since AnimatePresence will handle it
  
  // Handle outside click to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);
  
  const loadFollowers = async () => {
    setLoading(true);
    try {
      // Use getFollowerProfiles instead of getFollowers
      const followersList = await getFollowerProfiles(userFid);
      setUsers(followersList);
    } catch (error) {
      console.error('Error loading followers:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ paddingBottom: '100px' }}>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/80" 
            onClick={onClose}
          />
          
          {/* Modal matching the screenshot exactly */}
          <motion.div 
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ 
              type: "spring",
              stiffness: 350,
              damping: 25,
              duration: 0.3
            }}
            className="relative bg-black border border-purple-400/30 rounded-xl max-w-md w-full overflow-hidden shadow-xl flex flex-col mx-4"
          >
            {/* Header */}
            <div className="border-b border-purple-400/20 p-4 flex justify-between items-center bg-black z-10 sticky top-0">
              <h2 className="text-xl font-semibold text-white capitalize">{type}</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close modal"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
            
            {/* Body - Auto height with max-height to handle fewer users */}
            <div className="overflow-y-auto overscroll-contain -webkit-overflow-scrolling-touch" 
                 style={{ 
                   scrollbarWidth: 'thin',
                   minHeight: '100px',
                   maxHeight: '375px' // Max height for 5 users, but will shrink if fewer
                 }}>
              {loading ? (
                <div className="flex justify-center items-center p-8">
                  <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-2"></div>
                  <p className="text-gray-400 text-sm mt-2">Loading...</p>
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No {type} yet
                </div>
              ) : (
                <ul className="divide-y divide-purple-400/10 pb-2">
                  {users.map(user => (
                    <li key={user.fid}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div 
                          onClick={() => {
                            // If we have a custom profile handler, use it
                            if (onUserProfileClick) {
                              // Close the modal first
                              onClose();
                              // Convert FollowedUser to FarcasterUser format for navigation
                              const farcasterUser: FarcasterUser = {
                                fid: user.fid,
                                username: user.username,
                                display_name: user.display_name,
                                pfp_url: user.pfp_url,
                                follower_count: 0,
                                following_count: 0
                              };
                              // Navigate to the user's profile within the app
                              onUserProfileClick(farcasterUser);
                            } else {
                              // Default fallback to external link if no custom handler
                              window.open(`https://warpcast.com/${user.username}`, '_blank');
                            }
                          }}
                          className="flex items-center cursor-pointer rounded-lg p-2 w-[calc(100%-90px)]" 
                        >
                          <div className="h-12 w-12 flex-shrink-0 rounded-full overflow-hidden mr-3 border border-purple-400/20">
                            <Image
                              src={user.pfp_url || '/default-avatar.png'}
                              alt={user.username || 'User profile picture'}
                              width={48}
                              height={48}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 w-full overflow-hidden">
                            <p className="font-semibold text-white truncate max-w-full">{user.display_name}</p>
                            <p className="text-sm text-gray-400 truncate max-w-full">@{user.username}</p>
                          </div>
                        </div>
                        
                        {currentUserFid !== user.fid && user.fid !== 1014485 && (
                          <button
                            onClick={() => handleToggleFollow(user)}
                            disabled={processingFollow[user.fid]}
                            className={`flex items-center justify-center rounded-lg text-sm font-medium transition-colors w-[90px] h-[36px] ${followStatus[user.fid] 
                              ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                              : 'bg-purple-600 hover:bg-purple-500 text-white'} ${
                                processingFollow[user.fid] ? 'opacity-70 cursor-not-allowed' : ''
                              }`}
                          >
                            {processingFollow[user.fid] ? (
                              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                            ) : followStatus[user.fid] ? (
                              "Following"
                            ) : (
                              "Follow"
                            )}
                          </button>
                        )}
                        
                        {/* Special badge for PODPLAYR account */}
                        {user.fid === 1014485 && (
                          <div className="px-3 py-1 rounded-lg text-xs font-medium bg-purple-600/20 text-purple-300 border border-purple-500/30">
                            Official
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
          
          {/* Notification */}
          {notification.isVisible && (
            <FollowNotification 
              message={notification.message} 
              type={notification.type} 
              isVisible={notification.isVisible} 
            />
          )}
        </div>
      )}
    </AnimatePresence>
  );
};

export default FollowsModal;