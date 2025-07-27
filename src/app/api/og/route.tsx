import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { getNFTMetadata } from '../../../lib/nft';
import { fetchNFTDetails } from '../../../lib/firebase';

// Server-safe media URL processing functions (extracted from media.ts)
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/'
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
    const fallbackDescription = searchParams.get('description') || 'Listen to NFTs on PODPLAYR';

    let nftImage = '';
    let nftTitle = fallbackTitle;
    let nftDescription = fallbackDescription;
    
    // Fetch NFT metadata if contract and tokenId are provided
    if (contract && tokenId) {
      try {
        console.log('🔍 Fetching NFT metadata for:', { contract, tokenId });
        
        // First try Firebase cache (same as main app)
        console.log('🔍 Checking Firebase cache...');
        const cachedNFT = await fetchNFTDetails(contract, tokenId);
        if (cachedNFT?.image) {
          nftImage = await processMediaUrlServer(cachedNFT.image);
          nftTitle = cachedNFT.name || fallbackTitle;
          nftDescription = cachedNFT.description || fallbackDescription;
          console.log('✅ Found NFT data in Firebase cache:', {
            image: nftImage,
            title: nftTitle,
            description: nftDescription
          });
        } else {
          console.log('❌ No cached NFT found in Firebase');
          
          // Fallback to Alchemy with both networks (same as main app)
          for (const network of ['ethereum', 'base'] as const) {
            try {
              const nft = await getNFTMetadata(contract, tokenId, network);
              
              console.log(`🔍 NFT metadata for ${network}:`, {
                hasImage: !!nft.image,
                hasMetadataImage: !!nft.metadata?.image,
                name: nft.name,
                description: nft.description,
                imageUrl: nft.image,
                metadataImageUrl: nft.metadata?.image
              });
              
              // Try multiple image sources with proper URL processing
              const imageUrl = nft.image || nft.metadata?.image;
              if (imageUrl) {
                nftImage = await processMediaUrlServer(imageUrl);
                nftTitle = nft.name || nft.metadata?.name || fallbackTitle;
                nftDescription = nft.description || nft.metadata?.description || fallbackDescription;
                console.log('✅ Found NFT data via Alchemy:', {
                  image: nftImage,
                  title: nftTitle,
                  description: nftDescription
                });
                break;
              }
            } catch (error) {
              console.log(`❌ Error with network ${network}:`, (error as Error).message);
            }
          }
        }
        
      } catch (error) {
        console.error('Error fetching NFT metadata:', error);
      }
    }

    return new ImageResponse(
      (
        <div
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, sans-serif',
            color: 'white',
            padding: '40px',
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
          
          <div
            style={{
              fontSize: '72px',
              fontWeight: 'bold',
              marginBottom: '20px',
              textAlign: 'center',
              display: 'flex',
            }}
          >
            🎵 PODPLAYR
          </div>
          <div
            style={{
              fontSize: '36px',
              fontWeight: '600',
              marginBottom: '16px',
              textAlign: 'center',
              maxWidth: '800px',
              display: 'flex',
            }}
          >
            {nftTitle}
          </div>
          <div
            style={{
              fontSize: '24px',
              opacity: 0.8,
              textAlign: 'center',
              maxWidth: '600px',
              display: 'flex',
            }}
          >
            {nftDescription}
          </div>
          {contract && tokenId && (
            <div
              style={{
                fontSize: '18px',
                opacity: 0.6,
                marginTop: '20px',
                fontFamily: 'monospace',
                display: 'flex',
              }}
            >
              {contract.slice(0, 6)}...{contract.slice(-4)} #{tokenId}
            </div>
          )}
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (error) {
    console.error('Error generating image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
