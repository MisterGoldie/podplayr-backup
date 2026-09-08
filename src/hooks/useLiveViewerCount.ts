'use client';

import { useEffect, useState } from 'react';
import { startLiveViewerHeartbeat, subscribeLiveViewerCount } from '../lib/liveViewers';

export function useLiveViewerCount(watching: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    return subscribeLiveViewerCount(setCount);
  }, []);

  useEffect(() => {
    if (!watching) return;
    return startLiveViewerHeartbeat();
  }, [watching]);

  return count;
}
