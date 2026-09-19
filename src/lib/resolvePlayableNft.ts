import { cache } from 'react';
import type { NFT } from '../types/user';
import { getNFTMetadata, isOnChainNftIdentity, nftNeedsChainMediaEnrich } from './nft';
import { findFeaturedNftByIdentity, withFeaturedPlayback } from '../data/featuredNfts';
import { isPlayableMediaNFT } from '../utils/isMediaNFT';
import { firstNonNull } from './nftBootstrap';
import { getCachedEmbedNft, setCachedEmbedNft } from './nftEmbedCache';

function normalizeDeepLinkTokenId(tokenId: string): string {
  return String(tokenId).replace(/^(0x){2,}/i, '0x');
}

async function playableOnNetwork(
  contract: string,
  tokenId: string,
  network: 'base' | 'ethereum'
): Promise<NFT | null> {
  const nft = await getNFTMetadata(contract, tokenId, network);
  const enriched = withFeaturedPlayback(nft);
  if (nft?.contract && isPlayableMediaNFT(enriched)) return enriched;
  return null;
}

/**
 * One playable NFT for an embed/deep-link. Featured first, then Base and
 * Ethereum raced (first playable wins). `cache()` dedupes generateMetadata +
 * the page body so a launch only hits Alchemy once on the server, and
 * `nftEmbedCache` carries the verdict across requests so a shared cast only
 * pays for the chain race the first time anyone opens it.
 */
export const resolvePlayableNftForEmbed = cache(
  async (contract: string, tokenId: string): Promise<NFT | null> => {
    const normalizedTokenId = normalizeDeepLinkTokenId(tokenId);
    const featured = findFeaturedNftByIdentity(contract, normalizedTokenId);
    if (featured) return withFeaturedPlayback(featured);

    if (contract === 'pending' || !isOnChainNftIdentity(contract, normalizedTokenId)) {
      return null;
    }

    const cached = await getCachedEmbedNft(contract, normalizedTokenId);
    if (cached) return cached.nft;

    let lookupFailed = false;
    const resolved = await firstNonNull(
      (['base', 'ethereum'] as const).map((network) =>
        playableOnNetwork(contract, normalizedTokenId, network).catch(() => {
          lookupFailed = true;
          return null;
        })
      )
    );

    // An upstream outage is not proof that the NFT has no media. Leave a
    // failed lookup retryable on the next open instead of caching a miss.
    if (!resolved && lookupFailed) return null;

    // Awaited rather than fire-and-forget: the serverless instance can be
    // frozen as soon as the response is sent, which would drop the write and
    // leave every open paying the cold path.
    await setCachedEmbedNft(
      contract,
      normalizedTokenId,
      resolved,
      nftNeedsChainMediaEnrich(resolved)
    );

    return resolved;
  }
);
