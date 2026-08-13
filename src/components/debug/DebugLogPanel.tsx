'use client';

import React, { useState } from 'react';
import { useDebugLog } from '../../hooks/useDebugLog';
import { clearDebugLog } from '../../utils/debugReporter';

interface DebugLogPanelProps {
  scope: string;
  title?: string;
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Visible, tappable debug trail for mobile mini-app testing where there's no
 * console access. Collapsed by default so it doesn't clutter the real UI.
 */
export const DebugLogPanel: React.FC<DebugLogPanelProps> = ({ scope, title = 'Debug Log' }) => {
  const entries = useDebugLog(scope);
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-4 mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono px-3 py-1.5 rounded-full bg-yellow-500/15 border border-yellow-400/40 text-yellow-300 active:bg-yellow-500/30"
      >
        {open ? '▼' : '▶'} {title}{entries.length > 0 ? ` (${entries.length})` : ''}
      </button>

      {open && (
        <div className="mt-2 bg-black/85 border border-yellow-400/30 rounded-lg p-3 max-h-80 overflow-y-auto text-[11px] font-mono text-yellow-100 space-y-2">
          {entries.length === 0 ? (
            <p className="text-gray-500">No entries yet.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="border-b border-yellow-400/10 pb-2 last:border-b-0">
                <div className="text-yellow-400">
                  [{entry.time}] {entry.message}
                </div>
                {entry.data !== undefined && (
                  <pre className="whitespace-pre-wrap break-all text-gray-300 mt-1">
                    {safeStringify(entry.data)}
                  </pre>
                )}
              </div>
            ))
          )}
          {entries.length > 0 && (
            <button
              onClick={() => clearDebugLog(scope)}
              className="text-red-400 underline text-[11px]"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};
