import type { NFT } from '../types/user';
import { getNftPlaybackPlan, isPlayableMediaNFT } from './isMediaNFT';
import { isPhishingSpamNft, isUnsafePlaybackUrl } from './nftSafety';

/**
 * Dev dump for comparing real spam vs legit media NFTs.
 * Filter console with: [podplayr:spam-debug]
 */
export const logNftCardSpamDebug = (
  nft: NFT,
  reason: 'click' | 'hide' | 'mount' = 'click'
): void => {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;

  const plan = getNftPlaybackPlan(nft);
  const meta = nft.metadata || {};
  const attrs = Array.isArray(meta.attributes) ? meta.attributes : [];
  const files = meta.properties?.files || [];

  const urls = {
    image: nft.image,
    audio: nft.audio,
    videoUrl: nft.videoUrl,
    animationUrl: nft.animationUrl,
    metaImage: meta.image,
    metaImageUrl: meta.image_url,
    metaAnimation: meta.animation_url,
    metaAudio: meta.audio || meta.audio_url,
    propsAudio: meta.properties?.audio || meta.properties?.audio_url,
    propsVideo: meta.properties?.video,
    propsAnimation: meta.properties?.animation_url,
  };

  const summary = {
    reason,
    name: nft.name,
    contract: nft.contract,
    tokenId: nft.tokenId,
    network: nft.network,
    alchemyIsSpam: nft.spamInfo?.isSpam ?? nft.isSpam ?? nft.contractIsSpam,
    classifications:
      nft.spamInfo?.classifications ||
      nft.spamClassifications ||
      nft.contractSpamClassifications ||
      null,
    wouldFilterAsPhishingSpam: isPhishingSpamNft(nft),
    isPlayableMediaNFT: isPlayableMediaNFT(nft),
    playbackMode: nft.playbackMode || plan.mode,
    audio: urls.audio,
    animation: urls.metaAnimation || urls.animationUrl,
    image: urls.image,
    mime: meta.mimeType || meta.mime_type || meta.properties?.mimeType || null,
    external_url: (meta as { external_url?: string }).external_url || null,
    descBlank: !String(nft.description || meta.description || '').trim(),
    attrCount: attrs.length,
    collectionName: nft.collection?.name || null,
  };

  const label = `[podplayr:spam-debug] ${reason} ${nft.name || 'untitled'} ${nft.contract?.slice(0, 10)}…#${nft.tokenId}`;
  // Always print summary (collapsed groups are easy to miss in mini-app webviews).
  console.log(label, summary);
  console.groupCollapsed(`${label} details`);
  console.log('alchemySpam', {
    isSpam: summary.alchemyIsSpam,
    classifications: summary.classifications,
    spamInfo: nft.spamInfo ?? null,
  });
  console.log('urls', urls);
  console.log('playback', {
    plan,
    hasValidAudio: nft.hasValidAudio,
    isVideo: nft.isVideo,
    unsafeUrls: Object.fromEntries(
      Object.entries(urls).map(([k, v]) => [k, isUnsafePlaybackUrl(v as string)])
    ),
  });
  console.log('mime / description / attributes / files', {
    mime: {
      mimeType: meta.mimeType || meta.mime_type,
      propsMime: meta.properties?.mimeType,
      contentMime: meta.content?.mime,
    },
    description: {
      length: (nft.description || meta.description || '').length,
      preview: String(nft.description || meta.description || '').slice(0, 160),
    },
    attributes: attrs.slice(0, 20),
    files: files.slice(0, 12),
  });
  console.log('full NFT object', nft);
  console.groupEnd();
};
