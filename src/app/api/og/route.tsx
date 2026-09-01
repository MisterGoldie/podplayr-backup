import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { getNFTMetadata } from '../../../lib/nft';
import { fetchNFTDetails } from '../../../lib/firebase';

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
    
    // Fetch NFT metadata if contract and tokenId are provided
    if (contract && tokenId) {
      try {
        
        // First try Firebase cache (same as main app)
        const cachedNFT = await fetchNFTDetails(contract, tokenId);
        if (cachedNFT?.image) {
          nftImage = await processMediaUrlServer(cachedNFT.image);
          nftTitle = cachedNFT.name || fallbackTitle;
          nftDescription = cachedNFT.description || fallbackDescription;
        } else {
          
          // Fallback to Alchemy with both networks (same as main app)
          for (const network of ['ethereum', 'base'] as const) {
            try {
              const nft = await getNFTMetadata(contract, tokenId, network);
              
              
              // Try multiple image sources with proper URL processing
              const imageUrl = nft.image || nft.metadata?.image;
              if (imageUrl) {
                nftImage = await processMediaUrlServer(imageUrl);
                // Use collection name if available, fallback to NFT name, then fallback title
                nftTitle = nft.name || nft.metadata?.name || nft.collection?.name || fallbackTitle;
                nftDescription = nft.description || nft.metadata?.description || fallbackDescription;
                break;
              }
            } catch (error) {
            }
          }
        }
        
      } catch (error) {
        console.error('Error fetching NFT metadata:', error);
      }
    }

    // Long NFT names (some run 60-80+ chars with "(OFFICIAL VIDEO)" suffixes
    // etc) were overlapping the "Experience on PODPLAYR" line below at a
    // fixed 72px — scale the title down as it gets longer so it always
    // wraps to a size that leaves room for what comes after it.
    const titleLength = nftTitle.length;
    const titleFontSize =
      titleLength > 70 ? 36 :
      titleLength > 50 ? 44 :
      titleLength > 32 ? 56 :
      72;

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
            justifyContent: 'center',
            fontFamily: 'Inter, sans-serif',
            color: 'white',
            padding: '40px',
            position: 'relative',
          }}
        >

          {/* NFT Image with proper error handling */}
          {nftImage && (
            <div
              style={{
                width: '300px',
                height: '300px',
                borderRadius: '16px',
                overflow: 'hidden',
                marginBottom: '30px',
                display: 'flex',
                border: '3px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.1)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={nftImage}
                alt="NFT"
                width="300"
                height="300"
                style={{
                  width: '300px',
                  height: '300px',
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
          
          {/* NFT Title - now the largest text right below image */}
          <div
            style={{
              fontSize: `${titleFontSize}px`,
              lineHeight: 1.25,
              fontWeight: 'bold',
              marginBottom: '24px',
              textAlign: 'center',
              maxWidth: '900px',
              display: 'flex',
            }}
          >
            {nftTitle}
          </div>
          
          {/* Always show "Experience on PODPLAYR" below the title */}
          <div
            style={{
              fontSize: '24px',
              opacity: 0.8,
              textAlign: 'center',
              maxWidth: '600px',
              display: 'flex',
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
      }
    );
  } catch (error) {
    console.error('Error generating image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
