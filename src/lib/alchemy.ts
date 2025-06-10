import { Alchemy, Network, Nft, NftTokenType } from 'alchemy-sdk';
import type { NFT, NFTFile, NFTMetadata } from '../types/user';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const baseConfig = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
};

const ethConfig = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
};

export const baseAlchemy = new Alchemy(baseConfig);
export const ethAlchemy = new Alchemy(ethConfig);

// Batch size for NFT fetching to avoid rate limits
const BATCH_SIZE = 100;

const processMediaUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.slice(7)}`;
  }
  return url;
};

const isMediaNFT = (metadata: NFTMetadata, animationUrl?: string): { hasAudio: boolean; isVideo: boolean; isAnimation: boolean } => {
  // Common media extensions and content types
  const audioPatterns = [
    /\.(mp3|wav|m4a|aac|ogg)$/i,
    /audio\//i,
    /soundcloud\.com/i,
    /spotify\.com/i,
    /^ar:\/\//i,  // Arweave protocol
    /arweave\.net/i,
    /ipfs/i  // Many audio NFTs are stored on IPFS
  ];
  
  const videoPatterns = [
    /\.(mp4|webm|mov|m4v)$/i,
    /video\//i,
    /youtube\.com/i,
    /vimeo\.com/i
  ];
  
  const animationPatterns = [
    /\.(glb|gltf)$/i,
    /model\//i,
    /animation/i
  ];

  // Function to check if a URL matches any pattern
  const matchesPatterns = (url: string, patterns: RegExp[]) => 
    patterns.some(pattern => pattern.test(url));

  // If we have an animation_url, check it first
  if (animationUrl) {
    const isAudio = audioPatterns.some(pattern => pattern.test(animationUrl));
    const isVid = videoPatterns.some(pattern => pattern.test(animationUrl));
    const isAnim = animationPatterns.some(pattern => pattern.test(animationUrl));
    
    if (isAudio || isVid || isAnim) {
      return { hasAudio: isAudio, isVideo: isVid, isAnimation: isAnim };
    }
  }

  // Function to check if metadata indicates this is a media NFT
  const hasMediaIndicators = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    
    // Check common media-related property names
    const mediaProps = [
      'audio', 'music', 'sound', 'media', 'track', 'song',
      'video', 'animation', 'movie', 'clip'
    ];
    
    return Object.keys(obj).some(key => 
      mediaProps.some(prop => key.toLowerCase().includes(prop))
    );
  };

  // Collect all possible media URLs and sources
  const allUrls = [
    metadata.animation_url,
    metadata.audio,
    metadata.audio_url,
    metadata.uri,
    metadata.properties?.audio,
    metadata.properties?.audio_url,
    metadata.properties?.audio_file,
    metadata.properties?.soundContent?.url,
    metadata.properties?.animation_url,
    metadata.properties?.video,
    metadata.properties?.uri,
    ...(metadata.properties?.files?.map(f => f.uri || f.url) || [])
  ].filter(Boolean) as string[];

  // Check mimeTypes and content types
  const mimeTypes = [
    metadata.mimeType,
    metadata.mime_type,
    metadata.properties?.mimeType,
    metadata.content?.mime,
    ...(metadata.properties?.files?.map(f => f.type || f.mimeType) || [])
  ].filter(Boolean) as string[];

  // Check for media in attributes
  const hasMediaAttributes = Array.isArray(metadata.attributes) && metadata.attributes.some(attr => 
    attr.trait_type?.toLowerCase().includes('audio') ||
    attr.trait_type?.toLowerCase().includes('video') ||
    attr.trait_type?.toLowerCase().includes('media') ||
    (typeof attr.value === 'string' && (
      attr.value.toLowerCase().includes('audio') ||
      attr.value.toLowerCase().includes('video') ||
      attr.value.toLowerCase().includes('media')
    ))
  );

  // Check for media indicators in any metadata properties
  const hasMetadataIndicators = hasMediaIndicators(metadata) || 
                               hasMediaIndicators(metadata.properties);

  const hasAudio = allUrls.some(url => matchesPatterns(url, audioPatterns)) ||
                  mimeTypes.some(type => type?.includes('audio')) ||
                  hasMediaAttributes ||
                  hasMetadataIndicators;

  const isVideo = allUrls.some(url => matchesPatterns(url, videoPatterns)) ||
                 mimeTypes.some(type => type?.includes('video'));

  const isAnimation = allUrls.some(url => matchesPatterns(url, animationPatterns)) ||
                     mimeTypes.some(type => type?.includes('model')) ||
                     metadata.animation_details?.format === 'gltf' ||
                     metadata.animation_details?.format === 'glb';

  // Log detection results for debugging
  if (hasAudio || isVideo || isAnimation) {
    console.log('Media NFT detected:', {
      name: metadata.name,
      urls: allUrls,
      mimeTypes,
      hasMediaAttributes,
      hasMetadataIndicators,
      hasAudio,
      isVideo,
      isAnimation
    });
  }

  return { hasAudio, isVideo, isAnimation };
};

// Generate a unique, random media key for each NFT
const getMediaKey = (url: string) => {
  return uuidv4();
};

export const fetchUserNFTsFromAlchemy = async (address: string): Promise<NFT[]> => {
  console.log('=== START MULTI-NETWORK NFT FETCH ===');
  console.log('Fetching NFTs for address:', address);
  
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    console.error('Alchemy API key is missing! Please set NEXT_PUBLIC_ALCHEMY_API_KEY environment variable.');
    return [];
  }
  
  // Fetch from both networks in parallel
  console.log('Starting parallel fetch from BASE and ETH networks...');
  const [baseNFTs, ethNFTs] = await Promise.all([
    fetchFromNetwork(address, baseAlchemy, 'base'),
    fetchFromNetwork(address, ethAlchemy, 'ethereum')
  ]);

  console.log('BASE network results:', baseNFTs.length, 'NFTs');
  console.log('ETH network results:', ethNFTs.length, 'NFTs');

  // Combine and deduplicate NFTs
  const allNFTs = [...baseNFTs, ...ethNFTs];
  
  // Log media NFT detection stats before deduplication
  const mediaCount = allNFTs.filter(nft => {
    const isAudio = nft.audio || 
                   (nft.metadata?.animation_url && (
                     nft.metadata.animation_url.includes('.mp3') ||
                     nft.metadata.animation_url.includes('.wav') ||
                     nft.metadata.animation_url.includes('audio')
                   ));
    return isAudio;
  }).length;
  
  console.log(`Detected ${mediaCount} media NFTs out of ${allNFTs.length} total NFTs`);
  
  // Deduplicate by contract+tokenId
  const nftMap = new Map<string, NFT>();
  allNFTs.forEach(nft => {
    const key = `${nft.contract}-${nft.tokenId}`;
    if (!nftMap.has(key)) {
      // Generate mediaKey early to ensure consistent processing
      if (nft.audio || nft.metadata?.animation_url) {
        // Ensure mediaKey is assigned for media NFTs
        const audioUrl = nft.audio || nft.metadata?.animation_url;
        if (audioUrl) {
          // Generate mediaKey from the audio URL
          const getMediaKey = (url: string) => {
            const hash = crypto.createHash('md5').update(url).digest('hex');
            return hash;
          };
          nft.mediaKey = getMediaKey(audioUrl);
          console.log(`Generated mediaKey ${nft.mediaKey} for NFT ${nft.contract}-${nft.tokenId}`);
        }
      }
      nftMap.set(key, nft);
    }
  });

  const finalNFTs = Array.from(nftMap.values());
  console.log('=== MULTI-NETWORK FETCH COMPLETE ===');
  console.log(`Total unique NFTs after deduplication: ${finalNFTs.length}`);
  
  // Log final media NFT counts
  const finalMediaCount = finalNFTs.filter(nft => {
    return nft.audio || (nft.metadata?.animation_url && (
      nft.metadata.animation_url.includes('.mp3') ||
      nft.metadata.animation_url.includes('.wav') ||
      nft.metadata.animation_url.includes('audio')
    ));
  }).length;
  
  console.log(`Final media NFT count: ${finalMediaCount} out of ${finalNFTs.length} total NFTs`);
  return finalNFTs;
};

// Helper function to fetch NFTs from a specific network
const fetchFromNetwork = async (address: string, client: Alchemy, network: string): Promise<NFT[]> => {
  console.log(`=== START ${network.toUpperCase()} NFT FETCH ===`);
  console.log(`[${network.toUpperCase()}] Using config:`, {
    network: client.config.network,
    apiKey: client.config.apiKey ? 'Present' : 'Missing'
  });
  try {
    console.log('=== START NFT FETCH ===');
    console.log('Fetching NFTs for address:', address);
    
    // First get the list of NFTs
    const response = await client.nft.getNftsForOwner(address);
    console.log(`[${network.toUpperCase()}] Found total NFTs:`, response.totalCount);
    
    if (response.totalCount === 0) {
      console.log(`[${network.toUpperCase()}] No NFTs found for address`);
      return [];
    }

    console.log(`[${network.toUpperCase()}] Processing NFTs...`);
    // Then fetch full metadata for each NFT
    const nftPromises = response.ownedNfts.map(async (alchemyNft: Nft, index: number) => {
      console.log(`[${network.toUpperCase()}] Processing NFT ${index + 1}/${response.ownedNfts.length}:`, {
        contract: alchemyNft.contract.address,
        tokenId: alchemyNft.tokenId
      });
      try {
        const metadata = await client.nft.getNftMetadata(
          alchemyNft.contract.address,
          alchemyNft.tokenId
        );

        console.log(`[${network.toUpperCase()}] Got metadata for NFT:`, {
          contract: alchemyNft.contract.address,
          tokenId: alchemyNft.tokenId,
          hasRawMetadata: !!metadata.raw.metadata,
          mediaUrls: {
            animation_url: metadata.raw.metadata?.animation_url,
            image: metadata.raw.metadata?.image,
            audio: metadata.raw.metadata?.audio,
            audio_url: metadata.raw.metadata?.audio_url
          }
        });

        // Check if we have any media URLs
        const mediaUrls = {
          animation_url: metadata.raw.metadata?.animation_url,
          image: metadata.raw.metadata?.image,
          audio: metadata.raw.metadata?.audio,
          audio_url: metadata.raw.metadata?.audio_url
        };

        console.log(`[${network.toUpperCase()}] Media URLs for NFT:`, mediaUrls);

        // Get animation URL and process it
        const rawAnimationUrl = metadata.raw.metadata?.animation_url || '';
        const animationUrl = processMediaUrl(rawAnimationUrl) || '';

        // Check for audio in metadata with expanded pattern matching
        const hasAudio = !!(metadata.raw.metadata?.audio || 
          metadata.raw.metadata?.audio_url || 
          (animationUrl && (
            animationUrl.toLowerCase().endsWith('.mp3') ||
            animationUrl.toLowerCase().endsWith('.wav') ||
            animationUrl.toLowerCase().endsWith('.m4a') ||
            animationUrl.toLowerCase().includes('audio/') ||
            animationUrl.toLowerCase().includes('ipfs') ||
            animationUrl.toLowerCase().includes('sound') ||
            animationUrl.toLowerCase().includes('music') ||
            animationUrl.toLowerCase().includes('song') ||
            rawAnimationUrl.toLowerCase().startsWith('ipfs://')
          )) ||
          // Check in other common metadata locations
          metadata.raw.metadata?.name?.toLowerCase().includes('song') ||
          metadata.raw.metadata?.name?.toLowerCase().includes('track') ||
          metadata.raw.metadata?.name?.toLowerCase().includes('audio') ||
          metadata.raw.metadata?.name?.toLowerCase().includes('music'));

        // Check for video in metadata
        const isVideo = !!(animationUrl && (
          animationUrl.toLowerCase().endsWith('.mp4') ||
          animationUrl.toLowerCase().endsWith('.webm') ||
          animationUrl.toLowerCase().endsWith('.mov') ||
          animationUrl.toLowerCase().includes('video/')
        ));

        // Check properties.files if they exist
        const hasMediaInProperties = metadata.raw.metadata?.properties?.files?.some((file: any) => {
          if (!file) return false;
          const fileUrl = (file.uri || file.url || '').toLowerCase();
          const fileType = (file.type || file.mimeType || '').toLowerCase();
          
          return fileUrl.endsWith('.mp3') || 
                fileUrl.endsWith('.wav') || 
                fileUrl.endsWith('.m4a') ||
                fileUrl.endsWith('.mp4') || 
                fileUrl.endsWith('.webm') || 
                fileUrl.endsWith('.mov') ||
                fileType.includes('audio/') ||
                fileType.includes('video/');
        }) ?? false;

        // Check if it has any media indicators in metadata
        const { hasAudio: metadataHasAudio } = isMediaNFT(metadata.raw.metadata || {}, animationUrl);
        
        console.log(`[${network.toUpperCase()}] Media detection for NFT:`, {
          contract: metadata.contract.address,
          tokenId: metadata.tokenId,
          name: metadata.name || metadata.tokenId,
          hasAudio,
          isVideo,
          hasMediaInProperties,
          metadataHasAudio,
          rawAnimationUrl,
          animationUrl
        });

        // Include if it has any media indicators
        if (!hasAudio && !isVideo && !hasMediaInProperties && !metadataHasAudio) {
          return null;
        }

        console.log('Found media NFT:', {
          contract: metadata.contract.address,
          tokenId: metadata.tokenId,
          name: metadata.name || metadata.tokenId,
          animationUrl,
          hasAudio,
          isVideo,
          hasMediaInProperties,
          metadata: metadata.raw.metadata
        });

        // Process image URL
        const rawImageUrl = metadata.raw.metadata?.image || '';
        const imageUrl = processMediaUrl(rawImageUrl) || '';
        
        // Create the NFT object with all necessary fields
        const nft: NFT = {
          contract: metadata.contract.address,
          tokenId: metadata.tokenId,
          name: metadata.name || `#${metadata.tokenId}`,
          description: metadata.description || '',
          image: imageUrl,
          audio: hasAudio ? animationUrl : '',
          animationUrl: isVideo ? animationUrl : undefined,
          hasValidAudio: hasAudio,
          isVideo,
          hasMediaInProperties,
          metadata: metadata.raw.metadata,
          network: network === 'base' ? 'base' : 'ethereum'
        };
        
        // Generate mediaKey for this NFT if it has audio content
        if (hasAudio) {
          // Generate mediaKey from the audio URL
          const getMediaKey = (url: string) => {
            const hash = crypto.createHash('md5').update(url).digest('hex');
            return hash;
          };
          
          const audioUrl = nft.audio || nft.metadata?.animation_url;
          if (audioUrl) {
            nft.mediaKey = getMediaKey(audioUrl);
            console.log(`Generated mediaKey ${nft.mediaKey?.substring(0, 8)}... for NFT ${nft.contract}-${nft.tokenId}`);
          }
        }
        
        return nft;

      } catch (error: any) {
        console.error('Error fetching NFT metadata:', error);
        if (error.toString().includes('500')) {
          console.warn('Alchemy API returned a 500 error - this is likely a temporary issue');
          return [];
        }
        return null;
      }
    });

    const nfts = (await Promise.all(nftPromises)).filter(Boolean) as NFT[];
    console.log(`[${network.toUpperCase()}] Final NFT count:`, {
      total: response.totalCount,
      processed: nftPromises.length,
      mediaNFTs: nfts.length,
      withAudio: nfts.filter(nft => nft.hasValidAudio).length,
      withVideo: nfts.filter(nft => nft.isVideo).length,
      withAnimation: nfts.filter(nft => nft.isAnimation).length
    });

    console.log('Final NFT count:', {
      total: nfts.length,
      withAudio: nfts.filter(nftItem => nftItem.hasValidAudio).length,
      withVideo: nfts.filter(nftItem => nftItem.isVideo).length,
      withAnimation: nfts.filter(nftItem => nftItem.isAnimation).length
    });

    return nfts;

  } catch (error) {
    console.error('Error fetching NFTs from Alchemy:', error);
    return [];
  }
};