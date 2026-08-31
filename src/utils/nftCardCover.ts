import type { NFT } from '~/types/nft';
import {
  isEthereumStoriesGifCoverUrl,
  nftPrefersTokenVideoCover,
  nftRejectsSharedCoverUrl,
  processMediaUrl,
  sanitizeMediaUrl,
} from './media';
import { getVideoCoverStillUrl, shouldPreserveAnimation } from './imageOptimizer';

/** Same cover URL + GIF vs still split as NFTCard — player thumbs must match the grid. */
export function getNftCardCover(nft: NFT): {
  rawImageUrl: string;
  useGifCover: boolean;
} {
  const collectionImage = sanitizeMediaUrl(nft.collection?.image);
  const rejectCollection = nftPrefersTokenVideoCover(nft);
  const pickTokenStill = (url?: string | null) => {
    const next = sanitizeMediaUrl(url);
    if (!next) return '';
    if (nftRejectsSharedCoverUrl(nft, next, collectionImage)) return '';
    return next;
  };
  const tokenImageUrl =
    pickTokenStill(nft.image) ||
    pickTokenStill(nft.metadata?.image) ||
    pickTokenStill(nft.metadata?.image_url);
  const alchemyVisual = [
    nft.metadata?.animation_url,
    nft.videoUrl,
    nft.audio,
    nft.image,
    nft.metadata?.image,
  ].find((u) => u && /nft2?-cdn\.alchemy\.com|res\.cloudinary\.com\/alchemyapi/i.test(u));
  const rawImageUrl =
    tokenImageUrl ||
    pickTokenStill(nft.metadata?.display_image_url) ||
    (alchemyVisual ? sanitizeMediaUrl(alchemyVisual) : '') ||
    sanitizeMediaUrl(nft.metadata?.animation_url) ||
    sanitizeMediaUrl(nft.videoUrl) ||
    (rejectCollection ? '' : collectionImage) ||
    sanitizeMediaUrl(nft.audio) ||
    '';
  const useGifCover =
    isEthereumStoriesGifCoverUrl(tokenImageUrl) ||
    isEthereumStoriesGifCoverUrl(rawImageUrl) ||
    (Boolean(tokenImageUrl) &&
      shouldPreserveAnimation(tokenImageUrl) &&
      !alchemyVisual);
  return { rawImageUrl, useGifCover };
}

/** Playable origin for a video-token card still — never OpenSea collection i2c. */
export function pickVideoStillOrigin(nft: NFT): string {
  const collectionImage = sanitizeMediaUrl(nft.collection?.image);
  const candidates = [
    nft.metadata?.animation_url,
    nft.animationUrl,
    nft.videoUrl,
    nft.audio,
    nft.image,
    nft.metadata?.image,
  ];
  for (const candidate of candidates) {
    const cleaned = sanitizeMediaUrl(candidate);
    if (!cleaned || nftRejectsSharedCoverUrl(nft, cleaned, collectionImage)) continue;
    const httpsUrl = processMediaUrl(cleaned, '', 'audio');
    if (
      !httpsUrl ||
      httpsUrl.includes('default-nft.png') ||
      nftRejectsSharedCoverUrl(nft, httpsUrl, collectionImage)
    ) {
      continue;
    }
    return httpsUrl;
  }
  return '';
}

/** Cloudinary first-frame still from the token video (Pinata GIF covers stay raw). */
export function videoCardStillUrl(nft: NFT, size = 360): string {
  const origin = pickVideoStillOrigin(nft);
  if (!origin) return '';
  if (isEthereumStoriesGifCoverUrl(origin)) return origin;
  const still = getVideoCoverStillUrl(origin, size, { assumeVideo: true });
  return still || origin;
}
