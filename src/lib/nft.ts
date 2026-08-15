import type { NFT } from '../types/user';
import { Alchemy, Network } from 'alchemy-sdk';
import { createHash } from 'crypto';
import { rewriteLegacyOpenSeaMediaUrl } from '../utils/openSeaMedia';
import {
  hasPlayableAudio,
  isPlayableMediaNFT,
  getNftPlaybackPlan,
} from '../utils/isMediaNFT';

const PINATA_IPFS = 'https://gateway.pinata.cloud/ipfs/';

/** Server-safe URL rewrite — do not import processMediaUrl (client module). */
function processMediaUrlServer(
  url: string,
  _fallback: string = '',
  _mediaType: 'image' | 'audio' | 'metadata' = 'image'
): string {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('ipfs://')) {
    return `${PINATA_IPFS}${url.slice(7).replace(/^ipfs\//, '')}`;
  }
  if (url.startsWith('ar://')) {
    return `https://arweave.net/${url.slice(5)}`;
  }
  return url.replace(/\/ipfs\/ipfs\//g, '/ipfs/');
}

/** Server-safe URL rewrite. `processMediaUrl` lives in a client module and throws in API routes. */
function normalizeOwnedNftUrl(url: string): string {
  return processMediaUrlServer(url);
}

function ownedNftMediaKey(contract: string, tokenId: string): string {
  const normalizedTokenId = tokenId?.toString().replace(/^0x+/, '0x') || '';
  return createHash('sha256')
    .update(`${contract}-${normalizedTokenId}`)
    .digest('hex')
    .substring(0, 32);
}

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
    const alchemyImage = metadata as {
      image?: { cachedUrl?: string; originalUrl?: string; contentType?: string };
      animation?: { cachedUrl?: string; originalUrl?: string; contentType?: string };
    };
    // Alchemy CDN survives when public IPFS gateways 404/hang (Immutable Spirit).
    const alchemyImageCached = alchemyImage.image?.cachedUrl || '';
    const alchemyAnimCached = alchemyImage.animation?.cachedUrl || '';
    const alchemyAnimOriginal = alchemyImage.animation?.originalUrl || '';
    const alchemyAnimType = (alchemyImage.animation?.contentType || '').toLowerCase();

    const alchemyAnimation = alchemyAnimCached || alchemyAnimOriginal || '';
    const mergedMeta = {
      ...rawMeta,
      // Prefer Alchemy CDN for playback; keep original IPFS as secondary via image fields.
      animation_url: alchemyAnimCached || rawMeta.animation_url || alchemyAnimOriginal || '',
      image: alchemyImageCached || rawMeta.image || '',
      image_url: rawMeta.image_url || alchemyImageCached || '',
    };
    const plan = getNftPlaybackPlan({
      metadata: mergedMeta,
      // Hint video when Alchemy already classified the animation as mp4/webm
      isVideo: alchemyAnimType.startsWith('video/') || undefined,
      videoUrl: alchemyAnimType.startsWith('video/') ? alchemyAnimCached || alchemyAnimation : undefined,
    });
    const soundRaw = plan.audioUrl || plan.videoUrl || alchemyAnimation || '';
    const audioUrl = processMediaUrlServer(
      rewriteLegacyOpenSeaMediaUrl(soundRaw, contract, network),
      '',
      'audio'
    );
    const videoUrl =
      alchemyAnimType.startsWith('video/') && alchemyAnimCached
        ? alchemyAnimCached
        : plan.videoUrl
          ? processMediaUrlServer(rewriteLegacyOpenSeaMediaUrl(plan.videoUrl, contract, network), '', 'audio')
          : '';
    const imageFromFiles = (rawMeta.properties?.files || []).find(
      (f: { uri?: string; url?: string; type?: string; mimeType?: string }) => {
        const u = (f?.uri || f?.url || '').toLowerCase();
        const t = (f?.type || f?.mimeType || '').toLowerCase();
        return t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i.test(u);
      }
    );
    const imageUrl = processMediaUrlServer(
      rewriteLegacyOpenSeaMediaUrl(
        alchemyImageCached ||
          rawMeta.image ||
          rawMeta.image_url ||
          rawMeta.properties?.image ||
          rawMeta.properties?.visual?.url ||
          imageFromFiles?.uri ||
          imageFromFiles?.url ||
          metadata.contract?.openSeaMetadata?.imageUrl ||
          '',
        contract,
        network
      ),
      '',
      'image'
    );

    // Ensure contract address is lowercase
    const contractAddress = metadata.contract.address.toLowerCase();
    const formattedTokenId = metadata.tokenId.toString().replace(/^0x/, '');

    // Alchemy CDN URLs often lack .mp4 — trust Alchemy contentType over URL sniffing.
    const isAlchemyVideo = alchemyAnimType.startsWith('video/');
    const resolvedVideo =
      videoUrl || (isAlchemyVideo ? alchemyAnimCached : '') || undefined;
    const playbackMode = isAlchemyVideo ? 'video-with-audio' : plan.mode;

    const nft: NFT = {
      contract: contractAddress,
      tokenId: formattedTokenId,
      name: rawMeta.name || `NFT #${formattedTokenId}`,
      description: metadata.description || rawMeta.description || '',
      image: imageUrl || '',
      audio: resolvedVideo || audioUrl || '',
      videoUrl: resolvedVideo,
      playbackMode,
      hasValidAudio:
        Boolean(resolvedVideo || audioUrl) ||
        hasPlayableAudio({ audio: audioUrl, metadata: mergedMeta }),
      isVideo: isAlchemyVideo || plan.mode !== 'audio-only',
      network,
      collection: {
        name: metadata.contract?.name || '',
        image: metadata.contract?.openSeaMetadata?.imageUrl || ''
      },
      metadata: {
        ...mergedMeta,
        // Prefer Alchemy CDN first so pickImageCandidates / playback recover
        // when public IPFS CIDs are unreplicated.
        image: alchemyImageCached || rawMeta.image || imageUrl || '',
        image_url: alchemyImageCached || rawMeta.image_url || '',
        animation_url: mergedMeta.animation_url || resolvedVideo || plan.videoUrl || '',
        audio: mergedMeta.audio || (plan.mode === 'video-plus-audio' ? plan.audioUrl : mergedMeta.audio) || undefined,
        mimeType: alchemyAnimType || mergedMeta.mimeType,
        mime_type: alchemyAnimType || mergedMeta.mime_type,
      }
    };

    if (nft.hasValidAudio || nft.isVideo) {
      nft.mediaKey = ownedNftMediaKey(nft.contract, nft.tokenId);
    }

    return nft;
  } catch (error) {
    console.error('Error fetching NFT metadata:', error);
    throw error;
  }
};

