import type { NFT } from '~/types/nft';

/**
 * Explore → Suggested → Music videos.
 * Hardcoded NFTs that play in the app player (Mux via PLAYBACK_OVERRIDES).
 * Key Mux by Arweave tx, IPFS CID, or Alchemy CDN animation id in src/lib/mediaCdn.ts.
 */
export const SUGGESTED_MUSIC_VIDEOS: NFT[] = [
  {
    name: 'NEYBORS',
    image: 'https://nft-cdn.alchemy.com/eth-mainnet/007c07129e123ec97c70f3b6a58c57b0',
    contract: '0x250fd27b0b6f2438414a98fc9bfa5641b3717f03',
    tokenId: '137',
    network: 'ethereum',
    audio: 'https://gateway.pinata.cloud/ipfs/bafybeieaq7nqlv5j2wndfkxwlodqddelahlmuwczbrzei7py5enzftuska',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'Heno.' },
    metadata: {
      animation_url: 'https://gateway.pinata.cloud/ipfs/bafybeieaq7nqlv5j2wndfkxwlodqddelahlmuwczbrzei7py5enzftuska',
      mimeType: 'video/mp4',
      description: 'NEYBORS Music Video - Heno. featuring Elujay & J.Robb',
    },
  },
  {
    name: 'A Ten',
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
  {
    name: 'The Island',
    image: 'https://nft-cdn.alchemy.com/eth-mainnet/1aea23e56581e5825f5499cea65ba65a',
    contract: '0x7b0046ddf5e11f7fd3519e1af37014bcde3348a2',
    tokenId: '221',
    network: 'ethereum',
    audio: 'https://gateway.pinata.cloud/ipfs/bafybeicod3m7as3y7luyvfgclltnps235hhevt64xqmo3nyhojn2mv3owq?id=221',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'LATASHÁ' },
    metadata: {
      animation_url: 'https://gateway.pinata.cloud/ipfs/bafybeicod3m7as3y7luyvfgclltnps235hhevt64xqmo3nyhojn2mv3owq?id=221',
      mimeType: 'video/mp4',
      description: 'ISLAND 221',
    },
  },
  {
    name: 'Bruises',
    image: 'https://nft-cdn.alchemy.com/eth-mainnet/85934c60b2191b2e6a5d64fe4eb30f69',
    contract: '0x0f93ce800b2d4a58220b70c38b107d6a2e178558',
    tokenId: '26',
    network: 'ethereum',
    audio: 'https://arweave.net/CQkNgwIYcfLj0ipMgbQ_oF4ITLY3ulp_kofmliVpJSw',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'Music Video Game' },
    metadata: {
      animation_url: 'https://arweave.net/CQkNgwIYcfLj0ipMgbQ_oF4ITLY3ulp_kofmliVpJSw',
      mimeType: 'video/mp4',
      description: "'Bruises' Music Video Game - Opening Cinematic #26",
    },
  },
  {
    name: 'Energy',
    image: 'https://nft-cdn.alchemy.com/base-mainnet/b8a6a50a8d0cfff6fd8488aa1e0fef20',
    contract: '0x68c21f03c3d2485ca7a491e87f81c4ca6a4b622e',
    tokenId: '3',
    network: 'base',
    audio: 'https://gateway.pinata.cloud/ipfs/bafybeigxtbuhw3zvhjfruzrfzcprmbxyryxqidnja5w4gj2dthhi4tuiyi',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'Official Visualizer' },
    metadata: {
      animation_url: 'https://gateway.pinata.cloud/ipfs/bafybeigxtbuhw3zvhjfruzrfzcprmbxyryxqidnja5w4gj2dthhi4tuiyi',
      mimeType: 'video/mp4',
      description: 'Energy (OFFICIAL VISUALIZER)',
    },
  },
  {
    name: 'PLATTER',
    image: 'https://i2c.seadn.io/ethereum/0xd86a103ca84ccbb885980cc910cd6a07bb0b9172/b3b9e13656bdd01e34710810931ae4/05b3b9e13656bdd01e34710810931ae4.jpeg',
    contract: '0xd86a103ca84ccbb885980cc910cd6a07bb0b9172',
    tokenId: '22',
    network: 'ethereum',
    audio: 'https://raw2.seadn.io/ethereum/0xd86a103ca84ccbb885980cc910cd6a07bb0b9172/83edeeba95c9390959ccd1febaca30/bf83edeeba95c9390959ccd1febaca30.mp4',
    isVideo: true,
    playbackMode: 'video-with-audio',
    collection: { name: 'LATASHÁ' },
    metadata: {
      animation_url: 'https://raw2.seadn.io/ethereum/0xd86a103ca84ccbb885980cc910cd6a07bb0b9172/83edeeba95c9390959ccd1febaca30/bf83edeeba95c9390959ccd1febaca30.mp4',
      mimeType: 'video/mp4',
      description: 'PLATTER (music video) 22/100',
    },
  },
];
