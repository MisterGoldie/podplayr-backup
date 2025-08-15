import { Alchemy, Network } from 'alchemy-sdk';
import type { NFT } from '../types/user';
import { getMediaKey } from '../utils/media';

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

// Circuit breaker state
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000;
let circuitBreakerUntil = 0;

const isCircuitBreakerOpen = () => Date.now() < circuitBreakerUntil;

const recordError = () => {
  consecutiveErrors++;
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
  }
};

const recordSuccess = () => {
  consecutiveErrors = 0;
  circuitBreakerUntil = 0;
};

const processMediaUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('ar://')) {
    return `https://arweave.net/${url.slice(5)}`;
  }
  return url;
};

// Simplified media detection with early returns for better performance
const isMediaNFT = (metadata: any, animationUrl?: string): boolean => {
  if (!metadata) return false;

  console.log('🔍 Checking NFT for media content:', {
    name: metadata.name,
    audio: metadata.audio,
    audio_url: metadata.audio_url,
    animation_url: metadata.animation_url,
    animationUrl,
    properties: metadata.properties
  });

  // Quick audio checks first (most common)
  if (metadata.audio || metadata.audio_url) return true;
  if (animationUrl?.match(/\.(mp3|wav|m4a|aac|ogg)$/i)) return true;
  if (animationUrl?.includes('audio') || animationUrl?.startsWith('ar://')) return true;
  
  // Quick video checks
  if (animationUrl?.match(/\.(mp4|webm|mov|m4v)$/i)) return true;
  if (animationUrl?.includes('video')) return true;
  
  // Enhanced IPFS and Arweave support
  if (animationUrl?.includes('ipfs') || animationUrl?.includes('arweave.net')) return true;
  
  // Name-based checks (last resort)
  const name = metadata.name?.toLowerCase();
  if (name?.includes('music') || name?.includes('song') || name?.includes('audio')) return true;
  
  // Enhanced properties check
  if (metadata.properties?.files?.some((f: any) => {
    const fileUrl = (f.uri || f.url || '').toLowerCase();
    const fileType = (f.type || f.mimeType || '').toLowerCase();
    return fileUrl.endsWith('.mp3') || 
           fileUrl.endsWith('.wav') || 
           fileUrl.endsWith('.m4a') ||
           fileUrl.endsWith('.mp4') || 
           fileUrl.endsWith('.webm') || 
           fileUrl.endsWith('.mov') ||
           fileType.includes('audio/') ||
           fileType.includes('video/') ||
           fileUrl.includes('ipfs') ||
           fileUrl.includes('arweave');
  })) return true;

  // Check for animation_url with broader criteria
  if (metadata.animation_url && (
    metadata.animation_url.toLowerCase().includes('.mp3') ||
    metadata.animation_url.toLowerCase().includes('.wav') ||
    metadata.animation_url.toLowerCase().includes('.m4a') ||
    metadata.animation_url.toLowerCase().includes('.mp4') ||
    metadata.animation_url.toLowerCase().includes('.webm') ||
    metadata.animation_url.toLowerCase().includes('.mov') ||
    metadata.animation_url.toLowerCase().includes('audio/') ||
    metadata.animation_url.toLowerCase().includes('video/') ||
    metadata.animation_url.toLowerCase().includes('ipfs')
  )) return true;

  return false;
};

// Request deduplication
const activeRequests = new Map<string, Promise<NFT[]>>();

