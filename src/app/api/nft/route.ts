import { NextRequest, NextResponse } from 'next/server';
import { getNFTMetadata, isOnChainNftIdentity, nftNeedsChainMediaEnrich } from '../../../lib/nft';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contract = searchParams.get('contract');
    const tokenId = searchParams.get('tokenId');
    const network = searchParams.get('network') as 'base' | 'ethereum' || 'ethereum';

    if (!contract || !tokenId) {
      return NextResponse.json(
        { error: 'Missing contract or tokenId parameters' },
        { status: 400 }
      );
    }

    if (!isOnChainNftIdentity(contract, tokenId)) {
      return NextResponse.json(
        { error: 'Invalid contract or tokenId' },
        { status: 400 }
      );
    }

    const nftData = await getNFTMetadata(contract, tokenId, network);

    // True when playback still depends on a signed Mux mezzanine link or a
    // public IPFS gateway — those genuinely expire/go down over time, so an
    // embed resolving to one today is not guaranteed to still play tomorrow.
    const fragile = nftNeedsChainMediaEnrich(nftData);

    const playbackRefresh = request.nextUrl.searchParams.get('playback') === '1';
    return NextResponse.json({ ...nftData, fragile }, {
      headers: {
        'Cache-Control': playbackRefresh ? 'private, no-store' : 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error fetching NFT data:', error);
    
    return NextResponse.json(
      { 
        error: {
          message: 'Error fetching nft data',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}