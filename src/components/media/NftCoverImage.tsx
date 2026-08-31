'use client';

import { useMemo } from 'react';
import type { NFT } from '~/types/nft';
import { withFeaturedHydration } from '~/data/featuredNfts';
import { getNftCardCover } from '../../utils/nftCardCover';
import { NFTGifImage } from './NFTGifImage';
import { NFTImage } from './NFTImage';

/** Always < 400 so NFTImage uses the same card-thumb pipeline everywhere. */
const CARD_THUMB_PX = 180;

interface NftCoverImageProps {
  nft: NFT;
  className?: string;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  smallCard?: boolean;
}

/**
 * Same cover as NFTCard / mini-player: featured hydration + getNftCardCover
 * + GIF vs still split. Do not pass a raw nft.image into NFTImage from
 * InfoPanel or other surfaces — that skips this path and breaks retrieval.
 */
export function NftCoverImage({
  nft,
  className,
  sizes,
  priority = false,
  quality = 60,
  smallCard,
}: NftCoverImageProps) {
  const displayNft = useMemo(
    () => withFeaturedHydration(nft),
    [nft, nft.contract, nft.tokenId, nft.name, nft.image, nft.audio, nft.metadata?.image, nft.metadata?.animation_url]
  );
  const { rawImageUrl, useGifCover } = getNftCardCover(displayNft);
  const px = smallCard ? 160 : CARD_THUMB_PX;

  if (useGifCover) {
    return (
      <NFTGifImage
        nft={displayNft}
        className={className}
        width={px}
        height={px}
        priority={priority}
      />
    );
  }

  return (
    <NFTImage
      nft={displayNft}
      src={rawImageUrl}
      alt={nft.name}
      className={className}
      width={px}
      height={px}
      sizes={sizes || `${px}px`}
      quality={quality}
      priority={priority}
      loading={priority ? 'eager' : 'lazy'}
    />
  );
}
