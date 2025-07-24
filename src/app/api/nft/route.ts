import { NextRequest, NextResponse } from 'next/server';
import { getNFTMetadata } from '../../../lib/nft';

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

    console.log(`Fetching NFT metadata for contract: ${contract}, tokenId: ${tokenId}, network: ${network}`);
    
    const nftData = await getNFTMetadata(contract, tokenId, network);
    
    return NextResponse.json(nftData, {
      headers: {
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
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