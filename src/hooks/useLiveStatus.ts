'use client';

import { useEffect, useRef, useState } from 'react';
import { LIVE_HLS_URL, LIVE_OFFLINE_POLLS, LIVE_POLL_MS } from '../data/liveStream';

export async function isLiveManifestAvailable(): Promise<boolean> {
  try {
    const res = await fetch(LIVE_HLS_URL, { method: 'GET', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export function useLiveStatus() {
  const [online, setOnline] = useState(false);
  const onlineRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let misses = 0;

    const poll = async () => {
      const live = await isLiveManifestAvailable();
      if (cancelled) return;
      if (live) {
        misses = 0;
        if (!onlineRef.current) {
          onlineRef.current = true;
          setOnline(true);
        }
        return;
      }
      misses += 1;
      if (misses < LIVE_OFFLINE_POLLS || !onlineRef.current) return;
      onlineRef.current = false;
      setOnline(false);
    };

    void poll();
    const id = window.setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return online;
}