const isAlchemyCdnUrl = (url?: string | null): boolean =>
  !!url && /nft-cdn\.alchemy\.com|nft2-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);

/** True when cover/playback still depend on fragile public IPFS gateways. */
export const nftNeedsChainMediaEnrich = (nft: NFT | null | undefined): boolean => {
  if (!nft?.contract || !nft?.tokenId) return false;
  if (
    isAlchemyCdnUrl(nft.image) ||
    isAlchemyCdnUrl(nft.audio) ||
    isAlchemyCdnUrl(nft.videoUrl) ||
    isAlchemyCdnUrl(nft.metadata?.animation_url)
  ) {
    return false;
  }
  const candidates = [
    nft.image,
    nft.audio,
    nft.videoUrl,
    nft.metadata?.image,
    nft.metadata?.animation_url,
  ].filter(Boolean) as string[];
  return candidates.some(
    (u) =>
      u.startsWith('ipfs://') ||
      /\/ipfs\//i.test(u) ||
      /\.ipfs\./i.test(u)
  );
};

/**
 * Refresh media via server Alchemy (`/api/nft`) so unreplicated IPFS CIDs can
 * fall back to Alchemy's cached CDN (image + animation). Safe in mini-apps.
 */
export const enrichNftMediaFromChain = async (nft: NFT): Promise<NFT> => {
  if (!nftNeedsChainMediaEnrich(nft)) return nft;
  try {
    const network = nft.network === 'base' ? 'base' : 'ethereum';
    const res = await fetch(
      `/api/nft?contract=${encodeURIComponent(nft.contract)}&tokenId=${encodeURIComponent(
        nft.tokenId
      )}&network=${network}`
    );
    if (!res.ok) return nft;
    const data = (await res.json()) as NFT;
    if (!data || typeof data !== 'object') return nft;

    const nextImage = data.image || nft.image;
    const nextAudio = data.audio || nft.audio;
    const nextVideo = data.videoUrl || nft.videoUrl;
    return {
      ...nft,
      name: data.name || nft.name,
      image: nextImage,
      audio: nextAudio,
      videoUrl: nextVideo,
      playbackMode: data.playbackMode || nft.playbackMode,
      isVideo: data.isVideo ?? nft.isVideo,
      hasValidAudio: data.hasValidAudio ?? nft.hasValidAudio,
      collection: {
        ...nft.collection,
        name: data.collection?.name || nft.collection?.name,
        image: data.collection?.image || nft.collection?.image,
      },
      metadata: {
        ...nft.metadata,
        ...data.metadata,
        image: data.metadata?.image || data.image || nft.metadata?.image,
        image_url: data.metadata?.image_url || data.image || nft.metadata?.image_url,
        animation_url:
          data.metadata?.animation_url ||
          data.videoUrl ||
          data.audio ||
          nft.metadata?.animation_url,
      },
    };
  } catch (error) {
    console.warn('enrichNftMediaFromChain failed', nft.contract, nft.tokenId, error);
    return nft;
  }
};

