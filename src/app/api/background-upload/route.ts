import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    // Check for required environment variables
    const requiredEnvVars = {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
      FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET
    };

    // Check if any required variables are missing
    const missingVars = Object.entries(requiredEnvVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // At this point, we know all values are defined
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET } = requiredEnvVars as {
      FIREBASE_PROJECT_ID: string;
      FIREBASE_CLIENT_EMAIL: string;
      FIREBASE_PRIVATE_KEY: string;
      FIREBASE_STORAGE_BUCKET: string;
    };

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket: FIREBASE_STORAGE_BUCKET
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw error;
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONS handler for CORS
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
  
  try {
    console.log('Processing upload request...');
    const formData = await request.formData();
    const file = formData.get('file');
    const fid = formData.get('fid');
    
    if (!file || !fid || !(file instanceof Blob)) {
      console.error('Invalid request:', { hasFile: !!file, fid, isBlob: file instanceof Blob });
      return NextResponse.json(
        { error: 'Missing file or fid' },
        { status: 400, headers }
      );
    }

    // Upload file to Firebase Storage
    const bucket = admin.storage().bucket();
    if (!bucket) {
      console.error('Firebase Storage bucket not initialized');
      return NextResponse.json(
        { error: 'Storage not initialized' },
        { status: 500, headers }
      );
    }

    const filename = `backgrounds/${fid}/${Date.now()}_${(file as File).name || 'background'}`;
    const fileRef = bucket.file(filename);
    
    console.log('Uploading file:', { filename, contentType: file.type });
    const buffer = Buffer.from(await file.arrayBuffer());
    
    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type
      }
    });

    console.log('File uploaded, generating signed URL...');
    const [url] = await fileRef.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    console.log('Updating user document...');
    // Update user doc with new background URL
    await admin.firestore().collection('users').doc(fid.toString()).set({
      backgroundImage: url
    }, { merge: true });

    console.log('Upload completed successfully');
    return NextResponse.json({ url }, { headers });
  } catch (error) {
    console.error('Upload error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Return a more detailed error response
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    const errorDetails = error instanceof Error ? error.stack : 'No stack trace';
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString()
      }, 
      { status: 500, headers }
    );
  }
}
