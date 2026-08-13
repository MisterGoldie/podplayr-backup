import { useCallback, useState } from 'react';

export interface FollowNotificationState {
  message: string;
  type: 'success' | 'info';
  isVisible: boolean;
}

const AUTO_HIDE_MS = 2000;

/** Shared state for the small follow/unfollow toast (see FollowNotification component). */
export function useFollowNotification() {
  const [notification, setNotification] = useState<FollowNotificationState>({
    message: '',
    type: 'success',
    isVisible: false
  });

  const showNotification = useCallback((message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type, isVisible: true });
    setTimeout(() => {
      setNotification(prev => ({ ...prev, isVisible: false }));
    }, AUTO_HIDE_MS);
  }, []);

  return { notification, showNotification };
}
