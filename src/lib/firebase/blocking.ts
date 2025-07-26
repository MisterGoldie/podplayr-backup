import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const isUserBlockedInFirebase = async (fid: number): Promise<boolean> => {
  try {
    const blockedUserDoc = await getDoc(doc(db, 'blocked_users', fid.toString()));
    return blockedUserDoc.exists();
  } catch (error) {
    console.error('Error checking if user is blocked:', error);
    return false;
  }
};

export const blockUserInFirebase = async (fid: number, reason?: string): Promise<void> => {
  try {
    await setDoc(doc(db, 'blocked_users', fid.toString()), {
      fid,
      blockedAt: new Date(),
      reason: reason || 'No reason provided'
    });
    console.log('User blocked:', fid);
  } catch (error) {
    console.error('Error blocking user:', error);
    throw error;
  }
};

export const unblockUserInFirebase = async (fid: number): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'blocked_users', fid.toString()));
    console.log('User unblocked:', fid);
  } catch (error) {
    console.error('Error unblocking user:', error);
    throw error;
  }
};