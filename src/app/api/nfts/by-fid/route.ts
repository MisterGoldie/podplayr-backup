import { NextRequest, NextResponse } from 'next/server';
import { fetchUserNFTs } from '../../../../lib/nft';

export async function GET(request: NextRequest) {
  const fidParam = request.nextUrl.searchParams.get('fid');
  const fid = Number(fidParam);

  if (!fidParam || !Number.isInteger(fid) || fid <= 0) {
    return NextResponse.json({ error: 'Invalid fid' }, { status: 400 });
  }

  try {
    const nfts = await fetchUserNFTs(fid);
    return NextResponse.json(nfts, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    console.error('Error fetching NFTs by fid:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch NFTs' },
      { status: 500 }
    );
  }
}
