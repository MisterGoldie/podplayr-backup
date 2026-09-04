'use client';

import { signInWithCustomToken } from 'firebase/auth';
import { auth, authLogger } from './firebase/config';

let inFlightFid: number | null = null;
let inFlight: Promise<string | null> | null = null;

/**
 * Exchange a Farcaster Quick Auth JWT for a Firebase session.
 * uid is the user's FID. No-ops if that user is already signed in.
 * Returns the Firebase uid, or null if Quick Auth is unavailable / declined.
 */
export async function signInToFirebaseWithQuickAuth(expectedFid: number): Promise<string | null> {
  if (!expectedFid || expectedFid <= 0) return null;

  const currentUid = auth.currentUser?.uid;
  if (currentUid === String(expectedFid)) {
    return currentUid;
  }

  if (inFlight && inFlightFid === expectedFid) {
    return inFlight;
  }

  inFlightFid = expectedFid;
  inFlight = (async () => {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    if (!(await sdk.isInMiniApp())) {
      authLogger.info('Skipping Firebase Quick Auth — not in a mini app');
      return null;
    }

    const { token: quickAuthToken } = await sdk.quickAuth.getToken();
    const response = await fetch('/api/firebase-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: quickAuthToken }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      if (response.status === 503) {
        authLogger.error('Firebase Admin is not configured on the server:', details);
        return null;
      }
      throw new Error(`Firebase session exchange failed (${response.status}): ${details}`);
    }

    const data = (await response.json()) as { token?: string; fid?: number };
    if (!data.token || data.fid !== expectedFid) {
      throw new Error('Firebase session fid did not match the signed-in Farcaster user');
    }

    const credential = await signInWithCustomToken(auth, data.token);
    const uid = credential.user.uid;
    authLogger.info('Signed in to Firebase as fid', uid);
    return uid;
  })().finally(() => {
    inFlightFid = null;
    inFlight = null;
  });

  return inFlight;
}
