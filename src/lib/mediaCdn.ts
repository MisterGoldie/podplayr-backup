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
const PLAYBACK_OVERRIDES: Record<string, { mobile: string; desktop?: string }> = {
  // 'qsVEbTD0FUZ8VebK4yxOrKWDQtW8BpNWj7o46HzKsV8': {
  //   mobile: 'https://customer-xxx.cloudflarestream.com/UID/manifest/video.m3u8',
  //   desktop: 'https://customer-xxx.cloudflarestream.com/UID/manifest/video.m3u8',
  // },
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
