'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase/config';

interface UserImageContextType {
  backgroundImage: string | null;
  profileImage: string | null;
  setBackgroundImage: (url: string | null) => void;
  setProfileImage: (url: string | null) => void;
}

const backgroundCache = new Map<number, string | null>();

const UserImageContext = createContext<UserImageContextType>({
  backgroundImage: null,
  profileImage: null,
  setBackgroundImage: () => {},
  setProfileImage: () => {},
});

export const useUserImages = () => useContext(UserImageContext);

export function UserImageProvider({ 
  children,
  fid,
  initialProfileImage
}: { 
  children: React.ReactNode;
  fid?: number;
  initialProfileImage?: string;
}) {
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(initialProfileImage || null);

  useEffect(() => {
    if (!fid) return;

    if (backgroundCache.has(fid)) {
      const cached = backgroundCache.get(fid);
      if (cached) setBackgroundImage(cached);
    }

    let cancelled = false;
    const loadUserImages = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', fid.toString()));
        if (cancelled) return;
        const data = userDoc.data();
        const bg = typeof data?.backgroundImage === 'string' ? data.backgroundImage : null;
        backgroundCache.set(fid, bg);
        if (bg) setBackgroundImage(bg);
        if (!initialProfileImage && data?.pfpUrl) {
          setProfileImage(data.pfpUrl);
        }
      } catch (err) {
        console.error('Error loading user images:', err);
      }
    };

    void loadUserImages();
    return () => {
      cancelled = true;
    };
  }, [fid, initialProfileImage]);

  const updateBackgroundImage = (url: string | null) => {
    if (fid) backgroundCache.set(fid, url);
    setBackgroundImage(url);
  };

  return (
    <UserImageContext.Provider value={{ 
      backgroundImage, 
      profileImage,
      setBackgroundImage: updateBackgroundImage,
      setProfileImage
    }}>
      {children}
    </UserImageContext.Provider>
  );
}//