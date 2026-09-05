import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase/config';
import { logger } from '../utils/logger';

const imageLogger = logger.getModuleLogger('user-images');
const backgroundCache = new Map<number, string | null>();

/**
 * Custom hook to fetch background image for a specific user profile by FID
 */
export const useUserProfileBackground = (fid?: number) => {
  const [backgroundImage, setBackgroundImage] = useState<string | null>(
    fid && backgroundCache.has(fid) ? backgroundCache.get(fid) ?? null : null
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!fid) {
      setBackgroundImage(null);
      return;
    }

    if (backgroundCache.has(fid)) {
      setBackgroundImage(backgroundCache.get(fid) ?? null);
    } else {
      setBackgroundImage(null);
    }

    let cancelled = false;
    const fetchUserBackgroundImage = async () => {
      setLoading(true);
      setError(null);

      try {
        const userDoc = await getDoc(doc(db, 'users', fid.toString()));
        if (cancelled) return;
        const bg = typeof userDoc.data()?.backgroundImage === 'string'
          ? userDoc.data()!.backgroundImage
          : null;
        backgroundCache.set(fid, bg);
        setBackgroundImage(bg);
      } catch (err) {
        if (cancelled) return;
        imageLogger.error(`Error fetching background image for user FID: ${fid}`, err);
        setError(err instanceof Error ? err : new Error('Unknown error fetching background image'));
        setBackgroundImage(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchUserBackgroundImage();
    return () => {
      cancelled = true;
    };
  }, [fid]);

  return { backgroundImage, loading, error };
};
//