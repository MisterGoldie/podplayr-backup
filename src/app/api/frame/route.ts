import { NextRequest } from 'next/server';
import { NotificationStore } from '../../../lib/NotificationStore';
import { getNFTMetadata } from '../../../lib/nft';
import { z } from 'zod';

const appUrl = process.env.NEXT_PUBLIC_URL;

// Validate frame message schema
const frameMessageSchema = z.object({
  untrustedData: z.object({
    fid: z.number(),
    url: z.string(),
    messageHash: z.string(),
    timestamp: z.number(),
    network: z.number(),
    buttonIndex: z.number().optional(),
    castId: z.object({
      fid: z.number(),
      hash: z.string(),
    }),
  }),
  trustedData: z.object({
    messageBytes: z.string(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    // Get frame message
    const body = await req.json();
    const result = frameMessageSchema.safeParse(body);
    
    if (!result.success) {
      console.error('Invalid frame message:', result.error);
      return new Response(JSON.stringify({ error: 'Invalid frame message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const { untrustedData } = result.data;

    // Get contract and tokenId from URL parameters
    const url = new URL(req.url);
    const contract = url.searchParams.get('contract');
    const tokenId = url.searchParams.get('tokenId');

    if (!contract || !tokenId) {
      return new Response(JSON.stringify({ error: 'Missing contract or tokenId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get NFT metadata
    const nft = await getNFTMetadata(contract, tokenId);
    const nftUrl = `${appUrl}/?contract=${contract}&tokenId=${tokenId}`;

    // Store the interaction with FID
    const token = crypto.randomUUID();
    await NotificationStore.create(untrustedData.fid, {
      url: nftUrl,
      token,
      action: 'play'
    });

    // Create frame response
    const frame = {
      version: 'vNext',
      image: nft.image || 
             (nft.metadata && nft.metadata.image) || 
             (nft.metadata && nft.metadata.image_url) || 
             (nft.metadata && nft.metadata.animation_url) ||
             `${appUrl}/api/og?contract=${contract}&tokenId=${tokenId}`,
      title: nft.name || 'PODPLAYR',
      description: nft.description || 'Listen to this NFT on PODPlayr',
      buttons: [{
        label: '▶️ Enter PODPLAYR',
        action: {
          type: 'post_redirect',
          target: nftUrl
        },
      }],
      postUrl: `${appUrl}/api/frame?contract=${contract}&tokenId=${tokenId}`,
    };

    // Return frame response
    return new Response(
      JSON.stringify({
        ...frame,
        // Frame V2 metadata
        'fc:frame': frame.version,
        'fc:frame:image': frame.image,
        'fc:frame:post_url': frame.postUrl,
        'fc:frame:button:1': frame.buttons[0].label,
        'fc:frame:button:1:action': 'post_redirect',
        'fc:frame:button:1:target': frame.buttons[0].action.target,
      }),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        } 
      }
    );
  } catch (error) {
    console.error('Error in frame route:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}