import type { NFT } from '../types/user';
import { Alchemy, Network } from 'alchemy-sdk';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Alchemy clients for both networks
const ethAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET
});

const baseAlchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET
});

export const getNFTMetadata = async (contract: string, tokenId: string, network: 'base' | 'ethereum' = 'ethereum'): Promise<NFT> => {
  try {
    const client = network === 'base' ? baseAlchemy : ethAlchemy;
    
    // Handle different tokenId formats - try multiple formats like the OpenGraph API does
    const tokenIdFormats = [];
    
    // If tokenId contains hex characters, try converting to decimal
    if (/[a-fA-F]/.test(tokenId)) {
      const hexWithPrefix = tokenId.startsWith('0x') ? tokenId : `0x${tokenId}`;
      try {
        const decimalValue = BigInt(hexWithPrefix).toString();
        tokenIdFormats.push(decimalValue);
      } catch (e) {
        console.log('Failed to convert hex to decimal:', e);
      }
      
      // Also try with 0x prefix if not already present
      if (!tokenId.startsWith('0x')) {
        tokenIdFormats.push(`0x${tokenId}`);
      }
    } else {
      // For non-hex tokenIds, try as-is and with/without 0x prefix
      tokenIdFormats.push(
        tokenId,
        tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId,
      );
    }
    
    let metadata;
    let lastError;
    
    // Try each tokenId format until one works
    for (const testTokenId of tokenIdFormats) {
      try {
        metadata = await client.nft.getNftMetadata(contract, testTokenId);
        console.log(`✅ Successfully fetched metadata with tokenId format: ${testTokenId}`);
        break;
      } catch (error) {
        console.log(`❌ Failed with tokenId format ${testTokenId}:`, (error as Error).message);
        lastError = error;
      }
    }
    
    if (!metadata) {
      throw lastError || new Error('Failed to fetch metadata with any tokenId format');
    }

    // Process media URLs
    const audioUrl = processMediaUrl(
      metadata.raw.metadata?.animation_url ||
      metadata.raw.metadata?.audio ||
      metadata.raw.metadata?.audio_url ||
      metadata.raw.metadata?.properties?.audio ||
      metadata.raw.metadata?.properties?.audio_url ||
      metadata.raw.metadata?.properties?.audio_file ||
      metadata.raw.metadata?.properties?.soundContent?.url
    );

    // Around line 70-80, update the imageUrl processing:
    const imageUrl = processMediaUrl(
      metadata.raw.metadata?.image ||
      metadata.raw.metadata?.image_url ||
      metadata.raw.metadata?.properties?.image ||
      metadata.raw.metadata?.properties?.visual?.url ||
      metadata.contract?.openSeaMetadata?.imageUrl  // ADD THIS LINE!
    );

    // Ensure contract address is lowercase
    const contractAddress = metadata.contract.address.toLowerCase();
    const formattedTokenId = metadata.tokenId.toString().replace(/^0x/, '');

    return {
      contract: contractAddress,
      tokenId: formattedTokenId,
      name: metadata.raw.metadata?.name || `NFT #${formattedTokenId}`,
      description: metadata.description || metadata.raw.metadata?.description || '',
      image: imageUrl || '',
      audio: audioUrl || '',
      hasValidAudio: !!audioUrl,
      metadata: {
        ...metadata.raw.metadata,
        image: imageUrl || '',
        animation_url: audioUrl || ''
      }
    };
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
};

const processMediaUrl = (url: string | undefined): string => {
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

export const fetchUserNFTsFromAlchemy = async (address: string): Promise<NFT[]> => {
  try {
    console.log('\n🔍 Fetching NFTs for address:', address);
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyKey) throw new Error('Alchemy API key not found');

    console.log('🌐 Starting parallel fetch from ETH and BASE networks...');
    
    // Fetch from both networks
    const [ethResponse, baseResponse] = await Promise.all([
      fetch(
        `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`,
        { headers: { accept: 'application/json' } }
      ),
      fetch(
        `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`,
        { headers: { accept: 'application/json' } }
      )
    ]);

    // Check responses
    console.log('📡 Network Response Status:', {
      ethereum: ethResponse.status,
      base: baseResponse.status
    });

    if (!ethResponse.ok || !baseResponse.ok) {
      const errorText = await ((!ethResponse.ok ? ethResponse : baseResponse).text());
      throw new Error(`Alchemy API error: ${errorText}`);
    }

    const [ethData, baseData] = await Promise.all([
      ethResponse.json(),
      baseResponse.json()
    ]);

    // Log raw data from both networks
    console.log('📦 ETH Network NFTs:', {
      count: ethData.ownedNfts?.length || 0,
      sampleNFT: ethData.ownedNfts?.[0]?.contract?.address
    });
    console.log('📦 BASE Network NFTs:', {
      count: baseData.ownedNfts?.length || 0,
      sampleNFT: baseData.ownedNfts?.[0]?.contract?.address
    });

    const data = {
      ownedNfts: [...(ethData.ownedNfts || []), ...(baseData.ownedNfts || [])]
    };
    console.log(`✨ Combined NFTs for ${address}:`, {
      total: data.ownedNfts?.length || 0,
      fromEth: ethData.ownedNfts?.length || 0,
      fromBase: baseData.ownedNfts?.length || 0
    });

    interface AlchemyNFT {
      contract: {
        address: string;
        name?: string;
        openSea?: {
          imageUrl?: string;
        };
      };
      id: {
        tokenId: string;
      };
      title?: string;
      description?: string;
      metadata?: {
        name?: string;
        description?: string;
        image?: string;
        image_url?: string;
        animation_url?: string;
        audio?: string;
        audio_url?: string;
        mimeType?: string;
        mime_type?: string;
        properties?: {
          audio?: string;
          audio_url?: string;
          audio_file?: string;
          image?: string;
          visual?: { url?: string };
          soundContent?: { url?: string };
          mimeType?: string;
        };
        content?: {
          mime?: string;
        };
      };
    }

    // Process NFTs to identify audio content
    const processedNFTs = (data.ownedNfts || [] as AlchemyNFT[])
      .map((nft: AlchemyNFT) => {
      const audioUrl = processMediaUrl(
        nft.metadata?.animation_url ||
        nft.metadata?.audio ||
        nft.metadata?.audio_url ||
        nft.metadata?.properties?.audio ||
        nft.metadata?.properties?.audio_url ||
        nft.metadata?.properties?.audio_file ||
        nft.metadata?.properties?.soundContent?.url
      );

      const imageUrl = processMediaUrl(
        nft.metadata?.image ||
        nft.metadata?.image_url ||
        nft.metadata?.properties?.image ||
        nft.metadata?.properties?.visual?.url
      );

      // Check if it's a video/animation based on MIME type or file extension
      const mimeType = nft.metadata?.mimeType || 
                      nft.metadata?.mime_type || 
                      nft.metadata?.properties?.mimeType ||
                      nft.metadata?.content?.mime;

      const isVideo = audioUrl && (
        mimeType?.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v)$/i.test(audioUrl)
      );

      const isAnimation = audioUrl && (
        mimeType?.startsWith('model/') ||
        /\.(glb|gltf)$/i.test(audioUrl)
      );

      // Ensure tokenId is a string and properly formatted
      const tokenId = nft.id?.tokenId?.toString()?.replace(/^0x/, '');
      if (!tokenId) {
        console.warn('Missing tokenId for NFT:', nft);
        return null;
      }
      
      // Log NFT details for debugging
      console.log('Processing NFT:', {
        contract: nft.contract.address,
        tokenId,
        name: nft.metadata?.name,
        audioUrl,
        imageUrl
      });

      const processedNFT: NFT = {
        contract: nft.contract.address.toLowerCase(),
        tokenId: tokenId,
        name: nft.metadata?.name || `NFT #${tokenId}`,
        description: nft.metadata?.description || '',
        image: imageUrl || '',
        animationUrl: audioUrl || '',
        audio: audioUrl || '',
        hasValidAudio: !!audioUrl,
        isVideo,
        isAnimation,
        collection: {
          image: nft.contract.openSea?.imageUrl,
          name: nft.contract.name || ''
        },
        metadata: nft.metadata
      } as NFT;
      return processedNFT;
    }).filter((nft: NFT | null): nft is NFT => {
      if (!nft) return false;
      console.log('Filtering NFT:', {
        contract: nft.contract,
        tokenId: nft.tokenId,
        hasValidAudio: nft.hasValidAudio,
        audio: nft.audio
      });
      return nft.hasValidAudio === true;
    });

    return processedNFTs.map((nft: NFT) => ({
      ...nft,
      // Ensure contract and tokenId are properly formatted
      contract: nft.contract.toLowerCase(),
      tokenId: nft.tokenId.toString().replace(/^0x/, ''),
      // Ensure all required fields have values
      image: nft.image || '',
      animationUrl: nft.audio || '',
      audio: nft.audio || '',
      hasValidAudio: true as const
    }));
  } catch (error) {
    console.error(`Error fetching NFTs for address ${address}:`, error);
    return [];
  }
};

