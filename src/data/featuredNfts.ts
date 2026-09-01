import type { NFT } from '~/types/nft';
import { normalizeNftTokenId } from '~/utils/nftIdentity';

function playbackAssetUrl(nft: Pick<NFT, 'audio' | 'metadata'>): string {
  return (nft.audio || nft.metadata?.animation_url || '').split('?')[0];
}

/** Match featured episode titles across remints (EP1 suffix, trailing spaces, etc.). */
export function normalizeFeaturedTitle(name?: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findFeaturedByTitle(name?: string): NFT | undefined {
  const title = normalizeFeaturedTitle(name);
  if (title.length < 8) return undefined;

  const stripYear = (t: string) => t.replace(/(?:19|20)\d{2}$/, '');

  const exact = FEATURED_NFTS.find((f) => normalizeFeaturedTitle(f.name) === title);
  if (exact) return exact;

  const titleCore = stripYear(title);
  const byCore = FEATURED_NFTS.find((f) => stripYear(normalizeFeaturedTitle(f.name)) === titleCore);
  if (byCore && titleCore.length >= 8) return byCore;

  return FEATURED_NFTS.find((f) => {
    const featuredTitle = normalizeFeaturedTitle(f.name);
    if (!featuredTitle) return false;
    const featuredCore = stripYear(featuredTitle);
    const longer = Math.max(title.length, featuredTitle.length, titleCore.length, featuredCore.length);
    if (longer < 10) return false;
    return (
      title.startsWith(featuredTitle) ||
      featuredTitle.startsWith(title) ||
      titleCore.startsWith(featuredCore) ||
      featuredCore.startsWith(titleCore)
    );
  });
}

/**
 * Exact Featured-row identity with the curated still already on the object.
 * Used so card/play enrich does not hit /api/nft with placeholder hex tokenIds
 * (Alchemy treats `50dc9fb449e1` as 0x → NFT #88908502419937 → shared collection PNG).
 * Does not match library remints on other contracts.
 */
export function isCuratedFeaturedCover(
  nft: Pick<NFT, 'contract' | 'tokenId' | 'image'>
): boolean {
  const contract = nft.contract?.toLowerCase();
  const tokenId = String(nft.tokenId ?? '');
  if (!contract || !tokenId || !nft.image) return false;
  return FEATURED_NFTS.some(
    (featured) =>
      featured.contract?.toLowerCase() === contract &&
      String(featured.tokenId) === tokenId &&
      featured.image === nft.image
  );
}

/** Same token, same media file, or same featured episode title (remint on another contract). */
export function findFeaturedNft(
  nft: Pick<NFT, 'contract' | 'tokenId' | 'audio' | 'metadata' | 'name'>
): NFT | undefined {
  const contract = nft.contract?.toLowerCase();
  const tokenId = normalizeNftTokenId(nft.tokenId);
  const byId = FEATURED_NFTS.find(
    (featured) =>
      featured.contract?.toLowerCase() === contract &&
      normalizeNftTokenId(featured.tokenId) === tokenId
  );
  if (byId) return byId;
  const play = playbackAssetUrl(nft);
  if (play) {
    const byMedia = FEATURED_NFTS.find((featured) => playbackAssetUrl(featured) === play);
    if (byMedia) return byMedia;
  }
  return findFeaturedByTitle(nft.name);
}

/**
 * Exact (contract, tokenId) lookup against the curated Featured list — for
 * ANY contract, not just `pending`. Deep-link/share resolution must check
 * this before ever calling /api/nft: some Featured entries use a real
 * contract but a placeholder hex tokenId (e.g. "I Found It" `50dc9fb449e1`)
 * that Alchemy misreads as a giant decimal, returning a completely different
 * token's shared collection PNG with no playable media (see
 * isCuratedFeaturedCover above).
 */
export function findFeaturedNftByIdentity(contract: string, tokenId: string): NFT | undefined {
  const c = contract?.toLowerCase();
  const t = normalizeNftTokenId(tokenId);
  if (!c || !t) return undefined;
  return FEATURED_NFTS.find(
    (featured) => featured.contract?.toLowerCase() === c && normalizeNftTokenId(featured.tokenId) === t
  );
}

/** Display the curated Featured cover when this is the same track under another mint. */
export function withFeaturedCover<T extends Pick<NFT, 'contract' | 'tokenId' | 'audio' | 'metadata' | 'image' | 'name'>>(
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

/**
 * Hydrate playback from a curated Featured entry when this wallet mint is the
 * same episode on another contract (e.g. ACYL remints with Pinata metadata).
 */
export function withFeaturedPlayback<T extends NFT>(nft: T): T {
  const featured = findFeaturedNft(nft);
  if (!featured) return nft;

  const playUrl =
    featured.audio ||
    featured.videoUrl ||
    featured.metadata?.animation_url ||
    featured.animationUrl ||
    '';
  if (!playUrl) return withFeaturedCover(nft) as T;

  const withCover = withFeaturedCover(nft);
  return {
    ...withCover,
    audio: featured.audio || playUrl,
    videoUrl: featured.videoUrl || playUrl,
    animationUrl: featured.animationUrl || featured.metadata?.animation_url || playUrl,
    isVideo: featured.isVideo ?? true,
    playbackMode: featured.playbackMode || 'video-with-audio',
    hasValidAudio: true,
    metadata: {
      ...(withCover.metadata || {}),
      animation_url: featured.metadata?.animation_url || playUrl,
      mimeType:
        featured.metadata?.mimeType ||
        featured.metadata?.mime_type ||
        withCover.metadata?.mimeType ||
        'video/mp4',
      mime_type:
        featured.metadata?.mime_type ||
        featured.metadata?.mimeType ||
        withCover.metadata?.mime_type ||
        'video/mp4',
      description:
        withCover.metadata?.description ||
        featured.metadata?.description ||
        featured.description,
    },
  };
}

/** Curated cover + Arweave/Mux playback for reminted featured episodes. */
export function withFeaturedHydration<T extends NFT>(nft: T): T {
  return withFeaturedPlayback(nft);
}

export const FEATURED_NFTS: NFT[] = [
  {
    name: 'NFT Podcast with Logik (Julian Gilliam)',
    image:
      'https://image.mux.com/8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ/thumbnail.jpg?time=10',
    contract: 'pending',
    tokenId: 'logik-ep1',
    network: 'base',
    audio: 'https://stream.mux.com/8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ.m3u8',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://stream.mux.com/8VjskmcBC3w6R01xpsgLHUKb31wjrhKch23uZBjmJuOQ.m3u8',
      mimeType: 'video/mp4',
      description: 'NFT Podcast with Logik (Julian Gilliam) — episode 1',
      attributes: [{ trait_type: 'Guest', value: 'Julian Gilliam' }],
    },
  },
  {
    name: 'I Asked My Friends A Serious Question',
    image:
      'https://image.mux.com/1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s/thumbnail.jpg?time=11',
    contract: 'pending',
    tokenId: 'iasked-friends-serious-question',
    network: 'base',
    audio: 'https://stream.mux.com/1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s.m3u8',
    isVideo: true,
    playbackMode: 'video-with-audio',
    metadata: {
      animation_url: 'https://stream.mux.com/1C023gIJ9baWRdDavLYzKqB02iBPUHeO00wfTaL2AnGp00s.m3u8',
      mimeType: 'video/mp4',
      description: 'I Asked My Friends A Serious Question',
    },
  },
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
