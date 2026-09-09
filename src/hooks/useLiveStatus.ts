'use client';

import { useEffect, useRef, useState } from 'react';
import { LIVE_HLS_URL, LIVE_OFFLINE_POLLS, LIVE_POLL_MS } from '../data/liveStream';

let lastMediaSequence: string | null = null;
let lastSeqAt = 0;

/** Mux leaves the last ~30s window up after ingest stops. Treat that as off. */
async function checkLiveManifest(): Promise<'live' | 'ended' | 'down'> {
  try {
    const res = await fetch(LIVE_HLS_URL, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return 'down';
    const text = await res.text();
    if (!text.includes('#EXTM3U')) return 'down';
    if (text.includes('#EXT-X-ENDLIST')) {
      lastMediaSequence = null;
      lastSeqAt = 0;
      return 'ended';
    }
    const seq = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] ?? null;
    const now = Date.now();
    // Same sequence after a full poll interval means ingest stopped. Same
    // sequence 200ms later is just home + player polling in parallel.
    if (seq && lastMediaSequence === seq && now - lastSeqAt >= LIVE_POLL_MS) {
      return 'ended';
    }
    if (seq) {
      lastMediaSequence = seq;
      lastSeqAt = now;
    }
    return 'live';
  } catch {
    return 'down';
  }
}

export function useLiveStatus() {
  const [online, setOnline] = useState(false);
  const onlineRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let misses = 0;

    const poll = async () => {
      const result = await checkLiveManifest();
      if (cancelled) return;
      if (result === 'live') {
        misses = 0;
        if (!onlineRef.current) {
          onlineRef.current = true;
          setOnline(true);
          void fetch('/api/live/notify', { method: 'POST' }).catch(() => {});
        }
        return;
      }
      if (result === 'ended') {
        misses = LIVE_OFFLINE_POLLS;
      } else {
        misses += 1;
      }
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
