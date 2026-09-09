import { NextResponse } from 'next/server';
import { pollAndNotifyLive } from '~/lib/liveNotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST() {
  try {
    const result = await pollAndNotifyLive();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('live notify failed:', error);
    return NextResponse.json({ success: false, error: 'Live notify failed' }, { status: 500 });
  }
}
