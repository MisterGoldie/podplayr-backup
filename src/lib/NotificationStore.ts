import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();
const notificationsRef = db.collection('notifications');

export interface NotificationData {
  url: string;
  token: string;
  action?: 'play' | 'share' | 'library';
  updatedAt: FirebaseFirestore.Timestamp;
}

export class NotificationStore {
  static async create(fid: number, data: Omit<NotificationData, 'updatedAt'>) {
    try {
      const docRef = notificationsRef.doc(fid.toString());
      await docRef.set({
        ...data,
        updatedAt: FirebaseFirestore.Timestamp.now(),
      });
      return { id: docRef.id, ...data };
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  static async get(fid: number) {
    try {
      const doc = await notificationsRef.doc(fid.toString()).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() as NotificationData };
    } catch (error) {
      console.error('Error getting notification:', error);
      throw error;
    }
  }

  static async remove(fid: number) {
    try {
      await notificationsRef.doc(fid.toString()).delete();
    } catch (error) {
      console.error('Error removing notification:', error);
      throw error;
    }
  }
}
