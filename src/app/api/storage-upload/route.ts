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
const app = initializeApp(firebaseConfig, 'storage-upload');
const storage = getStorage(app);

// Helper to add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400'
};

// CORS preflight handler
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function POST(request: NextRequest) {
  console.log('=== Starting upload request processing ===');
  
  try {
    // Verify all required Firebase config
    const requiredEnvVars = [
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      console.error('Missing required environment variables:', missingVars);
      throw new Error(`Missing required Firebase config: ${missingVars.join(', ')}`);
    }

    console.log('Firebase config verified:', {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    });

    console.log('Parsing form data...');
    const formData = await request.formData().catch(error => {
      console.error('Error parsing form data:', error);
      throw new Error('Failed to parse form data');
    });
    
    const fileData = formData.get('file');
    const fidData = formData.get('fid');

    console.log('Form data received:', {
      hasFile: !!fileData,
      hasFid: !!fidData,
      fileType: fileData instanceof Blob ? fileData.type : typeof fileData,
      fidType: typeof fidData
    });

    // Validate file
    if (!fileData || !(fileData instanceof Blob)) {
      return NextResponse.json(
        { error: 'File is required and must be a valid file' },
        { status: 400 }
      );
    }

    // Validate FID
    if (!fidData || typeof fidData !== 'string') {
      return NextResponse.json(
        { error: 'Valid FID is required' },
        { status: 400 }
      );
    }

    // We know fileData is a Blob at this point
    const file = fileData;
    const fid = fidData;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      console.error('Invalid file type:', file.type);
      return NextResponse.json(
        { error: 'Only image files are allowed' },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      console.error('File too large:', file.size);
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      );
    }

    // Get file extension from mime type and create storage path
    const fileExtension = file.type.split('/')[1] || 'png';
    const storagePath = `profile-backgrounds/${fid}.${fileExtension}`;

    console.log('Upload preparation:', {
      fileExtension,
      storagePath,
      fileSize: file.size,
      mimeType: file.type,
      bucket: storage.app.options.storageBucket
    });

    try {
      // Create storage reference with explicit path
      const storageRef = ref(storage, storagePath);
      
      // Convert Blob to ArrayBuffer for upload
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Set metadata
      const metadata = {
        contentType: file.type,
        customMetadata: {
          userId: fid,
          uploadedAt: new Date().toISOString(),
          originalSize: file.size.toString()
        }
      };

      console.log('Starting Firebase upload with:', {
        path: storagePath,
        size: uint8Array.length,
        type: file.type
      });

      // Upload to Firebase Storage
      const snapshot = await uploadBytes(storageRef, uint8Array, metadata);
      console.log('Upload complete:', snapshot.metadata);
      
      const downloadUrl = await getDownloadURL(snapshot.ref);
      console.log('Got download URL:', downloadUrl);
      
      return NextResponse.json({ 
        url: downloadUrl,
        path: storagePath,
        size: file.size
      }, {
        headers: corsHeaders
      });
    } catch (error) {
      // Log detailed Firebase upload error
      const errorDetails = {
        type: error?.constructor?.name,
        message: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof Error && 'code' in error ? (error as any).code : undefined,
        stack: error instanceof Error ? error.stack : undefined
      };
      
      console.error('Firebase upload error:', {
        ...errorDetails,
        bucket: storage.app.options.storageBucket,
        path: storagePath,
        fileInfo: {
          type: file.type,
          size: file.size
        }
      });
      
      return NextResponse.json(
        { 
          error: 'Failed to upload image to storage',
          details: errorDetails.message,
          code: errorDetails.code,
          bucket: storage.app.options.storageBucket
        },
        { 
          status: 500,
          headers: corsHeaders
        }
      );
    }
  } catch (error) {
    // Log detailed request processing error
    const errorDetails = {
      type: error?.constructor?.name,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    };
    
    console.error('Request processing error:', errorDetails);
    
    return NextResponse.json(
      { 
        error: 'Failed to process upload request',
        details: errorDetails.message
      },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Accept'
        }
      }
    );
  }
}
