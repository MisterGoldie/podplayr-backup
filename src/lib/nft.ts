import type { NFT } from '../types/user';
import { Alchemy, Network } from 'alchemy-sdk';
import { processMediaUrl, getMediaKey } from '../utils/media';
import {
  hasPlayableAudio,
  isPlayableMediaNFT,
  getNftPlaybackPlan,
} from '../utils/isMediaNFT';

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

    const rawMeta = metadata.raw.metadata || {};
    const plan = getNftPlaybackPlan({ metadata: rawMeta });
    const soundRaw = plan.audioUrl || plan.videoUrl || '';
    const audioUrl = processMediaUrl(soundRaw, '', 'audio');
    const videoUrl = plan.videoUrl ? processMediaUrl(plan.videoUrl, '', 'audio') : '';
    const imageUrl = processMediaUrl(
      rawMeta.image ||
      rawMeta.image_url ||
      rawMeta.properties?.image ||
      rawMeta.properties?.visual?.url ||
      metadata.contract?.openSeaMetadata?.imageUrl ||
      '',
      '',
      'image'
    );

    // Ensure contract address is lowercase
    const contractAddress = metadata.contract.address.toLowerCase();
    const formattedTokenId = metadata.tokenId.toString().replace(/^0x/, '');

    const nft: NFT = {
      contract: contractAddress,
      tokenId: formattedTokenId,
      name: rawMeta.name || `NFT #${formattedTokenId}`,
      description: metadata.description || rawMeta.description || '',
      image: imageUrl || '',
      audio: audioUrl || '',
      videoUrl: videoUrl || undefined,
      playbackMode: plan.mode,
      hasValidAudio: Boolean(audioUrl) || hasPlayableAudio({ audio: audioUrl, metadata: rawMeta }),
      isVideo: plan.mode !== 'audio-only',
      network,
      collection: {
        name: metadata.contract?.name || '',
        image: metadata.contract?.openSeaMetadata?.imageUrl || ''
      },
      metadata: {
        ...rawMeta,
        image: imageUrl || '',
        // Preserve original animation_url; don't overwrite with audio-only pick
        animation_url: rawMeta.animation_url || plan.videoUrl || plan.audioUrl || '',
        audio: rawMeta.audio || (plan.mode === 'video-plus-audio' ? plan.audioUrl : rawMeta.audio) || undefined,
      }
    };

    if (nft.hasValidAudio || nft.isVideo) {
      nft.mediaKey = getMediaKey(nft);
    }

    return nft;
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
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

    console.log('📦 ETH Network NFTs:', {
      count: ethData.ownedNfts?.length || 0,
      sampleNFT: ethData.ownedNfts?.[0]?.contract?.address
    });
    console.log('📦 BASE Network NFTs:', {
      count: baseData.ownedNfts?.length || 0,
      sampleNFT: baseData.ownedNfts?.[0]?.contract?.address
    });

    const ownedNfts = [...(ethData.ownedNfts || []), ...(baseData.ownedNfts || [])];
    console.log(`✨ Combined NFTs for ${address}:`, {
      total: ownedNfts.length,
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
          files?: any[];
          video?: string;
          animation_url?: string;
        };
        content?: {
          mime?: string;
        };
      };
    }

    const mapAlchemyNft = (nft: AlchemyNFT, network: 'ethereum' | 'base'): NFT | null => {
        const meta = nft.metadata || {};
        const plan = getNftPlaybackPlan({ metadata: meta });
        const soundRaw = plan.audioUrl || plan.videoUrl || '';
        const audioUrl = processMediaUrl(soundRaw, '', 'audio');
        const videoUrl = plan.videoUrl ? processMediaUrl(plan.videoUrl, '', 'audio') : '';
        const imageUrl = processMediaUrl(
          meta.image ||
          meta.image_url ||
          meta.properties?.image ||
          meta.properties?.visual?.url ||
          '',
          '',
          'image'
        );

        const tokenId = nft.id?.tokenId?.toString()?.replace(/^0x/, '');
        if (!tokenId) {
          console.warn('Missing tokenId for NFT:', nft);
          return null;
        }

        const candidate = {
          audio: plan.audioUrl || audioUrl,
          animationUrl: plan.videoUrl || meta.animation_url,
          metadata: meta,
        };

        const hasAudio = Boolean(soundRaw) || hasPlayableAudio(candidate);
        const isVideo = plan.mode !== 'audio-only';

        const processedNFT: NFT = {
          contract: nft.contract.address.toLowerCase(),
          tokenId,
          name: meta.name || `NFT #${tokenId}`,
          description: meta.description || '',
          image: imageUrl || '',
          animationUrl: plan.videoUrl || audioUrl || '',
          audio: audioUrl || '',
          videoUrl: videoUrl || undefined,
          playbackMode: plan.mode,
          hasValidAudio: hasAudio,
          isVideo,
          isAnimation: false,
          network,
          collection: {
            image: nft.contract.openSea?.imageUrl,
            name: nft.contract.name || ''
          },
          metadata: {
            ...meta,
            image: imageUrl || '',
            animation_url: meta.animation_url || plan.videoUrl || plan.audioUrl || '',
            audio:
              meta.audio ||
              meta.audio_url ||
              (plan.mode === 'video-plus-audio' ? plan.audioUrl || undefined : meta.audio),
          }
        };

        if (hasAudio || isVideo) {
          processedNFT.mediaKey = getMediaKey(processedNFT);
        }

        return processedNFT;
    };

    const processedNFTs = [
      ...((ethData.ownedNfts || []) as AlchemyNFT[]).map((nft) => mapAlchemyNft(nft, 'ethereum')),
      ...((baseData.ownedNfts || []) as AlchemyNFT[]).map((nft) => mapAlchemyNft(nft, 'base')),
    ].filter((nft): nft is NFT => !!nft && isPlayableMediaNFT(nft));

    return processedNFTs.map((nft) => ({
      ...nft,
      contract: nft.contract.toLowerCase(),
      tokenId: nft.tokenId.toString().replace(/^0x/, ''),
      image: nft.image || '',
      animationUrl: nft.videoUrl || nft.audio || nft.animationUrl || '',
      audio: nft.audio || '',
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
