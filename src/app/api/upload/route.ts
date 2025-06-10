import { NextRequest, NextResponse } from 'next/server';
import { initializeApp } from 'firebase/app';
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
const storage = getStorage(app);

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileData = formData.get('file');
    const fid = formData.get('fid');

    if (!fileData || !fid) {
      console.error('Missing fields:', { 
        hasFile: !!fileData, 
        hasFid: !!fid
      });
      return NextResponse.json(
        { error: 'File and FID are required' },
        { status: 400 }
      );
    }

    if (!(fileData instanceof Blob)) {
      console.error('File is not a Blob');
      return NextResponse.json(
        { error: 'Invalid file format' },
        { status: 400 }
      );
    }

    // Get file details
    const file = fileData as File;
    console.log('Received file:', {
      type: file.type,
      size: file.size,
      name: file.name
    });

    // Validate file
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are allowed' },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      );
    }

    // Get file extension and create storage path
    const fileExtension = file.name.split('.').pop() || 'png';
    const storagePath = `profile-backgrounds/${fid}.${fileExtension}`;
    console.log('Storage path:', storagePath);

    // Convert to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('File converted to buffer, size:', buffer.length);

    // Create storage reference and upload
    const storageRef = ref(storage, storagePath);
    console.log('Starting upload to Firebase Storage...');

    const snapshot = await uploadBytes(storageRef, buffer, {
      contentType: file.type,
      customMetadata: {
        originalName: file.name
      }
    });

    console.log('Upload complete, getting download URL...');
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('Download URL obtained:', downloadURL);

    return NextResponse.json({ url: downloadURL });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Upload error:', {
      message: errorMessage,
      error: error
    });
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
