import type { NFT } from '~/types/nft';

function playbackAssetUrl(nft: Pick<NFT, 'audio' | 'metadata'>): string {
  return (nft.audio || nft.metadata?.animation_url || '').split('?')[0];
}

/** Same token, or same audio/video file (liked mint vs curated featured copy). */
export function findFeaturedNft(
  nft: Pick<NFT, 'contract' | 'tokenId' | 'audio' | 'metadata'>
): NFT | undefined {
  const contract = nft.contract?.toLowerCase();
  const tokenId = String(nft.tokenId ?? '');
  const byId = FEATURED_NFTS.find(
    (featured) =>
      featured.contract?.toLowerCase() === contract && String(featured.tokenId) === tokenId
  );
  if (byId) return byId;
  const play = playbackAssetUrl(nft);
  if (!play) return undefined;
  return FEATURED_NFTS.find((featured) => playbackAssetUrl(featured) === play);
}

/** Display the curated Featured cover when this is the same track under another mint. */
export function withFeaturedCover<T extends Pick<NFT, 'contract' | 'tokenId' | 'audio' | 'metadata' | 'image'>>(
  nft: T
): T {
  const featured = findFeaturedNft(nft);
  if (!featured?.image || featured.image === nft.image) return nft;
  return {
    ...nft,
    image: featured.image,
    metadata: { ...(nft.metadata || {}), image: featured.image },
  };
}

export const FEATURED_NFTS: NFT[] = [
  {
    name: 'I Found It',
    image: 'https://arweave.net/Wvad7CgtidFMH3mOBjRHOeV5_bKvvAR9zZH2BhQSl7M',
    contract: '0x27430c3ef4b04f7d223df7f280ae8fc0b3a407b7',
    tokenId: '50dc9fb449e1',
    network: 'base',
    audio: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8',
      mimeType: 'video/mp4',
      description: 'A Charles Fox Film (ACYL)',
      attributes: [
        { trait_type: 'Director', value: 'Charles Fox' },
      ],
    },
  },
  {
    name: 'Seasoning with Sazón - COD Zombies Terminus EP1',
    image: 'https://arweave.net/HvZ4oE2mDf6G1o1rX9Y_lkqegYA_0ZsRyY1JxQpL2v0',
    contract: '0x27430c3ef4b04f7d223df7f280ae8fc0b3a407b7',
    tokenId: '50dc9fb449e0',
    network: 'base',
    audio: 'https://arweave.net/noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ',
      mimeType: 'video/mp4',
      description: 'Seasoning with Sazón, Call of Duty Black Ops 6 - Zombies - Terminus Episode 1 of 5 | @themrsazon',
      attributes: [
        { trait_type: 'Game', value: 'Call of Duty Black Ops 6' },
        { trait_type: 'Map', value: 'Terminus' },
      ],
    },
  },
  {
    name: 'ACYL RADIO - Topia Hour',
    image: 'https://arweave.net/rGhe8lAX2D9hrbOKeoozySiZvVsSnJqblZ7ofZ2ADnY',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '8',
    network: 'base',
    audio: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ',
      mimeType: 'video/mp4',
      description: 'ACYL RADIO - Topia Hour hosted by Latashá',
      attributes: [
        { trait_type: 'Host', value: 'Latashá' },
      ],
    },
  },
  {
    name: 'ACYL RADIO - WILL01',
    image: 'https://amaranth-adequate-condor-278.mypinata.cloud/ipfs/bafybeige5xctxspzazd4colwtjydimuyhdkkygls33q374xiirg6ec46gy',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '3',
    network: 'base',
    audio: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74',
      mimeType: 'video/mp4',
      description: 'Episode 1 from the founder of ACYL | @willcreatesart',
      attributes: [
        { trait_type: 'Host', value: 'WiLL' },
      ],
    },
  },
  {
    name: 'ACYL RADIO - Chili Sounds 🌶️',
    image: 'https://amaranth-adequate-condor-278.mypinata.cloud/ipfs/bafybeibfkcb4emmqxhjoux3hz33pohw3slfonk5hyxw6i62nzj7vovg4ta',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '5',
    network: 'base',
    audio: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg',
      mimeType: 'video/mp4',
      description: 'ACYL RADIO - Chili Sounds | @themrsazon',
      attributes: [
        { trait_type: 'Host', value: 'Mr. Sazon' },
      ],
    },
  },
  {
    name: 'Salem Tries - The Forest EP1',
    image: 'https://arweave.net/QxJXPOfv_BXT3m2-o75f_x5wOssE7xE5seTVeKB1PI4',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '6',
    network: 'base',
    audio: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0',
      mimeType: 'video/mp4',
      description: 'Join Salem as she plays The Forest for the first time.',
      attributes: [
        { trait_type: 'Game', value: 'The Forest' },
      ],
    },
  },
  {
    name: 'Group (Think) Love',
    image: 'https://arweave.net/F_5sg4RBg3kKQnuvHFhbX8fh4eB7xdlsk_VaTJNK7EI',
    contract: '0xA59Fa4555264B256fD43cd51B5794348F859dA51',
    tokenId: '7',
    network: 'base',
    audio: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://arweave.net/KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4',
      mimeType: 'video/mp4',
      description: '"Group (Think) Love" is intended as a piece of meta-satire, exploring the human condition in the age of AI—where computers are rapidly becoming not only our intimate companions and closest confidants but reflections of ourselves. It delves into the essence of artificial intelligence, highlighting its role as the amalgamation of all human knowledge, creativity, and culture, and positions AI as the familial successor in human evolution. Crafted entirely through AI tools, it simultaneously references pivotal moments and ideas from AI culture itself, embodying the very subject it critiques. (ACYL)',
      attributes: [
        { trait_type: 'Artist', value: 'MSTRBSTRD' },
      ],
    },
  },
];