/**
 * Direct Alchemy fetch. Use from server/API routes only — Farcaster/Base
 * mini-app webviews often block client calls to alchemy.com, which made
 * profile grids empty on mobile while desktop browsers still worked.
 */
const alchemyFetchDelay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Alchemy occasionally 429s under burst load (e.g. multiple addresses fetched in parallel). Retry transient failures before giving up. */
async function fetchAlchemyWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Alchemy HTTP ${res.status}`);
        if (attempt < maxRetries) {
          const waitMs = Math.pow(2, attempt) * 500;
          console.warn(`⏳ Alchemy ${res.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await alchemyFetchDelay(waitMs);
          continue;
        }
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const waitMs = Math.pow(2, attempt) * 500;
        console.warn(`⏳ Alchemy fetch threw, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries}):`, error);
        await alchemyFetchDelay(waitMs);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Alchemy fetch failed after retries');
}

export const fetchOwnedNftsFromAlchemy = async (address: string): Promise<NFT[]> => {
  try {
    console.log('\n🔍 Fetching NFTs for address:', address);
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) throw new Error('Alchemy API key not found');

    console.log('🌐 Starting parallel fetch from ETH and BASE networks...');
    
    // Fetch from both networks
    const [ethResponse, baseResponse] = await Promise.all([
      fetchAlchemyWithRetry(
        `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`
      ),
      fetchAlchemyWithRetry(
        `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}/getNFTs?owner=${address}&withMetadata=true&pageSize=100`
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
      id?: {
        tokenId: string;
      };
      tokenId?: string;
      title?: string;
      description?: string;
      media?: Array<{ gateway?: string; raw?: string; format?: string }>;
      animation?: { cachedUrl?: string; originalUrl?: string };
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
        const fromMedia = (nft.media || []).find((m) => {
          const format = (m.format || '').toLowerCase();
          return format.includes('mp4') || format.includes('webm') || format.includes('video');
        });
        const animationFromAlchemy =
          nft.animation?.cachedUrl ||
          meta.animation_url ||
          nft.animation?.originalUrl ||
          fromMedia?.raw ||
          fromMedia?.gateway ||
          '';
        const mergedMeta = {
          ...meta,
          animation_url: animationFromAlchemy || meta.animation_url || '',
        };
        const contractAddress = nft.contract.address.toLowerCase();
        const rewrite = (url: string) =>
          rewriteLegacyOpenSeaMediaUrl(normalizeOwnedNftUrl(url), contractAddress, network);

        const plan = getNftPlaybackPlan({ metadata: mergedMeta });
        const soundRaw = plan.audioUrl || plan.videoUrl || '';
        const audioUrl = rewrite(soundRaw);
        const videoUrl = plan.videoUrl ? rewrite(plan.videoUrl) : '';

        const fromImageMedia = (nft.media || []).find((m) => {
          const format = (m.format || '').toLowerCase();
          if (!format) return Boolean(m.gateway || m.raw);
          return (
            format.includes('png') ||
            format.includes('jpeg') ||
            format.includes('jpg') ||
            format.includes('gif') ||
            format.includes('webp') ||
            format.includes('svg') ||
            format.includes('image')
          );
        });
        const alchemyCachedImage = fromImageMedia?.gateway || fromImageMedia?.raw || '';
        const fromImageFiles = (meta.properties?.files || [])
          .map((f) => {
            const u = f?.uri || f?.url || '';
            const t = (f?.type || f?.mimeType || '').toLowerCase();
            if (!u) return '';
            if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif)(?:\?|#|$)/i.test(u)) {
              return u;
            }
            return '';
          })
          .filter(Boolean) as string[];

        // Prefer Alchemy CDN caches — public IPFS often unreplicated (Immutable Spirit).
        const imageUrl = rewrite(
          alchemyCachedImage ||
          meta.image ||
          meta.image_url ||
          meta.properties?.image ||
          meta.properties?.visual?.url ||
          fromImageFiles[0] ||
          ''
        );

        const tokenId = nft.id?.tokenId?.toString()?.replace(/^0x/, '') || nft.tokenId?.toString()?.replace(/^0x/, '');
        if (!tokenId) {
          console.warn('Missing tokenId for NFT:', nft);
          return null;
        }

        const candidate = {
          audio: plan.audioUrl || audioUrl,
          animationUrl: plan.videoUrl || mergedMeta.animation_url,
          metadata: mergedMeta,
        };

        const hasAudio = Boolean(soundRaw) || hasPlayableAudio(candidate);
        const isVideo = plan.mode !== 'audio-only';

        const processedNFT: NFT = {
          contract: contractAddress,
          tokenId,
          name: meta.name || `NFT #${tokenId}`,
          description: meta.description || '',
          image: imageUrl || '',
          animationUrl: rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
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
            ...mergedMeta,
            // Keep original image URI when present so pickImageCandidates can
            // still walk alternates (Alchemy cache, files, collection image).
            image: rewrite(meta.image || '') || imageUrl || '',
            image_url:
              rewrite(meta.image_url || '') ||
              rewrite(alchemyCachedImage) ||
              '',
            animation_url: rewrite(mergedMeta.animation_url || plan.videoUrl || '') || '',
            audio:
              mergedMeta.audio ||
              mergedMeta.audio_url ||
              (plan.mode === 'video-plus-audio' ? plan.audioUrl || undefined : mergedMeta.audio),
          }
        };

        if (hasAudio || isVideo) {
          processedNFT.mediaKey = ownedNftMediaKey(processedNFT.contract, processedNFT.tokenId);
        }

        return processedNFT;
    };

    const processedNFTs = [
      ...((ethData.ownedNfts || []) as AlchemyNFT[]).map((nft) => {
        try {
          return mapAlchemyNft(nft, 'ethereum');
        } catch (error) {
          console.warn('Skipped ETH NFT during map:', error);
          return null;
        }
      }),
      ...((baseData.ownedNfts || []) as AlchemyNFT[]).map((nft) => {
        try {
          return mapAlchemyNft(nft, 'base');
        } catch (error) {
          console.warn('Skipped Base NFT during map:', error);
          return null;
        }
      }),
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

export const fetchUserNFTsFromAlchemy = async (address: string): Promise<NFT[]> => {
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/nfts/owned?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        console.error(`Owned NFT API error ${res.status}:`, await res.text());
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error(`Error fetching NFTs for address ${address}:`, error);
      return [];
    }
  }
  return fetchOwnedNftsFromAlchemy(address);
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
    const user = profileData.users?.[0];

    const verifiedEth = user?.verified_addresses?.eth_addresses;
    if (Array.isArray(verifiedEth) && verifiedEth.length > 0) {
      allAddresses.push(...verifiedEth);
    }
    if (Array.isArray(user?.verifications)) {
      allAddresses.push(...user.verifications);
    }
    if (user?.custody_address) {
      allAddresses.push(user.custody_address);
    }

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
        const nfts = await fetchOwnedNftsFromAlchemy(address);
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
