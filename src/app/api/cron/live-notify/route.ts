import { NextRequest, NextResponse } from 'next/server';
import { pollAndNotifyLive } from '~/lib/liveNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && auth === `Bearer ${secret}`) return true;
  const ua = request.headers.get('user-agent') || '';
  if (!secret && ua.includes('vercel-cron')) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pollAndNotifyLive();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('live-notify cron failed:', error);
    return NextResponse.json({ success: false, error: 'Live notify failed' }, { status: 500 });
  }
}
