'use client';

import React from 'react';
import { motion } from 'framer-motion';

export interface FollowNotificationProps {
  message: string;
  type: 'success' | 'info';
  isVisible: boolean;
}

/** Small bottom toast for follow/unfollow feedback (distinct from the NFT like/unlike header banner). */
const FollowNotification: React.FC<FollowNotificationProps> = ({ message, type, isVisible }) => {
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

export default FollowNotification;
