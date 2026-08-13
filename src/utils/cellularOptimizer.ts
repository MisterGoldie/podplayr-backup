/**
 * Detect cellular vs Wi‑Fi using the Network Information API when present.
 * Used by video preloading to avoid extra media fetches on cell.
 */

export const isCellularConnection = (): {
  isCellular: boolean;
  generation: '5G' | '4G' | '3G' | '2G' | 'unknown';
} => {
  if (typeof navigator === 'undefined' || !('connection' in navigator)) {
    return { isCellular: false, generation: 'unknown' };
  }

  const connection = (navigator as any).connection;
  const effectiveType = connection?.effectiveType || '';
  const downlink = connection?.downlink || 0;
  const rtt = connection?.rtt || 0;

  const isCellular =
    connection?.type === 'cellular' ||
    effectiveType.includes('g') ||
    connection?.type?.includes('cell');

  let generation: '5G' | '4G' | '3G' | '2G' | 'unknown' = 'unknown';

  if (isCellular) {
    if (downlink >= 50 && rtt < 50) {
      generation = '5G';
    } else if (downlink >= 10 || (effectiveType === '4g' && downlink > 5)) {
      generation = '4G';
    } else if (effectiveType === '3g' || downlink > 1) {
      generation = '3G';
    } else if (effectiveType === '2g' || effectiveType === 'slow-2g') {
      generation = '2G';
    }
  }

  return { isCellular, generation };
};
