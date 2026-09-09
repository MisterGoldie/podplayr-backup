import { NextResponse } from 'next/server';
import { livePosterUrl } from '~/data/liveStream';
import { syncLiveStreamState } from '~/lib/liveNotify';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await syncLiveStreamState();
    return NextResponse.json({
      online: state.online,
      showEnded: state.showEnded,
      posterUrl: livePosterUrl(state),
    });
  } catch (error) {
    console.error('live poster failed:', error);
    return NextResponse.json({ success: false, error: 'Live poster failed' }, { status: 500 });
  }
}
