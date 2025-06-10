'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface UserImageContextType {
  backgroundImage: string | null;
  profileImage: string | null;
  setBackgroundImage: (url: string | null) => void;
  setProfileImage: (url: string | null) => void;
}

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

  // Preload an image URL
  const preloadImage = async (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.src = url;
    });
  };

  // Load user's images when fid changes
  useEffect(() => {
    const loadUserImages = async () => {
      if (fid) {
        try {
          const userDoc = await getDoc(doc(db, 'users', fid.toString()));
          const data = userDoc.data();
          
          // Load background image if exists
          if (data?.backgroundImage) {
            await preloadImage(data.backgroundImage);
            setBackgroundImage(data.backgroundImage);
          }
          
          // Load profile image if exists and not already set
          if (data?.pfpUrl && !initialProfileImage) {
            await preloadImage(data.pfpUrl);
            setProfileImage(data.pfpUrl);
          }
        } catch (err) {
          console.error('Error loading user images:', err);
        }
      }
    };

    loadUserImages();
  }, [fid, initialProfileImage]);

  return (
    <UserImageContext.Provider value={{ 
      backgroundImage, 
      profileImage,
      setBackgroundImage,
      setProfileImage
    }}>
      {children}
    </UserImageContext.Provider>
  );
}
