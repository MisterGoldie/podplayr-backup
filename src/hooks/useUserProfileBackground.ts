import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logger } from '../utils/logger';

const imageLogger = logger.getModuleLogger('user-images');

/**
 * Custom hook to fetch background image for a specific user profile by FID
 */
export const useUserProfileBackground = (fid?: number) => {
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchUserBackgroundImage = async () => {
      if (!fid) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const userDoc = await getDoc(doc(db, 'users', fid.toString()));
        const data = userDoc.data();
        
        if (data?.backgroundImage) {
          // Preload the image before setting it to avoid flicker
          const img = new Image();
          img.onload = () => {
            setBackgroundImage(data.backgroundImage);
            setLoading(false);
          };
          img.onerror = () => {
            imageLogger.error(`Failed to load background image for user FID: ${fid}`);
            setBackgroundImage(null);
            setLoading(false);
          };
          img.src = data.backgroundImage;
        } else {
          setBackgroundImage(null);
          setLoading(false);
        }
      } catch (err) {
        imageLogger.error(`Error fetching background image for user FID: ${fid}`, err);
        setError(err instanceof Error ? err : new Error('Unknown error fetching background image'));
        setBackgroundImage(null);
        setLoading(false);
      }
    };

    fetchUserBackgroundImage();
  }, [fid]);

  return { backgroundImage, loading, error };
};
