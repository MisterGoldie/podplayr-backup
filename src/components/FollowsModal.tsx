'use client';

import React, { useEffect, useState, useRef } from 'react';
import { subscribeToFollowers, subscribeToFollowingUsers, toggleFollowUser, isUserFollowed } from '../lib/firebase';
import type { FollowedUser, FarcasterUser } from '../types/user';
import { AnimatePresence, motion } from 'framer-motion';
import FollowNotification from './FollowNotification';
import { useFollowNotification } from '../hooks/useFollowNotification';
import { getArtistProfilePreviews } from '../lib/artistProfile';
import ProfileAvatar from './user/ProfileAvatar';
import { isOfficialAccount, officialAccountDisplayName } from '../constants/community';

interface FollowsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userFid: number;
  type: 'followers' | 'following';
  currentUserFid: number;
  onFollowStatusChange?: (newFollowStatus: boolean, targetFid: number) => void;
  onUserProfileClick?: (user: FarcasterUser) => void;
}

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
  const [pfpOverrides, setPfpOverrides] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [followStatus, setFollowStatus] = useState<Record<number, boolean>>({});
  const [processingFollow, setProcessingFollow] = useState<Record<number, boolean>>({});
  const modalRef = useRef<HTMLDivElement>(null);
  
  const { notification, showNotification } = useFollowNotification();
  
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

  useEffect(() => {
    setPfpOverrides({});
  }, [isOpen, userFid, type]);

  useEffect(() => {
    if (!isOpen || users.length === 0) return;
    let cancelled = false;
    void getArtistProfilePreviews(users.map((user) => user.fid))
      .then((previews) => {
        if (cancelled) return;
        const next: Record<number, string> = {};
        previews.forEach((preview, fid) => {
          if (preview.pfpUrl) next[fid] = preview.pfpUrl;
        });
        if (Object.keys(next).length > 0) {
          setPfpOverrides((prev) => ({ ...prev, ...next }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isOpen, userFid, type, users]);
  
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
      showNotification('Failed to update follow status', 'error');
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

  const title = type === 'followers' ? 'Followers' : 'Following';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-4 pointer-events-none" style={{ paddingBottom: 'max(1rem, calc(6.5rem + env(safe-area-inset-bottom, 0px)))' }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
            onClick={onClose}
          />

          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25 }}
            className="relative bg-gray-900/95 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl shadow-purple-900/40 border border-purple-400/30 w-full max-w-sm max-h-full flex flex-col pointer-events-auto"
          >
            <div className="relative flex-shrink-0 px-5 pt-5 pb-3">
              <button
                type="button"
                onClick={onClose}
                className="absolute top-3 right-3 z-10 text-white/80 hover:text-white active:scale-95 transition-all p-2 touch-manipulation rounded-full bg-black/50 backdrop-blur-sm border border-white/10"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                  <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11 11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z" />
                </svg>
              </button>
              <h2 className="text-white text-lg font-semibold leading-snug tracking-tight pr-10">{title}</h2>
              {!loading && (
                <p className="mt-1 text-sm text-white/45">
                  {users.length.toLocaleString()} {users.length === 1 ? (type === 'followers' ? 'follower' : 'account') : type}
                </p>
              )}
            </div>

            <div
              className="px-4 pb-4 min-h-0 flex-1 overflow-y-auto overscroll-contain"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(168, 85, 247, 0.4) rgba(0, 0, 0, 0.2)',
                WebkitOverflowScrolling: 'touch',
                maxHeight: 'min(26rem, 60vh)',
              }}
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center py-10">
                  <div className="w-8 h-8 border-2 border-purple-400/20 border-t-purple-400 rounded-full animate-spin" />
                  <p className="text-white/40 text-sm mt-3">Loading</p>
                </div>
              ) : users.length === 0 ? (
                <div className="rounded-2xl bg-black/40 border border-purple-400/15 px-4 py-8 text-center">
                  <p className="text-white/50 text-sm">No {type} yet</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {users.map((user) => {
                    const isOfficial = isOfficialAccount(user.fid);
                    const pfp = pfpOverrides[user.fid] || user.pfp_url;
                    const displayName = officialAccountDisplayName(user.fid, user.display_name) || user.username;
                    return (
                      <li key={user.fid}>
                        <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-purple-400/15 px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (onUserProfileClick) {
                                onClose();
                                onUserProfileClick({
                                  fid: user.fid,
                                  username: user.username,
                                  display_name: displayName,
                                  pfp_url: pfp,
                                  follower_count: 0,
                                  following_count: 0,
                                });
                                return;
                              }
                              window.open(`https://warpcast.com/${user.username}`, '_blank');
                            }}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[0.99] touch-manipulation"
                            aria-label={`Open ${displayName}`}
                          >
                            <ProfileAvatar
                              src={pfp}
                              alt={user.username || 'User profile picture'}
                              size={44}
                              className="flex-shrink-0 ring-2 ring-purple-400/25"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-white text-sm font-medium truncate">
                                {displayName}
                              </p>
                              {user.username ? (
                                <p className="text-xs text-white/45 truncate">@{user.username}</p>
                              ) : null}
                            </div>
                          </button>

                          {currentUserFid !== user.fid && !isOfficial && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleToggleFollow(user);
                              }}
                              disabled={processingFollow[user.fid]}
                              className={`flex-shrink-0 inline-flex items-center justify-center min-w-[5.5rem] h-8 px-3 rounded-full text-xs font-medium transition-colors active:scale-95 touch-manipulation ${
                                followStatus[user.fid]
                                  ? 'bg-black/50 text-purple-200 border border-purple-400/25'
                                  : 'bg-purple-600/80 hover:bg-purple-500 text-white border border-purple-400/20'
                              } ${processingFollow[user.fid] ? 'opacity-70' : ''}`}
                            >
                              {processingFollow[user.fid] ? (
                                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : followStatus[user.fid] ? (
                                'Following'
                              ) : (
                                'Follow'
                              )}
                            </button>
                          )}

                          {isOfficial && (
                            <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-purple-800/40 text-purple-200 rounded-full">
                              Official
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>

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
