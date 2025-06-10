import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

// Initialize Firebase (copy your config from firebase.ts)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Clean up all likes data from Firebase
export const cleanupAllLikes = async () => {
  try {
    const batch = writeBatch(db);
    let deleteCount = 0;
    
    console.log('Starting likes cleanup...');

    // Delete all documents in global_likes collection
    console.log('Cleaning global_likes collection...');
    const globalLikesRef = collection(db, 'global_likes');
    const globalLikesSnapshot = await getDocs(globalLikesRef);
    globalLikesSnapshot.forEach((doc) => {
      batch.delete(doc.ref);
      deleteCount++;
    });
    console.log(`Found ${globalLikesSnapshot.size} documents in global_likes`);

    // Get all user documents
    console.log('Fetching user documents...');
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    console.log(`Found ${usersSnapshot.size} user documents`);

    // For each user, delete their likes subcollection
    for (const userDoc of usersSnapshot.docs) {
      console.log(`Cleaning likes for user ${userDoc.id}...`);
      const userLikesRef = collection(db, 'users', userDoc.id, 'likes');
      const userLikesSnapshot = await getDocs(userLikesRef);
      userLikesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`Found ${userLikesSnapshot.size} likes for user ${userDoc.id}`);
    }

    // Commit the batch
    console.log(`Committing batch delete of ${deleteCount} documents...`);
    await batch.commit();
    console.log('Successfully cleaned up all likes data');
    console.log(`Total documents deleted: ${deleteCount}`);
  } catch (error) {
    console.error('Error cleaning up likes:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

// Run the cleanup if this script is executed directly
if (require.main === module) {
  cleanupAllLikes()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    });
}
