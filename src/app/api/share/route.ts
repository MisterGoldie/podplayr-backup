import { NextRequest } from 'next/server';
import { headers } from 'next/headers';

const appUrl = process.env.NEXT_PUBLIC_URL;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const contract = url.searchParams.get('contract');
    const tokenId = url.searchParams.get('tokenId');

    if (!contract || !tokenId) {
      return new Response('Missing contract or tokenId', { status: 400 });
    }

    // Fetch NFT metadata for the image
    const nftMetadataUrl = `${appUrl}/api/nft?contract=${contract}&tokenId=${tokenId}`;
    const nftResponse = await fetch(nftMetadataUrl);
    const nftData = await nftResponse.json();

    const frameMetadata = {
      version: 'vNext',
      image: nftData.image || nftData.metadata?.image || `${process.env.NEXT_PUBLIC_APP_URL}/og-image.jpg`,
      buttons: [
        {
          label: '▶️ Play on PODPLAYR',
          action: 'post'
        }
      ],
      postUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://yourapp.com'}/api/frame?contract=${contract}&tokenId=${tokenId}`
    };

    return new Response(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>${nftData.name || 'PODPlayr NFT'}</title>
          <meta property="og:title" content="${nftData.name || 'PODPlayr NFT'}" />
          <meta property="og:description" content="${nftData.description || 'Listen to this NFT on PODPlayr'}" />
          <meta property="fc:frame" content="vNext" />
          <meta property="fc:frame:image" content="${frameMetadata.image}" />
          <meta property="fc:frame:button:1" content="${frameMetadata.buttons[0].label}" />
          <meta property="fc:frame:button:1:action" content="post" />
          <meta property="fc:frame:post_url" content="${frameMetadata.postUrl}" />
          <meta property="og:image" content="${frameMetadata.image}" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${nftData.name || 'PODPlayr NFT'}" />
          <meta name="twitter:description" content="${nftData.description || 'Listen to this NFT on PODPlayr'}" />
          <meta name="twitter:image" content="${frameMetadata.image}" />
          <meta http-equiv="refresh" content="0;url=${appUrl}/?contract=${contract}&tokenId=${tokenId}" />
        </head>
        <body>
          <p>Redirecting to PODPLAYR...</p>
        </body>
      </html>`,
      {
        headers: {
          'Content-Type': 'text/html',
        },
      }
    );
  } catch (error) {
    console.error('Error in share route:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
