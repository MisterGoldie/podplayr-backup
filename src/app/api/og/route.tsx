import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getNFTMetadata } from '../../../lib/nft';
import { baseAlchemy, ethAlchemy } from '../../../lib/alchemy';

export const runtime = 'edge';

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
        console.log('=== DEBUGGING ALCHEMY API DIRECTLY ===');
        console.log('Original params:', { contract, tokenId });
        
        // Try multiple token ID formats
        const tokenIdFormats = [
          tokenId, // Original
          tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId, // Remove 0x prefix
          tokenId.startsWith('0x') ? parseInt(tokenId, 16).toString() : tokenId, // Convert hex to decimal
        ];
        
        console.log('Trying token ID formats:', tokenIdFormats);
        
        // Try direct Alchemy API calls to see raw response
        for (const network of ['ethereum', 'base']) {
          const client = network === 'base' ? baseAlchemy : ethAlchemy;
          console.log(`\n--- Trying ${network.toUpperCase()} network ---`);
          
          for (const testTokenId of tokenIdFormats) {
            try {
              console.log(`Testing tokenId format: ${testTokenId}`);
              const rawResponse = await client.nft.getNftMetadata(contract, testTokenId);
              
              console.log('RAW ALCHEMY RESPONSE:', {
                tokenId: rawResponse.tokenId,
                tokenType: rawResponse.tokenType,
                title: rawResponse.title,
                description: rawResponse.description,
                rawMetadata: rawResponse.raw?.metadata,
                rawError: rawResponse.raw?.error,
                contract: rawResponse.contract,
                media: rawResponse.media
              });
              
              // Check if we got valid metadata
              if (rawResponse.raw?.metadata && Object.keys(rawResponse.raw.metadata).length > 0) {
                console.log('✅ Found valid metadata!');
                
                // Extract image from raw metadata
                const metadata = rawResponse.raw.metadata;
                nftImage = metadata.image || 
                          metadata.image_url ||
                          metadata.properties?.image ||
                          metadata.properties?.visual?.url ||
                          '';
                          
                console.log('Extracted image URL:', nftImage);
                
                if (nftImage) {
                  break; // Found image, stop trying
                }
              } else {
                console.log('❌ Empty or invalid metadata');
              }
            } catch (error) {
              console.log(`Error with tokenId ${testTokenId}:`, error.message);
            }
          }
          
          if (nftImage) break; // Found image, stop trying networks
        }
        
        console.log('Final image URL:', nftImage);
        
      } catch (error) {
        console.error('Error in direct Alchemy debugging:', error);
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