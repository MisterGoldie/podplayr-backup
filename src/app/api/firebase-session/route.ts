import { createClient } from '@farcaster/quick-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminAuth } from '../../../lib/firebaseAdmin';
import { logger } from '../../../utils/logger';

const authLogger = logger.getModuleLogger('firebase-auth');
const quickAuth = createClient();

function hostnameFromRequest(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  const host = (forwarded || request.headers.get('host') || '').split(',')[0].trim();
  if (!host) return null;
  return host.split(':')[0].toLowerCase();
}

export async function POST(request: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing Quick Auth token' }, { status: 400 });
  }

  const domain = hostnameFromRequest(request);
  if (!domain) {
    return NextResponse.json({ error: 'Missing host' }, { status: 400 });
  }

  let payload;
  try {
    payload = await quickAuth.verifyJwt({ token, domain });
  } catch (error) {
    authLogger.warn(
      'Quick Auth token rejected:',
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: 'Invalid Quick Auth token' }, { status: 401 });
  }

  const fid = typeof payload.sub === 'number' ? payload.sub : Number(payload.sub);
  if (!Number.isInteger(fid) || fid <= 0) {
    return NextResponse.json({ error: 'Invalid fid in token' }, { status: 401 });
  }

  try {
    const customToken = await getFirebaseAdminAuth().createCustomToken(String(fid), {
      fid,
    });

    return NextResponse.json({ token: customToken, fid });
  } catch (error) {
    authLogger.error('Firebase custom token failed:', error);
    const message = error instanceof Error ? error.message : 'Auth failed';
    const missingAdmin = message.includes('FIREBASE_');
    return NextResponse.json(
      { error: missingAdmin ? 'Firebase Admin is not configured' : 'Auth failed' },
      { status: missingAdmin ? 503 : 500 }
    );
  }
}
