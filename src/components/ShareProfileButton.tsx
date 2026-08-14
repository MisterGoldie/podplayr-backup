'use client';

import { useState } from 'react';
import { shareProfileToFarcaster } from '../lib/shareToFarcaster';

export function ShareProfileButton({
  fid,
  username,
  showLabel = false,
  className,
}: {
  fid?: number;
  username?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [sharing, setSharing] = useState(false);

  if (!fid || fid <= 0) return null;

  return (
    <button
      type="button"
      disabled={sharing}
      onClick={async () => {
        setSharing(true);
        try {
          await shareProfileToFarcaster({ fid, username });
        } finally {
          setSharing(false);
        }
      }}
      className={
        className ||
        (showLabel
          ? 'bg-black/40 active:bg-purple-500/20 border border-purple-400/20 rounded-full px-3 py-1.5 touch-manipulation flex items-center gap-1.5'
          : 'bg-black/45 backdrop-blur-md border border-white/15 rounded-full p-2 touch-manipulation')
      }
      aria-label="Share profile"
    >
      <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor" className="text-white">
        <path d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"/>
      </svg>
      {showLabel ? <span className="text-xs text-white font-medium">Share</span> : null}
    </button>
  );
}
