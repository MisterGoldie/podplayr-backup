import { extractIPFSHash, parseArweaveMediaPath } from '../utils/media';

/**
 * Mobile playback cannot stream the original Arweave/IPFS files.
 * Featured videos are hundreds of MB to ~1.3GB progressive MP4s.
 *
 * Put transcoded derivatives on a CDN and set NEXT_PUBLIC_MEDIA_CDN_BASE.
 * Convention (id = Arweave tx or IPFS CID):
 *   {BASE}/{id}/480p.mp4   ← mobile (required)
 *   {BASE}/{id}/720p.mp4   ← desktop (optional, falls back to 480p)
 *
 * ffmpeg example (faststart is required so the first frame does not wait
 * for the whole file):
 *   ffmpeg -i original.mp4 -vf "scale=-2:480" -c:v libx264 -preset veryfast \
 *     -crf 28 -c:a aac -b:a 96k -movflags +faststart 480p.mp4
 *
 * A CDN of the *original* GB files will not make mobile usable.
 */

export type CdnPlaybackSource = {
  url: string;
  quality: '480p' | '720p' | 'hls';
};

const CDN_BASE = (process.env.NEXT_PUBLIC_MEDIA_CDN_BASE || '').replace(/\/+$/, '');

/**
 * Optional per-id overrides (Cloudflare Stream HLS, Mux, etc.).
 * Key = Arweave tx id or IPFS CID.
 */
const muxHls = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;

const PLAYBACK_OVERRIDES: Record<string, { mobile: string; desktop?: string }> = {
  // ACYL RADIO - Chili Sounds 🌶️
  GujXDFCEk4FmJl9b_TlofLEmx_YnY_LRSB2aSY8AcRg: {
    mobile: muxHls('CHno5MdpD02WNJzrX1R4vEerYBs021RE4zraz00I00q2MZs'),
    desktop: muxHls('CHno5MdpD02WNJzrX1R4vEerYBs021RE4zraz00I00q2MZs'),
  },
  // ACYL RADIO - Topia Hour
  'YV3PQYn-NAX3cC6t6yhlmMtSzZ_SxIcAb3Np6SKBCuQ': {
    mobile: muxHls('odx02ZC8FxRV01JLxoJ02Mhz3v1m012e5HpSuw9fWdhck02c'),
    desktop: muxHls('odx02ZC8FxRV01JLxoJ02Mhz3v1m012e5HpSuw9fWdhck02c'),
  },
  // I Found It
  qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8: {
    mobile: muxHls('sQK66svaOrzGdPAjhtuqe00mhTLMe02AXL00bF9jUKJ01B00'),
    desktop: muxHls('sQK66svaOrzGdPAjhtuqe00mhTLMe02AXL00bF9jUKJ01B00'),
  },
  // Group (Think) Love
  'KPKrKgdACqggYesQqRCR4MeLWDlpR6i16xL-Q_e35q4': {
    mobile: muxHls('skHAVIRP6ujsh5eCF5GMPpBPzECaTHl00sW6LuxekWh00'),
    desktop: muxHls('skHAVIRP6ujsh5eCF5GMPpBPzECaTHl00sW6LuxekWh00'),
  },
  // Salem Tries - The Forest EP1
  'Df6hOV1--hsJBtTL1cEbhBkRZuggxSpR9eM0DXsdcv0': {
    mobile: muxHls('WxcAI5024DWcKveO202ipEZU00rVHsxUy02DTGLWJrBEp9o'),
    desktop: muxHls('WxcAI5024DWcKveO202ipEZU00rVHsxUy02DTGLWJrBEp9o'),
  },
  // ACYL RADIO - WILL01
  'FXMkBkgV79p3QIL8589uh68-sKuXbmuBzQwvWH10v74': {
    mobile: muxHls('ZEKVzDhMOAQZ6iJKypsqCZHDrw019Vs11DfLoA23HO7c'),
    desktop: muxHls('ZEKVzDhMOAQZ6iJKypsqCZHDrw019Vs11DfLoA23HO7c'),
  },
  // Music Mondays
  '6Y0t6OM1QybUlzHmbw2BLiFNjrG_jJfr4Md_pIF4o3c': {
    mobile: muxHls('VLW3nHxl5oW02dBMn02kombVDy3B5OtT86jJesGzDl6j00'),
    desktop: muxHls('VLW3nHxl5oW02dBMn02kombVDy3B5OtT86jJesGzDl6j00'),
  },
  // YOU WIN!! 592
  bafybeibbsp5qo6xhupb66ychgwwvzv2ae3kwesyvxuv4dynq3rr4jbo23q: {
    mobile: muxHls('fUxKFIvWyFTKKjrdLnGMQYUGbL01SIkjsIdI02pJi3bW8'),
    desktop: muxHls('fUxKFIvWyFTKKjrdLnGMQYUGbL01SIkjsIdI02pJi3bW8'),
  },
  // Seasoning with Sazón - COD Zombies Terminus EP1
  noYvGupxQyo2P7C2GMNNUseml29HEN6HLyvXOBD7jYQ: {
    mobile: muxHls('oTt2eSe8ONvIQ5U9iJ013kRyYWj2LRU2fxSLMuhm3tC00'),
    desktop: muxHls('oTt2eSe8ONvIQ5U9iJ013kRyYWj2LRU2fxSLMuhm3tC00'),
  },
};

export function mediaAssetIdFromUrl(url: string): string | null {
  if (!url) return null;
  const ar = parseArweaveMediaPath(url);
  if (ar.fileTxId) return ar.fileTxId;
  const cid = extractIPFSHash(url);
  return cid || null;
}

function isUsableUrl(url?: string): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

/** CDN / transcoded URLs to try *before* the original Arweave/IPFS file. */
export function resolveCdnPlaybackUrls(
  sourceUrl: string,
  options: { mobile?: boolean } = {}
): string[] {
  const id = mediaAssetIdFromUrl(sourceUrl);
  if (!id) return [];

  const urls: string[] = [];
  const push = (url?: string) => {
    if (isUsableUrl(url) && !urls.includes(url)) urls.push(url);
  };

  const override = PLAYBACK_OVERRIDES[id];
  if (override) {
    if (options.mobile) {
      push(override.mobile);
      push(override.desktop);
    } else {
      push(override.desktop);
      push(override.mobile);
    }
  }

  if (CDN_BASE) {
    if (options.mobile) {
      push(`${CDN_BASE}/${id}/480p.mp4`);
      push(`${CDN_BASE}/${id}/720p.mp4`);
    } else {
      push(`${CDN_BASE}/${id}/720p.mp4`);
      push(`${CDN_BASE}/${id}/480p.mp4`);
    }
    push(`${CDN_BASE}/${id}/master.m3u8`);
  }

  return urls;
}
