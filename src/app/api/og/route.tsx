import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { getNFTMetadata } from '../../../lib/nft';
import { fetchNFTDetails } from '../../../lib/firebase';
import { getCachedEmbedNft } from '../../../lib/nftEmbedCache';
import { getCachedNftResponse } from '../../../lib/nftResponseCache';
import { firstNonNull } from '../../../lib/nftBootstrap';
import type { NFT } from '../../../types/user';

// Server-safe media URL processing functions (extracted from media.ts)
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
];

const extractIPFSHash = (url: string): string | null => {
  if (!url || typeof url !== 'string') return null;
  
  // Handle ipfs:// protocol
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', '');
  }
  
  // Match IPFS hash patterns
  const ipfsMatch = url.match(/(?:ipfs\/|\/ipfs\/|ipfs:)([a-zA-Z0-9]{46,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{55})/i);
  if (ipfsMatch) {
    return ipfsMatch[1];
  }
  
  return null;
};

const processArweaveUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  
  // If it's already an https://arweave.net URL, return it as is
  if (url.startsWith('https://arweave.net/')) {
    return url;
  }
  
  // If it's not an ar:// URL, return as is
  if (!url.startsWith('ar://')) {
    return url;
  }
  
  try {
    const arPath = url.substring(5); // Remove 'ar://'
    const segments = arPath.split('/');
    
    if (segments.length === 1) {
      const cleanId = segments[0].split('?')[0].split('#')[0];
      return `https://arweave.net/${cleanId}`;
    }
    
    // For multi-segment paths, preserve the structure
    const txId = segments[0];
    const filePath = segments.slice(1).join('/');
    return `https://arweave.net/${txId}/${filePath}`;
  } catch (error) {
    console.error('Error processing Arweave URL:', error);
    return url;
  }
};

const processMediaUrlServer = async (url: string, fallbackUrl: string = '/default-nft.png'): Promise<string> => {
  if (!url) return fallbackUrl;
  
  // For OpenSea CDN URLs that might serve AVIF, convert to a supported format
  if (url.includes('i2.seadn.io') || url.includes('opensea.io')) {
    // Convert OpenSea URLs to use their PNG endpoint
    const convertedUrl = url.replace(/\.(avif|webp)$/i, '.png');
    // Add format parameter to force PNG
    const separator = convertedUrl.includes('?') ? '&' : '?';
    return `${convertedUrl}${separator}format=png`;
  }
  
  // Convert AVIF to PNG/JPG for better compatibility
  if (url.includes('.avif') || url.includes('image/avif')) {
    const convertedUrl = url.replace(/\.avif/g, '.png').replace(/image\/avif/g, 'image/png');
    return convertedUrl;
  }
  
  // Handle IPFS URLs
  if (url.startsWith('ipfs://')) {
    const hash = url.replace('ipfs://', '').replace(/\/*$/, '');
    return `${IPFS_GATEWAYS[0]}${hash}`;
  }
  
  // Try to extract IPFS hash from other formats
  const ipfsHash = extractIPFSHash(url);
  if (ipfsHash) {
    const cleanHash = ipfsHash.replace(/\/*$/, '');
    return `${IPFS_GATEWAYS[0]}${cleanHash}`;
  }
  
  // Handle Arweave URLs
  if (url.startsWith('ar://')) {
    return processArweaveUrl(url);
  }
  
  return url || fallbackUrl;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contract = searchParams.get('contract');
    const tokenId = searchParams.get('tokenId');
    const fallbackTitle = searchParams.get('title') || 'PODPLAYR';
    const fallbackDescription = searchParams.get('description') || 'Experience on PODPLAYR';

    let nftImage = '';
    let nftTitle = fallbackTitle;
    let nftDescription = fallbackDescription;

    if (contract && tokenId) {
      try {
        const applyNft = async (nft: Pick<NFT, 'name' | 'description' | 'image' | 'metadata' | 'collection'> | null) => {
          if (!nft) return false;
          const imageUrl = nft.image || nft.metadata?.image;
          if (!imageUrl && !nft.name) return false;
          if (imageUrl) nftImage = await processMediaUrlServer(imageUrl);
          nftTitle = nft.name || nft.metadata?.name || nft.collection?.name || fallbackTitle;
          nftDescription = nft.description || nft.metadata?.description || fallbackDescription;
          return true;
        };

        const fromEmbed = (await getCachedEmbedNft(contract, tokenId))?.nft;
        if (!(await applyNft(fromEmbed))) {
          const fromFirebase = await fetchNFTDetails(contract, tokenId);
          if (!(await applyNft(fromFirebase))) {
            const fromFullCache = await firstNonNull([
              getCachedNftResponse(contract, tokenId, 'base'),
              getCachedNftResponse(contract, tokenId, 'ethereum'),
            ]);
            if (!(await applyNft(fromFullCache))) {
              const fromChain = await firstNonNull([
                getNFTMetadata(contract, tokenId, 'base')
                  .then((nft) => (nft?.image || nft?.name ? nft : null))
                  .catch(() => null),
                getNFTMetadata(contract, tokenId, 'ethereum')
                  .then((nft) => (nft?.image || nft?.name ? nft : null))
                  .catch(() => null),
              ]);
              await applyNft(fromChain);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching NFT metadata:', error);
      }
    }

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
          'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Error generating image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
