import type { NFT } from '~/types/nft';
import { sanitizeMediaUrl } from './media';
import { shouldPreserveAnimation } from './imageOptimizer';

/** Same cover URL + GIF vs still split as NFTCard — player thumbs must match the grid. */
export function getNftCardCover(nft: NFT): {
  rawImageUrl: string;
  useGifCover: boolean;
} {
  const tokenImageUrl =
    sanitizeMediaUrl(nft.image) ||
    sanitizeMediaUrl(nft.metadata?.image) ||
    sanitizeMediaUrl(nft.metadata?.image_url) ||
    '';
  const alchemyVisual = [
    nft.metadata?.animation_url,
    nft.videoUrl,
    nft.audio,
    nft.image,
    nft.metadata?.image,
  ].find((u) => u && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(u));
  const rawImageUrl =
    tokenImageUrl ||
    sanitizeMediaUrl(nft.metadata?.display_image_url) ||
    (alchemyVisual ? sanitizeMediaUrl(alchemyVisual) : '') ||
    sanitizeMediaUrl(nft.metadata?.animation_url) ||
    sanitizeMediaUrl(nft.videoUrl) ||
    sanitizeMediaUrl(nft.collection?.image) ||
    sanitizeMediaUrl(nft.audio) ||
    '';
  const useGifCover =
    Boolean(tokenImageUrl) &&
    shouldPreserveAnimation(tokenImageUrl) &&
    !alchemyVisual;
  return { rawImageUrl, useGifCover };
}