const fetchFromNetwork = async (address: string, client: Alchemy, network: string): Promise<NFT[]> => {
  if (isCircuitBreakerOpen()) {
    return [];
  }

  try {
    const response = await client.nft.getNftsForOwner(address);
    if (response.totalCount === 0) return [];

    const mediaNFTs: NFT[] = [];
    
    // Process in smaller batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < response.ownedNfts.length; i += batchSize) {
      const batch = response.ownedNfts.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (alchemyNft) => {
        try {
          const fullNft = await client.nft.getNftMetadata(
            alchemyNft.contract.address,
            alchemyNft.tokenId
          );
          // Fix: Properly construct metadata object with correct TypeScript types
          const metadata = {
            ...fullNft.raw?.metadata,
            // Try multiple possible locations for animation_url
            animation_url: fullNft.raw?.metadata?.animation_url || 
                          (fullNft.raw as any)?.animation_url ||
                          (fullNft as any)?.media?.[0]?.gateway,
            animationUrl: fullNft.raw?.metadata?.animationUrl || 
                         (fullNft.raw as any)?.animationUrl,
            audio: fullNft.raw?.metadata?.audio,
            audio_url: fullNft.raw?.metadata?.audio_url,
            properties: fullNft.raw?.metadata?.properties || 
                       (fullNft.raw as any)?.attributes,
            name: fullNft.raw?.metadata?.name || 
                 (fullNft as any)?.title ||
                 fullNft.name,
            image: fullNft.raw?.metadata?.image || fullNft.image?.cachedUrl
          };
          return { alchemyNft, metadata };
        } catch {
          return { alchemyNft, metadata: null };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const { alchemyNft, metadata } of batchResults) {
        if (!metadata) continue;

        const animationUrl = processMediaUrl(metadata.animation_url);
        if (!isMediaNFT(metadata, animationUrl)) continue;

        const hasAudio = !!(metadata.audio || 
          metadata.audio_url || 
          animationUrl?.match(/\.(mp3|wav|m4a|aac|ogg)$/i) ||
          animationUrl?.includes('audio') ||
          metadata.name?.toLowerCase().includes('music'));

        const isVideo = !!(animationUrl?.match(/\.(mp4|webm|mov|m4v)$/i) ||
          animationUrl?.includes('video'));

        const nft: NFT = {
          contract: alchemyNft.contract.address,
          tokenId: alchemyNft.tokenId,
          name: alchemyNft.name || `#${alchemyNft.tokenId}`,
          description: alchemyNft.description || '',
          image: processMediaUrl(metadata.image) || '',
          audio: hasAudio ? animationUrl || '' : '',
          animationUrl: isVideo ? animationUrl : undefined,
          hasValidAudio: hasAudio,
          isVideo,
          metadata,
          network: network === 'base' ? 'base' : 'ethereum'
        };

        if (hasAudio) {
          nft.mediaKey = getMediaKey(nft);
        }

        mediaNFTs.push(nft);
      }
      
      // Small delay between batches
      if (i + batchSize < response.ownedNfts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    recordSuccess();
    return mediaNFTs;

  } catch (error) {
    recordError();
    return [];
  }
};

export const fetchUserNFTsFromAlchemy = async (address: string): Promise<NFT[]> => {
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    return [];
  }

  // Request deduplication
  const key = address.toLowerCase();
  if (activeRequests.has(key)) {
    console.log('🔄 Reusing existing request for:', address);
    return activeRequests.get(key)!;
  }

  const promise = (async () => {
    const [baseNFTs, ethNFTs] = await Promise.allSettled([
      fetchFromNetwork(address, baseAlchemy, 'base'),
      fetchFromNetwork(address, ethAlchemy, 'ethereum')
    ]);

    const allNFTs = [
      ...(baseNFTs.status === 'fulfilled' ? baseNFTs.value : []),
      ...(ethNFTs.status === 'fulfilled' ? ethNFTs.value : [])
    ];

    // Deduplicate
    const nftMap = new Map<string, NFT>();
    allNFTs.forEach(nft => {
      const key = `${nft.contract}-${nft.tokenId}`;
      if (!nftMap.has(key)) {
        nftMap.set(key, nft);
      }
    });

    return Array.from(nftMap.values());
  })();

  activeRequests.set(key, promise);
  
  // Clean up after completion
  promise.finally(() => {
    setTimeout(() => activeRequests.delete(key), 5000);
  });

  return promise;
};

export { isCircuitBreakerOpen, recordError, recordSuccess };