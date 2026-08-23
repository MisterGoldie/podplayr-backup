import { findFeaturedNft } from '../data/featuredNfts';
import {
  getMediaKey,
  getNftIdentityKey,
  getNftMediaAssetId,
  sameNftIdentity,
  type NftKeySource,
} from './nftIdentity';
import { getNftLikedTime, sortLikedNewestFirst } from './likeTime';

type LikeDedupeSource = NftKeySource & {
  name?: string;
  image?: string;
  audio?: string;
  metadata?: { animation_url?: string; image?: string };
};

function normalizeTitle(name?: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** One library row per featured episode, media file, or same-titled mint. */
export function getLikeDedupeKey(nft?: LikeDedupeSource | null): string {
  if (!nft) return '';
  const featured = findFeaturedNft({
    contract: nft.contract || '',
    tokenId: String(nft.tokenId ?? ''),
    audio: nft.audio || '',
    metadata: nft.metadata,
  });
  if (featured) {
    return `featured:${getNftIdentityKey(featured)}`;
  }

  const audioId = getNftMediaAssetId(nft);
  if (audioId) return `audio:${audioId}`;

  const imageId = getNftMediaAssetId({
    audio: nft.image || nft.metadata?.image,
    metadata: { animation_url: nft.image || nft.metadata?.image },
  });
  const title = normalizeTitle(nft.name);
  if (imageId && title) return `image:${imageId}:${title}`;
  if (title.length >= 16) return `name:${title}`;

  return getNftIdentityKey(nft) || getMediaKey(nft) || '';
}

export function sameLikedTrack(a?: LikeDedupeSource | null, b?: LikeDedupeSource | null): boolean {
  const keyA = getLikeDedupeKey(a);
  const keyB = getLikeDedupeKey(b);
  if (keyA && keyB && keyA === keyB) return true;
  return sameNftIdentity(a, b);
}

export function uniqueLikedNfts<T extends LikeDedupeSource>(nfts: T[]): T[] {
  const best = new Map<string, T>();

  for (const nft of nfts) {
    if (!nft) continue;
    const id = getLikeDedupeKey(nft);
    if (!id) continue;
    const existing = best.get(id);
    if (!existing) {
      best.set(id, nft);
      continue;
    }
    const existingTime = getNftLikedTime(existing);
    const nextTime = getNftLikedTime(nft);
    best.set(id, nextTime >= existingTime ? nft : existing);
  }

  return sortLikedNewestFirst(
    [...best.values()].map((nft) => {
      const canonical = getMediaKey(nft);
      return canonical && nft.mediaKey !== canonical ? { ...nft, mediaKey: canonical } : nft;
    })
  );
}
