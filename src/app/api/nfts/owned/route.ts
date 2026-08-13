import { NextRequest, NextResponse } from 'next/server';
import { fetchOwnedNftsFromAlchemy } from '../../../../lib/nft';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.trim() || '';

  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  try {
    let debugInfo: Record<string, unknown> | null = null;
    const nfts = await fetchOwnedNftsFromAlchemy(address, (info) => {
      debugInfo = info;
    });
    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=60',
    };
    if (debugInfo) {
      headers['X-Nft-Debug'] = JSON.stringify(debugInfo).slice(0, 2000);
    }
    return NextResponse.json(nfts, { headers });
  } catch (error) {
    console.error('Error fetching owned NFTs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch NFTs' },
      { status: 500 }
    );
  }
}
