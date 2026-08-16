'use client';

import React, { useCallback, useEffect, useState } from 'react';

const STORAGE_KEYS = {
  expand: 'podplayr.hint.expandVideo',
  minimize: 'podplayr.hint.minimizePlayer',
} as const;

function hasSeenHint(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return true;
  }
}

function markHintSeen(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ignore private-mode quota errors
  }
}

export function usePlayerArrowHint(kind: 'expand' | 'minimize', enabled: boolean) {
  const key = STORAGE_KEYS[kind];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || hasSeenHint(key)) {
      setVisible(false);
      return;
    }

    const showTimer = window.setTimeout(() => setVisible(true), 650);
    const hideTimer = window.setTimeout(() => setVisible(false), 5600);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [enabled, key]);

  const dismiss = useCallback(() => {
    setVisible(false);
    markHintSeen(key);
  }, [key]);

  return { visible, dismiss };
}

interface PlayerArrowHintProps {
  visible: boolean;
  text: string;
  placement: 'above' | 'below';
}

export function PlayerArrowHint({ visible, text, placement }: PlayerArrowHintProps) {
  if (!visible) return null;

  const bubble = (
    <div className="whitespace-nowrap rounded-full bg-gray-900/95 backdrop-blur-md border border-purple-400/35 shadow-lg shadow-purple-900/40 px-3 py-1.5 text-xs font-medium text-white">
      {text}
    </div>
  );

  if (placement === 'above') {
    return (
      <div
        role="status"
        className="pointer-events-none fixed right-3 z-[105]"
        style={{ bottom: 'calc(10.35rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex flex-col items-end">
          {bubble}
          <div
            className="mr-3.5 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[7px] border-l-transparent border-r-transparent border-t-purple-400/40"
            aria-hidden
          />
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="pointer-events-none absolute top-full right-0 mt-2 z-20">
      <div className="flex flex-col items-end">
        <div
          className="mr-3.5 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[7px] border-l-transparent border-r-transparent border-b-purple-400/40"
          aria-hidden
        />
        {bubble}
      </div>
    </div>
  );
}
