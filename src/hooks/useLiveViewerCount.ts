'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { UnifiedContext, UserFidContext } from '../app/providers';
import { startLiveViewerHeartbeat, subscribeLiveViewerCount } from '../lib/liveViewers';
import { isRealFid } from '../utils/platform';

export function useLiveViewerCount(watching: boolean) {
  const [count, setCount] = useState(0);
  const { fid, walletAddress, firebaseUid, environment } = useContext(UserFidContext);
  const { user } = useContext(UnifiedContext);
  const identityRef = useRef({
    fid,
    walletAddress,
    firebaseUid,
    environment,
    username: user?.username,
    displayName: user?.displayName,
  });
  identityRef.current = {
    fid: isRealFid(fid) ? fid : null,
    walletAddress,
    firebaseUid,
    environment,
    username: user?.username,
    displayName: user?.displayName,
  };

  useEffect(() => {
    return subscribeLiveViewerCount(setCount);
  }, []);

  useEffect(() => {
    if (!watching) return;
    return startLiveViewerHeartbeat(() => identityRef.current);
  }, [watching]);

  return count;
}
