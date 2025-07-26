import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, query, where } from 'firebase/firestore';

// Use your existing Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanupDuplicates() {
  console.log('🧹 Cleaning up duplicate mediaKeys...');
  
  // Clean up global_likes
  const likesRef = collection(db, 'global_likes');
  const likesSnapshot = await getDocs(likesRef);
  
  for (const docSnap of likesSnapshot.docs) {
    const mediaKey = docSnap.id;
    // Delete old contract-tokenId format entries
    if (mediaKey.includes('-0x') || mediaKey.match(/^0x[a-fA-F0-9]+-\d+$/)) {
      console.log(`Deleting old mediaKey: ${mediaKey}`);
      await deleteDoc(docSnap.ref);
    }
  }
  
  // Clean up global_plays
  const playsRef = collection(db, 'global_plays');
  const playsSnapshot = await getDocs(playsRef);
  
  for (const docSnap of playsSnapshot.docs) {
    const mediaKey = docSnap.id;
    // Delete old contract-tokenId format entries
    if (mediaKey.includes('-0x') || mediaKey.match(/^0x[a-fA-F0-9]+-\d+$/)) {
      console.log(`Deleting old mediaKey: ${mediaKey}`);
      await deleteDoc(docSnap.ref);
    }
  }
  
  console.log('✅ Cleanup completed!');
}

cleanupDuplicates().catch(console.error);