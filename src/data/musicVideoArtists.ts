import type { NFT } from '../types/user';
import {
  normalizeContractAddress,
  toDecimalTokenId,
} from '../utils/nftExplorerLinks';

export type MusicVideoArtist = {
  fid: number;
  /** Shown immediately while the Farcaster profile loads. */
  name: string;
};

function artistKey(contract: string, tokenId: string | number): string {
  return `${normalizeContractAddress(contract)}:${toDecimalTokenId(tokenId)}`;
}

const LATASHA: MusicVideoArtist = { fid: 10914, name: 'LATASHÁ' };

/**
 * Music video → Farcaster artist. Keyed by contract + token so it also
 * matches when the same NFT is played from a profile, not just Explore.
 */
const MUSIC_VIDEO_ARTISTS: Record<string, MusicVideoArtist> = {
  // A Ten
  [artistKey('0x0646874f1676b37ec100f66df685308f9c2e5d8a', '266')]: LATASHA,
  // The Island
  [artistKey('0x7b0046ddf5e11f7fd3519e1af37014bcde3348a2', '221')]: LATASHA,
  // PLATTER
  [artistKey('0xd86a103ca84ccbb885980cc910cd6a07bb0b9172', '22')]: LATASHA,
  // Energy
  [artistKey('0x68c21f03c3d2485ca7a491e87f81c4ca6a4b622e', '3')]: {
    fid: 419984,
    name: 'GNERIC',
  },
  // BETTY! ft Rob Apollo — Jamee Cornelia
  [artistKey('0xcdb048544942b24461b046cdcc88a4bd7a37d511', '4')]: {
    fid: 394597,
    name: 'Jamee Cornelia',
  },
  // Calling — XTincT
  [artistKey('0x3709586a4f72fc60fbc847b5b6bbd86d06672c52', '1')]: {
    fid: 541225,
    name: 'XTincT',
  },
};

export function getMusicVideoArtist(
  nft: Pick<NFT, 'contract' | 'tokenId'> | null | undefined
): MusicVideoArtist | null {
  if (!nft?.contract || nft.tokenId === undefined || nft.tokenId === null) return null;
  return MUSIC_VIDEO_ARTISTS[artistKey(nft.contract, nft.tokenId)] ?? null;
}
