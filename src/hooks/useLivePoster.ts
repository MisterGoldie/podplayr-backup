'use client';

import { useEffect, useState } from 'react';
import { livePosterUrl } from '../data/liveStream';

export function useLivePoster(online: boolean) {
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/live/poster', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { showEnded?: boolean }) => {
        if (!cancelled && typeof data.showEnded === 'boolean') setShowEnded(data.showEnded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [online]);

  return livePosterUrl({ online, showEnded });
}
