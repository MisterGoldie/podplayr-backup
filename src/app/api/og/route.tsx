import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { getNFTMetadata } from '../../../lib/nft';
import { fetchNFTDetails } from '../../../lib/firebase';
import { getCachedEmbedNft } from '../../../lib/nftEmbedCache';
import { getCachedNftResponse } from '../../../lib/nftResponseCache';
import { resolveOgNft } from '../../../lib/ogNftImage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contract = searchParams.get('contract');
    const tokenId = searchParams.get('tokenId');
    const fallbackTitle = searchParams.get('title') || 'PODPLAYR';
    const { image: nftImage, title: nftTitle } = await resolveOgNft(
      contract && tokenId ? [
        async () => [(await getCachedEmbedNft(contract, tokenId))?.nft],
        async () => [await fetchNFTDetails(contract, tokenId)],
        () => Promise.all((['base', 'ethereum'] as const).map((network) =>
          getCachedNftResponse(contract, tokenId, network).catch(() => null))),
        () => Promise.all((['base', 'ethereum'] as const).map((network) =>
          getNFTMetadata(contract, tokenId, network).catch(() => null))),
      ] : [],
      fallbackTitle,
    );

    // Canvas is 1200x800 (Farcaster 3:2). Keep a large square thumbnail
    // and put the same gap between image → title and title → tagline.
    const titleLength = nftTitle.length;
    const titleFontSize =
      titleLength > 70 ? 32 :
      titleLength > 50 ? 36 :
      titleLength > 32 ? 42 :
      48;
    const thumb = 520;
    const gap = 40;

    return new ImageResponse(
      (
        <div
          style={{
            background: 'linear-gradient(to bottom, #1E1525 0%, #2D1B69 50%, #4B0082 100%)',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            fontFamily: 'Inter, sans-serif',
            color: 'white',
            padding: '76px 48px 28px 48px',
            position: 'relative',
          }}
        >

          {/* NFT Image with proper error handling */}
          {nftImage && (
            <div
              style={{
                width: `${thumb}px`,
                height: `${thumb}px`,
                borderRadius: '24px',
                overflow: 'hidden',
                display: 'flex',
                flexShrink: 0,
                boxSizing: 'border-box',
                border: '4px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.1)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={nftImage}
                alt="NFT"
                width={thumb}
                height={thumb}
                style={{
                  width: `${thumb}px`,
                  height: `${thumb}px`,
                  objectFit: 'cover',
                }}
              />
            </div>
          )}
          
          {/* Debug info when no image found */}
          {!nftImage && contract && tokenId && (
            <div
              style={{
                fontSize: '16px',
                opacity: 0.7,
                marginBottom: '20px',
                textAlign: 'center',
                display: 'flex',
              }}
            >
              🖼️ No image found for this NFT
            </div>
          )}

          <div
            style={{
              display: 'flex',
              width: '100%',
              height: `${gap}px`,
              fontSize: `${gap}px`,
              lineHeight: 1,
              color: 'transparent',
              flexShrink: 0,
            }}
          >
            .
          </div>

          <div
            style={{
              fontSize: `${titleFontSize}px`,
              lineHeight: 1.15,
              fontWeight: 'bold',
              textAlign: 'center',
              maxWidth: '1100px',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            {nftTitle}
          </div>

          <div
            style={{
              display: 'flex',
              width: '100%',
              height: `${gap}px`,
              fontSize: `${gap}px`,
              lineHeight: 1,
              color: 'transparent',
              flexShrink: 0,
            }}
          >
            .
          </div>

          <div
            style={{
              fontSize: '28px',
              opacity: 0.8,
              textAlign: 'center',
              maxWidth: '720px',
              display: 'flex',
              flexShrink: 0,
            }}
          >
            Experience on PODPLAYR
          </div>
        </div>
      ),
      {
        // Farcaster Mini App embeds require a strict 3:2 image ratio — at
        // 1200x630 (~1.91:1) Warpcast center-crops the sides to force 3:2,
        // and it also just left less vertical room, which was part of why
        // long titles ran into the text below them.
        width: 1200,
        height: 800,
        headers: {
          'Cache-Control': nftImage
            ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400'
            : 'public, max-age=60, s-maxage=60',
        },
      }
    );
  } catch (error) {
    console.error('Error generating image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
