'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface UserBackgroundContextType {
  backgroundImage: string | null;
  setBackgroundImage: (url: string | null) => void;
}

const UserBackgroundContext = createContext<UserBackgroundContextType>({
  backgroundImage: null,
  setBackgroundImage: () => {},
});

export const useUserBackground = () => useContext(UserBackgroundContext);

export function UserBackgroundProvider({ 
  children,
  fid
}: { 
  children: React.ReactNode;
  fid?: number;
}) {
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // Load user's background image when fid changes
  useEffect(() => {
    const loadBackgroundImage = async () => {
      if (fid) {
        try {
          const userDoc = await getDoc(doc(db, 'users', fid.toString()));
          const backgroundUrl = userDoc.data()?.backgroundImage;
          if (backgroundUrl) {
            // Preload the image
            const img = new Image();
            img.src = backgroundUrl;
            img.onload = () => setBackgroundImage(backgroundUrl);
          }
        } catch (err) {
          console.error('Error loading background image:', err);
        }
      }
    };

    loadBackgroundImage();
  }, [fid]);

  return (
    <UserBackgroundContext.Provider value={{ backgroundImage, setBackgroundImage }}>
      {children}
    </UserBackgroundContext.Provider>
  );
}
