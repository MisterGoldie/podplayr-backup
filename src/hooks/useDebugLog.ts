'use client';

import { useEffect, useState } from 'react';
import { getDebugLog, subscribeDebugLog, type DebugEntry } from '../utils/debugReporter';

export function useDebugLog(scope: string): DebugEntry[] {
  const [entries, setEntries] = useState<DebugEntry[]>(() => getDebugLog(scope));

  useEffect(() => {
    setEntries(getDebugLog(scope));
    return subscribeDebugLog(scope, () => setEntries(getDebugLog(scope)));
  }, [scope]);

  return entries;
}
