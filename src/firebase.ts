import { doc, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { app, db } from './lib/firebase/config';

export { db };
// Profile backgrounds use the dedicated storage bucket, not the default one.
export const storage = getStorage(app, 'gs://podplayr2.firebasestorage.app');


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


    // Upload the file
    const snapshot = await uploadBytes(storageRef, file, metadata);

    // Get download URL
    const downloadUrl = await getDownloadURL(snapshot.ref);

    // Store the URL in Firestore
    const userRef = doc(db, 'users', fid.toString());
    await setDoc(userRef, { 
      backgroundImage: downloadUrl,
      backgroundUpdatedAt: new Date().toISOString()
    }, { merge: true });
    
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
