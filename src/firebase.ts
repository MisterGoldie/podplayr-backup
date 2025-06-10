import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Initialize Firebase Storage with custom settings
export const storage = getStorage(app, 'gs://podplayr2.firebasestorage.app');

console.log('Initialized Firebase Storage with bucket:', storage.app.options.storageBucket);

// Upload profile background image
export const uploadProfileBackground = async (fid: number, file: File): Promise<string> => {
  try {
    // Validate file on client side
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed');
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      throw new Error('File size must be less than 5MB');
    }

    console.log('Starting upload for file:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    // Get file extension and create storage path
    const fileExtension = file.type.split('/')[1] || 'png';
    const storagePath = `profile-backgrounds/${fid}.${fileExtension}`;
    
    // Create storage reference
    const storageRef = ref(storage, storagePath);

    // Upload metadata
    const metadata = {
      contentType: file.type,
      customMetadata: {
        userId: fid.toString(),
        uploadedAt: new Date().toISOString(),
        originalName: file.name
      }
    };

    console.log('Starting Firebase upload:', {
      path: storagePath,
      bucket: storage.app.options.storageBucket
    });

    // Upload the file
    const snapshot = await uploadBytes(storageRef, file, metadata);
    console.log('Upload complete:', snapshot.metadata);

    // Get download URL
    const downloadUrl = await getDownloadURL(snapshot.ref);
    console.log('Got download URL:', downloadUrl);

    // Store the URL in Firestore
    const userRef = doc(db, 'users', fid.toString());
    await setDoc(userRef, { 
      backgroundImage: downloadUrl,
      backgroundUpdatedAt: new Date().toISOString()
    }, { merge: true });
    
    console.log('Updated Firestore with new background URL');
    return downloadUrl;

  } catch (error) {
    // Log detailed error information
    const errorInfo = {
      type: error?.constructor?.name,
      message: error instanceof Error ? error.message : 'Unknown error',
      code: error instanceof Error && 'code' in error ? (error as any).code : undefined,
      bucket: storage.app.options.storageBucket,
      stack: error instanceof Error ? error.stack : undefined
    };

    console.error('Firebase upload error:', errorInfo);

    // Throw user-friendly error
    if (errorInfo.code === 'storage/unauthorized') {
      throw new Error('Permission denied to upload image');
    } else if (errorInfo.code === 'storage/canceled') {
      throw new Error('Upload was canceled');
    } else if (errorInfo.code === 'storage/invalid-checksum') {
      throw new Error('File upload failed - please try again');
    } else {
      throw new Error('Failed to upload background image');
    }
  }
};
//