import type { NFT } from '~/types/nft';
import { looksLikeStillImageUrl, sanitizeMediaUrl } from './media';
import { urlLooksLikeExtensionlessVideo } from './ipfsExtensionlessMedia';
import { shouldPreserveAnimation } from './imageOptimizer';

const isAlchemyVisualUrl = (url?: string | null): boolean =>
  !!url && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(url);

const isTokenVideoFileUrl = (url?: string | null): boolean => {
  const u = sanitizeMediaUrl(url);
  if (!u) return false;
  return urlLooksLikeExtensionlessVideo(u) || /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.test(u);
};

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
  ].find((u) => isAlchemyVisualUrl(u));
  const tokenVideoFile = [
    nft.metadata?.animation_url,
    nft.videoUrl,
    nft.animationUrl,
    nft.audio,
    tokenImageUrl,
  ].find((u) => isTokenVideoFileUrl(u));
  // Real stills / Alchemy hashes stay first. A directory CID or empty image
  // must not hide the same-folder video file (`nft-gallery-1mov`).
  const hasTokenStill =
    looksLikeStillImageUrl(tokenImageUrl) || isAlchemyVisualUrl(tokenImageUrl);
  const rawImageUrl =
    (hasTokenStill && tokenImageUrl) ||
    tokenVideoFile ||
    tokenImageUrl ||
    sanitizeMediaUrl(nft.metadata?.display_image_url) ||
    (alchemyVisual ? sanitizeMediaUrl(alchemyVisual) : '') ||
    sanitizeMediaUrl(nft.collection?.image) ||
    '';
  const useGifCover =
    Boolean(tokenImageUrl) &&
    shouldPreserveAnimation(tokenImageUrl) &&
    !alchemyVisual;
  return { rawImageUrl, useGifCover };
}
