import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { Alchemy, Network } from 'alchemy-sdk';

export const runtime = 'edge';

// Initialize Alchemy clients directly in this file
const baseAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
});

const ethAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

// Simple media URL processor for Edge Runtime
const processMediaUrl = (url?: string): string => {
  if (!url) return '';
  
  // Handle IPFS URLs
  if (url.startsWith('ipfs://')) {
    return `https://nftstorage.link/ipfs/${url.slice(7)}`;
  }
  
  // Handle Arweave URLs
  if (url.startsWith('ar://')) {
    return `https://arweave.net/${url.slice(5)}`;
  }
  
  // Handle direct Arweave hashes
  if (url.match(/^[a-zA-Z0-9_-]{43}$/)) {
    return `https://arweave.net/${url}`;
  }
  
  return url;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contract = searchParams.get('contract');
    const tokenId = searchParams.get('tokenId');
    const title = searchParams.get('title') || 'PODPLAYR';
    const description = searchParams.get('description') || 'Listen to NFTs on PODPLAYR';

    let nftImage = '';
    
    // Fetch NFT metadata if contract and tokenId are provided
    if (contract && tokenId) {
      try {
        console.log('Fetching NFT metadata for:', { contract, tokenId });
        
        // Improved token ID format handling
        const tokenIdFormats = [];
        
        // If it looks like a hex string (contains letters), convert it
        if (/[a-fA-F]/.test(tokenId)) {
          // Try as hex with 0x prefix
          const hexWithPrefix = tokenId.startsWith('0x') ? tokenId : `0x${tokenId}`;
          try {
            const decimalValue = BigInt(hexWithPrefix).toString();
            tokenIdFormats.push(decimalValue);
            console.log(`Converted hex ${tokenId} to decimal: ${decimalValue}`);
          } catch (e) {
            console.log('Failed to convert hex to decimal:', e);
          }
          
          // For hex strings, also try with 0x prefix
          if (!tokenId.startsWith('0x')) {
            tokenIdFormats.push(`0x${tokenId}`);
          }
        } else {
          // For non-hex strings, try original and with 0x prefix removal
          tokenIdFormats.push(
            tokenId, // Original
            tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId, // Remove 0x prefix
          );
        }
        
        console.log('Trying token ID formats:', tokenIdFormats);
        
        // Try both networks
        for (const network of ['ethereum', 'base']) {
          const client = network === 'base' ? baseAlchemy : ethAlchemy;
          
          for (const testTokenId of tokenIdFormats) {
            try {
              const rawResponse = await client.nft.getNftMetadata(contract, testTokenId);
              
              // Check if we got valid metadata
              if (rawResponse.raw?.metadata && Object.keys(rawResponse.raw.metadata).length > 0) {
                // Extract image from raw metadata
                const metadata = rawResponse.raw.metadata;
                nftImage = processMediaUrl(
                  metadata.image || 
                  metadata.image_url ||
                  metadata.properties?.image ||
                  metadata.properties?.visual?.url
                );
                
                if (nftImage) {
                  console.log('Found NFT image:', nftImage);
                  break; // Found image, stop trying
                }
              }
            } catch (error) {
              console.log(`Error with tokenId ${testTokenId}:`, (error as Error).message);
            }
          }
          
          if (nftImage) break; // Found image, stop trying networks
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
          {/* NFT Image */}
          {nftImage && (
            <div
              style={{
                width: '300px',
                height: '300px',
                borderRadius: '16px',
                overflow: 'hidden',
                marginBottom: '30px',
                display: 'flex',
              }}
            >
              <img
                src={nftImage}
                alt="NFT"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
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
            {title}
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
            {description}
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
    console.error('Error generating OG image:', error);
    return new Response('Failed to generate image', { status: 500 });
  }
}