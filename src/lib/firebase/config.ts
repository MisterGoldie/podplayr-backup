import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { logger } from '../../utils/logger';

// Create module-specific loggers
export const firebaseLogger = logger.getModuleLogger('firebase');
export const authLogger = logger.getModuleLogger('auth');
export const dataLogger = logger.getModuleLogger('data');

// Initialize Firebase with your config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export { app };
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// PODPLAYR official account details
export const PODPLAYR_FID = 1736;
export const PODPLAYR_USERNAME = 'podplayr';
export const PODPLAYR_DISPLAY_NAME = 'PODPlayr 🎧';
export const PODPLAYR_PFP_URL = 'https://i.imgur.com/m6AuNqy.png';
