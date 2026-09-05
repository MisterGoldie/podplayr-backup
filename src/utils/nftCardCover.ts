import type { NFT } from '~/types/nft';
import { getRememberedNftDisplayCover, sanitizeMediaUrl } from './media';
import { isAlchemyAnimationCdnUrl, shouldPreserveAnimation } from './imageOptimizer';

const isVideoCoverUrl = (url?: string | null): boolean => {
  const u = sanitizeMediaUrl(url);
  if (!u) return false;
  return (
    isAlchemyAnimationCdnUrl(u) ||
    /res\.cloudinary\.com\/alchemyapi\/video\/fetch/i.test(u) ||
    /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u)
  );
};

/** Same cover URL + GIF vs still split as NFTCard — player thumbs must match the grid. */
export function getNftCardCover(nft: NFT): {
  rawImageUrl: string;
  useGifCover: boolean;
} {
  const remembered = getRememberedNftDisplayCover(nft);
  if (remembered) {
    return {
      rawImageUrl: remembered,
      useGifCover: shouldPreserveAnimation(remembered),
    };
  }

  const stillCandidates = [
    nft.image,
    nft.metadata?.image,
    nft.metadata?.image_url,
    nft.metadata?.display_image_url,
  ]
    .map((u) => sanitizeMediaUrl(u))
    .filter((u): u is string => Boolean(u) && !isVideoCoverUrl(u));
  const tokenImageUrl = stillCandidates[0] || '';
  const alchemyStill = stillCandidates.find(
    (u) => /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(u)
  );
  const rawImageUrl =
    tokenImageUrl ||
    alchemyStill ||
    sanitizeMediaUrl(nft.collection?.image) ||
    sanitizeMediaUrl(nft.image) ||
    sanitizeMediaUrl(nft.metadata?.animation_url) ||
    '';
  const useGifCover =
    Boolean(tokenImageUrl) &&
    shouldPreserveAnimation(tokenImageUrl) &&
    !alchemyStill;
  return { rawImageUrl, useGifCover };
}
