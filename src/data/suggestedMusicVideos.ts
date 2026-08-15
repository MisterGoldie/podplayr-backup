import type { NFT } from '~/types/nft';

/**
 * Explore → Suggested → Music videos.
 * Hardcoded NFTs that play in the app player (Mux via PLAYBACK_OVERRIDES).
 * Key Mux by Arweave tx, IPFS CID, or Alchemy CDN animation id in src/lib/mediaCdn.ts.
 */
export const SUGGESTED_MUSIC_VIDEOS: NFT[] = [
  {
    name: 'LATASHÁ - A Ten',
    image: 'https://nft-cdn.alchemy.com/base-mainnet/7d1b91517fd57375c124c9f8b6a66a2c',
    contract: '0x0646874f1676b37ec100f66df685308f9c2e5d8a',
    tokenId: '266',
    network: 'base',
    audio: 'https://nft2-cdn.alchemy.com/base-mainnet/7d1b91517fd57375c124c9f8b6a66a2c_animation',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'LATASHÁ' },
    metadata: {
      animation_url: 'https://nft2-cdn.alchemy.com/base-mainnet/7d1b91517fd57375c124c9f8b6a66a2c_animation',
      mimeType: 'video/mp4',
      description: 'LATASHÁ - A Ten (OFFICIAL VIDEO)',
    },
  },
];