export const fetchUserNFTs = async (fid: number): Promise<NFT[]> => {
  try {
    console.log('🚀 === START NFT FETCH FOR FID:', fid, '===');

    // Get user profile from Neynar for verified addresses
    const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY;
    if (!neynarKey) throw new Error('Neynar API key not found');

    console.log('📡 Fetching user profile from Neynar...');
    const profileResponse = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': neynarKey
        }
      }
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      throw new Error(`Failed to fetch user profile: ${errorText}`);
    }

    const profileData = await profileResponse.json();
    console.log('👤 Raw Neynar Profile Data:', JSON.stringify(profileData, null, 2));
    
    let allAddresses: string[] = [];

    // Get verified addresses
    console.log('🔍 Checking verified addresses...');
    if (profileData.users?.[0]?.verifications) {
      console.log('✅ Found verified addresses:', profileData.users[0].verifications);
      allAddresses = [...profileData.users[0].verifications];
    } else {
      console.log('⚠️ No verified addresses found in profile');
    }

    // Get custody address
    console.log('🔍 Checking custody address...');
    if (profileData.users?.[0]?.custody_address) {
      console.log('✅ Found custody address:', profileData.users[0].custody_address);
      allAddresses.push(profileData.users[0].custody_address);
    } else {
      console.log('⚠️ No custody address found in profile');
    }

    // Filter addresses
    allAddresses = [...new Set(allAddresses)].filter(addr => {
      const isValid = addr && addr.startsWith('0x') && addr.length === 42;
      if (!isValid) {
        console.log('⚠️ Invalid address found:', addr);
      }
      return isValid;
    });

    if (allAddresses.length === 0) {
      throw new Error('No valid addresses found for this user');
    }

    console.log('📋 Valid addresses found:', allAddresses);

    // Process addresses sequentially
    const allNFTs: NFT[] = [];
    
    for (let i = 0; i < allAddresses.length; i++) {
      const address = allAddresses[i];
      console.log(`\n🔄 Processing address ${i + 1}/${allAddresses.length}:`, address);
      
      try {
        const nfts = await fetchUserNFTsFromAlchemy(address);
        console.log(`✨ NFTs found for address ${address}:`, {
          total: nfts.length,
          audio: nfts.filter(nft => nft.hasValidAudio).length,
          video: nfts.filter(nft => nft.isVideo).length,
          animation: nfts.filter(nft => nft.isAnimation).length
        });
        allNFTs.push(...nfts);
        
        if (i < allAddresses.length - 1) {
          console.log('⏳ Waiting 2 seconds before next address...');
          await delay(2000);
        }
      } catch (error) {
        console.error(`❌ Error processing address ${address}:`, error);
      }
    }

    console.log('\n📊 Final NFT Collection Summary:', {
      totalNFTs: allNFTs.length,
      byType: {
        audio: allNFTs.filter(nft => nft.hasValidAudio).length,
        video: allNFTs.filter(nft => nft.isVideo).length,
        animation: allNFTs.filter(nft => nft.isAnimation).length
      }
    });
    return allNFTs;

  } catch (error) {
    console.error('❌ NFT fetch error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error
    });
    throw error;
  } finally {
    console.log('🏁 === END NFT FETCH ===');
  }
};
